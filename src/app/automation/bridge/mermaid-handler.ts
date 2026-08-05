import { createMermaidSceneSpec, type MermaidSceneSpec } from '@open-pencil/core/diagram'
import { mermaidDiagramOwner, reconcileMermaidDiagramSource } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { requestNodes } from '@/app/automation/bridge/board-tools/native/text'
import {
  coalesceAutomationMutationRequest,
  enqueueAutomationMutation,
  type AutomationMutationMetadata,
  type AutomationMutationOutcome
} from '@/app/automation/bridge/mutation-queue'
import {
  assertMutationRequestIdFresh,
  mutationRequestLedgerError,
  mutationRequestLedgerState,
  mutationRequestSignature,
  recordMutationRequestReceipt,
  reserveMutationRequest,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import { parseMermaidInBrowser } from '@/app/diagram/mermaid/parse'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { canWriteSmylrProductionDocument } from '@/app/smylr-production/document-state'

const GROUNDED_PLACEMENT_GAP = 96
const MERMAID_MUTATION_ROUTE = 'insert_mermaid_diagram'

type MermaidHandlerOptions = {
  beforeMutationReceiptStorage?: () => Promise<void> | void
  finishMutation?: (
    target: AutomationTarget,
    args: InsertMermaidArgs,
    nodeIds: string[]
  ) => Promise<void>
}

type DurableMermaidIntent = {
  expectedRevision: number
  inputDigest: string
  metadata: AutomationMutationMetadata & {
    expectedRevision: number
    requestId: string
  }
  requestId: string
  route: typeof MERMAID_MUTATION_ROUTE
  taskId?: string
  traceId?: string
}

type InsertMermaidArgs = {
  allow_additional_owner: boolean
  anchor_id?: string
  board_name?: string
  mutation?: AutomationMutationMetadata
  owner_id?: string
  project_name?: string
  source: string
  x?: number
  y?: number
  zoom_to_selection: boolean
}

function readTrimmedString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function readPosition(args: UnknownRecord): Pick<InsertMermaidArgs, 'x' | 'y'> {
  const hasX = Object.hasOwn(args, 'x')
  const hasY = Object.hasOwn(args, 'y')
  if (hasX !== hasY) throw new Error('x and y must be provided together.')
  if (!hasX) return {}
  if (typeof args.x !== 'number' || !Number.isFinite(args.x)) {
    throw new TypeError('x must be a finite canvas coordinate.')
  }
  if (typeof args.y !== 'number' || !Number.isFinite(args.y)) {
    throw new TypeError('y must be a finite canvas coordinate.')
  }
  return { x: args.x, y: args.y }
}

function readMutation(value: unknown): AutomationMutationMetadata | undefined {
  if (value === undefined) return undefined
  if (!isUnknownRecord(value)) throw new Error('mutation must be an object.')
  const requestId = readTrimmedString(value.requestId)
  const taskId = readTrimmedString(value.taskId)
  const traceId = readTrimmedString(value.traceId)
  return {
    ...(typeof value.expectedRevision === 'number'
      ? { expectedRevision: value.expectedRevision }
      : {}),
    ...(requestId ? { requestId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  }
}

function readArgs(value: unknown): InsertMermaidArgs {
  if (!isUnknownRecord(value)) {
    throw new Error('Mermaid arguments must be an object.')
  }
  const source = readTrimmedString(value.source)
  const anchorId = readTrimmedString(value.anchor_id)
  const boardName = readTrimmedString(value.board_name)
  const ownerId = readTrimmedString(value.owner_id)
  const projectName = readTrimmedString(value.project_name)
  if (!source) throw new Error('Mermaid source is required.')
  if (projectName && !boardName) {
    throw new Error('board_name is required when project_name is provided.')
  }
  const position = readPosition(value)
  if (anchorId && (ownerId || boardName || position.x !== undefined)) {
    throw new Error('anchor_id cannot be combined with owner_id, board_name, x, or y.')
  }
  return {
    allow_additional_owner: value.allow_additional_owner === true,
    source,
    zoom_to_selection: value.zoom_to_selection !== false,
    ...(anchorId ? { anchor_id: anchorId } : {}),
    ...(boardName ? { board_name: boardName } : {}),
    ...(value.mutation === undefined ? {} : { mutation: readMutation(value.mutation) }),
    ...(ownerId ? { owner_id: ownerId } : {}),
    ...(projectName ? { project_name: projectName } : {}),
    ...position
  }
}

function durableSignatureInput(
  args: InsertMermaidArgs,
  taskId: string | undefined,
  traceId: string | undefined
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    allowAdditionalOwner: args.allow_additional_owner,
    source: args.source,
    zoomToSelection: args.zoom_to_selection
  }
  if (args.anchor_id) input.anchorId = args.anchor_id
  if (args.owner_id) input.ownerId = args.owner_id
  if (taskId) input.taskId = taskId
  if (traceId) input.traceId = traceId
  if (args.x !== undefined) input.x = args.x
  if (args.y !== undefined) input.y = args.y
  return input
}

function durableMutationMetadata(
  expectedRevision: number,
  requestId: string,
  taskId: string | undefined,
  traceId: string | undefined
): DurableMermaidIntent['metadata'] {
  return {
    expectedRevision,
    requestId,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  }
}

async function durableMermaidIntent(args: InsertMermaidArgs): Promise<DurableMermaidIntent> {
  const requestId = args.mutation?.requestId?.trim()
  const expectedRevision = args.mutation?.expectedRevision
  if (!requestId || expectedRevision === undefined) {
    throw new Error('Mermaid mutation requires mutation.requestId and mutation.expectedRevision.')
  }
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    throw new Error('Guarded Mermaid mutation requires a non-negative expected_revision.')
  }
  if (args.board_name || args.project_name) {
    throw new Error(
      'Guarded Mermaid mutation targets the exact current Board. Resolve or create the Board first, then retry without board_name or project_name.'
    )
  }
  const taskId = args.mutation?.taskId?.trim()
  const traceId = args.mutation?.traceId?.trim()
  const route = MERMAID_MUTATION_ROUTE
  const inputDigest = await mutationRequestSignature(
    route,
    durableSignatureInput(args, taskId, traceId)
  )
  return {
    expectedRevision,
    inputDigest,
    metadata: durableMutationMetadata(expectedRevision, requestId, taskId, traceId),
    requestId,
    route,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  }
}

function insertionPosition(
  target: AutomationTarget,
  diagram: MermaidSceneSpec,
  position: Pick<InsertMermaidArgs, 'x' | 'y'>,
  fallback?: Pick<SceneNode, 'x' | 'y'>,
  anchorBounds?: Rect
) {
  if (position.x !== undefined && position.y !== undefined) {
    return { x: position.x, y: position.y }
  }
  if (anchorBounds) {
    return {
      x: anchorBounds.x + anchorBounds.width + GROUNDED_PLACEMENT_GAP,
      y: anchorBounds.y
    }
  }
  if (fallback) return { x: fallback.x, y: fallback.y }
  const center = target.store.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2)
  return {
    x: center.x - diagram.width / 2,
    y: center.y - diagram.height / 2
  }
}

function mermaidOwnerIdsOnBoard(target: AutomationTarget, pageId: string): string[] {
  return target.store.graph
    .getChildren(pageId)
    .filter((node) => mermaidDiagramOwner(target.store.graph, node.id)?.id === node.id)
    .map((node) => node.id)
}

type ResolvedMermaidBoard = {
  boardName: string
  pageId: string
}

function assertAdditionalOwnerAllowed(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  board: ResolvedMermaidBoard
): void {
  if (args.owner_id || args.allow_additional_owner) return
  const ownerIds = mermaidOwnerIdsOnBoard(target, board.pageId)
  if (ownerIds.length === 0) return
  throw new Error(
    `Board "${board.boardName}" already contains Mermaid owner(s): ${ownerIds.join(', ')}. ` +
      'Provide one of these owner_id values to update in place, or set ' +
      'allow_additional_owner: true to intentionally create another diagram.'
  )
}

function resolveExistingOwner(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  board: ResolvedMermaidBoard
): SceneNode | null {
  if (!args.owner_id) return null
  const owner = mermaidDiagramOwner(target.store.graph, args.owner_id)
  if (!owner || owner.id !== args.owner_id || owner.parentId !== board.pageId) {
    throw new Error(`Mermaid owner "${args.owner_id}" was not found on board "${board.boardName}".`)
  }
  const reconciliation = reconcileMermaidDiagramSource(target.store.graph, owner.id)
  if (reconciliation?.status !== 'current') {
    throw new Error(
      `Mermaid owner "${owner.id}" cannot be regenerated because source reconciliation is "${reconciliation?.status ?? 'unknown'}".`
    )
  }
  return owner
}

function selectedAnchorBounds(target: AutomationTarget, anchorId: string): Rect {
  const selectedIds = [...target.store.state.selectedIds]
  if (
    target.store.state.currentPageId !== target.pageId ||
    selectedIds.length !== 1 ||
    selectedIds[0] !== anchorId
  ) {
    throw new Error(
      `Mermaid anchor "${anchorId}" must remain the singleton selection on page "${target.pageName}".`
    )
  }
  const anchor = target.store.graph.getNode(anchorId)
  if (
    !anchor ||
    anchor.type === 'CANVAS' ||
    !target.store.graph.isDescendant(anchor.id, target.pageId)
  ) {
    throw new Error(`Mermaid anchor "${anchorId}" is not a native object on the target page.`)
  }
  return target.store.graph.getAuthoritativeAbsoluteBounds(anchor.id)
}

type MermaidReadback = {
  appearance: string | null
  bounds: Rect
  diagram_id: string | null
  editable_layers: number
  node_ids: string[]
  owner_id: string
  parser: string | null
  reconciliation: {
    message: string
    revision: number
    status: string
  }
  source: string
  source_revision: string | null
}

function readMermaidSource(target: AutomationTarget, ownerId: string): MermaidReadback {
  const owner = mermaidDiagramOwner(target.store.graph, ownerId)
  if (!owner || owner.id !== ownerId || owner.parentId !== target.pageId) {
    throw new Error(`Mermaid owner "${ownerId}" was not found on page "${target.pageName}".`)
  }
  const reconciliation = reconcileMermaidDiagramSource(target.store.graph, ownerId)
  const source = pluginValue(owner, 'mermaid/source')
  if (!source || !reconciliation) {
    throw new Error(`Mermaid source metadata is unavailable for "${ownerId}".`)
  }
  return {
    owner_id: owner.id,
    diagram_id: pluginValue(owner, 'mermaid/diagram-id'),
    source,
    parser: pluginValue(owner, 'mermaid/parser'),
    appearance: pluginValue(owner, 'mermaid/appearance'),
    source_revision: pluginValue(owner, 'mermaid/revision'),
    reconciliation: {
      status: reconciliation.status,
      revision: reconciliation.revision,
      message: reconciliation.message
    },
    editable_layers: owner.childIds.length,
    node_ids: [...owner.childIds],
    bounds: target.store.graph.getAuthoritativeAbsoluteBounds(owner.id)
  }
}

function resultWithReceipt(
  value: Record<string, unknown>,
  receipt: unknown
): Record<string, unknown> {
  return { ...value, mutation_receipt: receipt }
}

function exactCurrentOwner(
  target: AutomationTarget,
  args: InsertMermaidArgs
): { board: ResolvedMermaidBoard; readback: MermaidReadback } | null {
  if (!args.owner_id) return null
  const board: ResolvedMermaidBoard = {
    boardName: target.pageName,
    pageId: target.pageId
  }
  const owner = resolveExistingOwner(target, args, board)
  if (!owner) return null
  const readback = readMermaidSource(target, owner.id)
  return readback.source === args.source ? { board, readback } : null
}

function noChangeValue(board: ResolvedMermaidBoard, readback: MermaidReadback) {
  return {
    applied: false,
    appearance: readback.appearance,
    board,
    diagram_id: readback.diagram_id,
    editable_layers: readback.editable_layers,
    node_ids: readback.node_ids,
    operation: 'no_change',
    owner_id: readback.owner_id,
    parser: readback.parser,
    position: { x: readback.bounds.x, y: readback.bounds.y },
    readback,
    source_attached: true,
    status: {
      attention_required: false,
      command: 'completed',
      mutation: 'no_change'
    }
  }
}

function sameRequestVerifyAction(intent: DurableMermaidIntent) {
  return {
    command: 'board_verify',
    instruction:
      'Reacquire Board context, then verify this same request ID. Do not retry the mutation with a new request ID.',
    request_id: intent.requestId,
    requires_fresh_context: true,
    retry_mutation: false
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function applyResolvedMermaidMutation(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  diagram: MermaidSceneSpec,
  board: ResolvedMermaidBoard,
  anchorBounds?: Rect
): { nodeIds: string[]; value: Record<string, unknown> } {
  assertAdditionalOwnerAllowed(target, args, board)
  const existingOwner = resolveExistingOwner(target, args, board)
  const position = insertionPosition(
    target,
    diagram,
    args,
    existingOwner ?? undefined,
    anchorBounds
  )
  const nodeIds = existingOwner
    ? target.store.replaceMermaidDiagram(existingOwner.id, diagram, position)
    : target.store.insertMermaidDiagram(diagram, position)
  const ownerId = existingOwner?.id ?? [...target.store.state.selectedIds][0]
  if (!ownerId) throw new Error('Mermaid owner identity was not returned after insertion.')
  const readback = readMermaidSource(target, ownerId)
  return {
    nodeIds,
    value: {
      board,
      operation: existingOwner ? 'updated' : 'created',
      editable_layers: readback.editable_layers,
      node_ids: readback.node_ids,
      owner_id: readback.owner_id,
      diagram_id: readback.diagram_id,
      parser: readback.parser,
      appearance: readback.appearance,
      position,
      source_attached: true,
      readback
    }
  }
}

async function finishMermaidMutation(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  nodeIds: string[]
): Promise<void> {
  if (await ensureGraphFonts(target.store.graph, nodeIds)) target.store.requestRender()
  if (args.zoom_to_selection) target.store.zoomToSelection(editorViewportInsets())
}

function replayReceipt(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  receipt: MutationRequestReceipt
): Record<string, unknown> {
  if (receipt.objectIds.length !== 1) {
    throw new Error(`Request "${receipt.requestId}" has an unreadable Mermaid owner receipt.`)
  }
  const ownerId = receipt.objectIds[0]
  const owner = mermaidDiagramOwner(target.store.graph, ownerId)
  const storedResult = isUnknownRecord(receipt.result) ? receipt.result : {}
  const noChange =
    storedResult.operation === 'no_change' || receipt.mutationReceipt.touchedProperties.length === 0
  let readback: MermaidReadback | null = null
  if (owner?.id === ownerId && owner.parentId === target.pageId) {
    readback = readMermaidSource(target, ownerId)
  }
  let liveStatus: 'diverged' | 'missing' | 'present' = 'missing'
  if (readback) {
    liveStatus =
      readback.reconciliation.status === 'current' && readback.source === args.source
        ? 'present'
        : 'diverged'
  }
  const mutationReceipt = {
    ...receipt.mutationReceipt,
    historicalOnly: liveStatus !== 'present',
    historicalStatus: 'applied',
    idempotentReplay: true,
    inputDigest: receipt.inputDigest,
    liveStatus,
    ...(noChange ? { outcome: 'no_change', status: 'no_change' } : {}),
    replayAction: 'none'
  }
  const replayReadback = readback ?? { owner_id: ownerId, missing: true }
  let replayStatus: Record<string, unknown> | null = null
  if (liveStatus === 'present' && noChange) {
    replayStatus = { attention_required: false, command: 'completed', mutation: 'no_change' }
  } else if (liveStatus !== 'present') {
    replayStatus = {
      attention_required: true,
      command: 'unavailable',
      mutation: 'replayed',
      reason: liveStatus === 'missing' ? 'historical_receipt_only' : 'historical_receipt_diverged'
    }
  }
  return {
    ok: true,
    result: {
      ...storedResult,
      applied: noChange ? false : liveStatus === 'present',
      ...(noChange ? { operation: 'no_change' } : {}),
      owner_id: ownerId,
      readback: replayReadback,
      mutation_receipt: mutationReceipt,
      mutation_replay: {
        action: 'none',
        historical: 'applied',
        live: liveStatus,
        readback: replayReadback
      },
      ...(replayStatus ? { status: replayStatus } : {})
    }
  }
}

function assertNoCrossRouteNativeReceipt(target: AutomationTarget, requestId: string): void {
  if (requestNodes(target, requestId).length > 0) {
    throw new Error(`Request "${requestId}" was already used for a different mutation.`)
  }
}

function assertFreshMermaidRequest(target: AutomationTarget, intent: DurableMermaidIntent): void {
  assertMutationRequestIdFresh(target, intent.requestId)
  assertNoCrossRouteNativeReceipt(target, intent.requestId)
}

function reserveDurableMermaidRequest(
  target: AutomationTarget,
  intent: DurableMermaidIntent
): void {
  reserveMutationRequest(target, {
    inputDigest: intent.inputDigest,
    requestId: intent.requestId,
    route: intent.route,
    version: 1
  })
}

function recordAppliedMermaidReceipt(
  target: AutomationTarget,
  intent: DurableMermaidIntent,
  objectId: string,
  result: Record<string, unknown>,
  touchedProperties: string[]
): void {
  recordMutationRequestReceipt(target, {
    inputDigest: intent.inputDigest,
    mutationReceipt: {
      appliedRevision: target.store.state.sceneVersion + 1,
      enqueuedRevision: intent.expectedRevision,
      expectedRevision: intent.expectedRevision,
      requestId: intent.requestId,
      status: 'applied',
      touchedProperties,
      ...(intent.taskId ? { taskId: intent.taskId } : {}),
      ...(intent.traceId ? { traceId: intent.traceId } : {})
    },
    objectIds: [objectId],
    requestId: intent.requestId,
    result,
    route: intent.route,
    semanticIds: [],
    ...(intent.taskId ? { taskId: intent.taskId } : {}),
    ...(intent.traceId ? { traceId: intent.traceId } : {}),
    version: 1
  })
}

function enqueueDurableMermaidMutation<T>(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  intent: DurableMermaidIntent,
  run: () => Promise<T> | T
): Promise<AutomationMutationOutcome<T>> {
  return enqueueAutomationMutation({
    metadata: intent.metadata,
    target,
    toolArgs: { id: args.owner_id ?? target.pageId, source: args.source },
    toolName: MERMAID_MUTATION_ROUTE,
    run
  })
}

function durableMermaidOutcome(
  outcome: AutomationMutationOutcome<Record<string, unknown>>,
  intent: DurableMermaidIntent,
  receiptFields: Record<string, unknown> = {}
): Record<string, unknown> {
  if (outcome.status === 'rejected') {
    return {
      ok: true,
      result: { applied: false, mutation_receipt: outcome.receipt }
    }
  }
  return {
    ok: true,
    result: resultWithReceipt(outcome.value, {
      ...outcome.receipt,
      idempotentReplay: false,
      inputDigest: intent.inputDigest,
      ...receiptFields
    })
  }
}

async function applyDurableMermaidNoChange(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  intent: DurableMermaidIntent,
  options: MermaidHandlerOptions
): Promise<unknown> {
  const outcome = await enqueueDurableMermaidMutation(target, args, intent, async () => {
    assertFreshMermaidRequest(target, intent)
    const current = exactCurrentOwner(target, args)
    if (!current) {
      throw new Error(
        'The Mermaid owner changed before the no-change receipt could be stored. Reacquire Board context.'
      )
    }
    reserveDurableMermaidRequest(target, intent)
    const receiptBarrier = options.beforeMutationReceiptStorage?.()
    if (receiptBarrier) await receiptBarrier
    const value = noChangeValue(current.board, current.readback)
    recordAppliedMermaidReceipt(target, intent, current.readback.owner_id, value, [])
    return value
  })

  return durableMermaidOutcome(outcome, intent, {
    outcome: 'no_change',
    status: 'no_change',
    touchedProperties: []
  })
}

async function applyDurableMermaidMutation(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  diagram: MermaidSceneSpec,
  intent: DurableMermaidIntent,
  options: MermaidHandlerOptions
): Promise<unknown> {
  const outcome = await enqueueDurableMermaidMutation(target, args, intent, async () => {
    assertFreshMermaidRequest(target, intent)
    reserveDurableMermaidRequest(target, intent)
    const board: ResolvedMermaidBoard = {
      boardName: target.pageName,
      pageId: target.pageId
    }
    const anchorBounds = args.anchor_id ? selectedAnchorBounds(target, args.anchor_id) : undefined
    const historyLabel = args.owner_id ? 'Update Mermaid diagram' : 'Insert Mermaid diagram'
    target.store.undo.beginBatch(historyLabel)
    let applied: ReturnType<typeof applyResolvedMermaidMutation>
    try {
      applied = applyResolvedMermaidMutation(target, args, diagram, board, anchorBounds)
      const receiptBarrier = options.beforeMutationReceiptStorage?.()
      if (receiptBarrier) await receiptBarrier
      const readback = applied.value.readback
      if (!isUnknownRecord(readback) || typeof readback.owner_id !== 'string') {
        throw new Error('Mermaid mutation readback did not report its semantic owner.')
      }
      recordAppliedMermaidReceipt(target, intent, readback.owner_id, applied.value, [
        `${target.pageId}:*`
      ])
      target.store.undo.commitBatch()
    } catch (error) {
      target.store.undo.rollbackBatch()
      throw error
    }
    try {
      await (options.finishMutation ?? finishMermaidMutation)(target, args, applied.nodeIds)
      return applied.value
    } catch (error) {
      return {
        ...applied.value,
        applied: true,
        next_action: sameRequestVerifyAction(intent),
        proof: {
          error: errorMessage(error),
          stage: 'finish',
          status: 'error'
        },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: 'applied',
          reason: 'post_apply_finish_failed'
        }
      }
    }
  })

  return durableMermaidOutcome(outcome, intent)
}

export function createAutomationMermaidHandler(
  parseMermaid: typeof parseMermaidInBrowser = parseMermaidInBrowser,
  options: MermaidHandlerOptions = {}
) {
  return async function handleMermaid(target: AutomationTarget, value: unknown): Promise<unknown> {
    const args = readArgs(value)
    const intent = await durableMermaidIntent(args)
    if (!canWriteSmylrProductionDocument(target.store)) {
      throw new Error(
        'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab before mutating it.'
      )
    }
    return coalesceAutomationMutationRequest({
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      run: async () => {
        assertNoCrossRouteNativeReceipt(target, intent.requestId)
        const ledgerState = mutationRequestLedgerState(target, intent.requestId)
        if (ledgerState.status === 'stored') {
          if (
            ledgerState.receipt.route !== intent.route ||
            ledgerState.receipt.inputDigest !== intent.inputDigest
          ) {
            throw new Error(
              `Request "${intent.requestId}" was already used for a different mutation.`
            )
          }
          return replayReceipt(target, args, ledgerState.receipt)
        }
        if (ledgerState.status !== 'missing') {
          throw mutationRequestLedgerError(intent.requestId, ledgerState.status)
        }
        if (args.anchor_id) selectedAnchorBounds(target, args.anchor_id)
        if (exactCurrentOwner(target, args)) {
          return applyDurableMermaidNoChange(target, args, intent, options)
        }
        const diagram = createMermaidSceneSpec(await parseMermaid(args.source))
        return applyDurableMermaidMutation(target, args, diagram, intent, options)
      },
      target
    })
  }
}

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

export function createAutomationMermaidSourceHandler() {
  return async function handleMermaidSource(
    target: AutomationTarget,
    value: unknown
  ): Promise<unknown> {
    if (!isUnknownRecord(value)) {
      throw new Error('Mermaid source arguments must be an object.')
    }
    const ownerId = readTrimmedString(value.owner_id)
    if (!ownerId) throw new Error('owner_id is required.')
    return {
      ok: true,
      result: readMermaidSource(target, ownerId)
    }
  }
}
