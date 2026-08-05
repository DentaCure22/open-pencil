import {
  CODE_OBJECT_KIND,
  CODE_OBJECT_PLUGIN_ID,
  codeObjectViewportPluginData,
  isCodeObjectViewportPresetId,
  type CodeObjectViewportPresetId
} from '@open-pencil/core/code-object'
import { colorToFill } from '@open-pencil/core/color'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  coalesceAutomationMutationRequest,
  type AutomationMutationReceipt
} from '@/app/automation/bridge/mutation-queue'
import { requestAutomationPersistence } from '@/app/automation/bridge/persistence'
import type { MutationRequestReceipt } from '@/app/automation/bridge/request-receipts'
import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import { canWriteSmylrProductionDocument } from '@/app/smylr-production/document-state'

import {
  assertNativeMutationReady,
  enqueueNativeArtifactMutation,
  nativeMutationIdentity,
  readyNativeMutationLedger,
  replayNativeMutationReceipt,
  reserveNativeMutation,
  storeNativeMutationReceipt,
  validateNativeMutationContext,
  type NativeBoardContext,
  type NativeMutationIdentity
} from './native/mutation'
import { nodeSummary } from './readback'

const MAX_COORDINATE = 1_000_000
const MAX_SIZE = 100_000
const RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'

type ObjectPatch = {
  cornerRadius?: number
  fill?: string
  locked?: boolean
  name?: string
  opacity?: number
  text?: string
  visible?: boolean
}

export type ObjectEditOperation =
  | { kind: 'object.delete'; objectId: string }
  | { kind: 'object.duplicate'; objectId: string; offsetX: number; offsetY: number }
  | { kind: 'object.move'; objectId: string; x: number; y: number }
  | {
      height: number
      kind: 'object.resize'
      objectId: string
      viewportPreset?: CodeObjectViewportPresetId
      width: number
    }
  | { kind: 'object.update'; objectId: string; patch: ObjectPatch }

type ObjectEditIntent = NativeMutationIdentity & { operation: ObjectEditOperation }

type PresentationResult = {
  acknowledged: boolean
  selected_ids?: string[]
}

type ObjectEditOptions = {
  issueContext: (target: AutomationTarget) => unknown
  presentationFrame: (target: AutomationTarget, objectIds: string[]) => Promise<PresentationResult>
  requireContext: (
    target: AutomationTarget,
    rawArgs: unknown
  ) => { args: UnknownRecord; context: NativeBoardContext }
}

const OPERATION_KEYS = {
  'object.delete': new Set(['kind', 'object_id']),
  'object.duplicate': new Set(['kind', 'object_id', 'offset_x', 'offset_y']),
  'object.move': new Set(['kind', 'object_id', 'x', 'y']),
  'object.resize': new Set(['height', 'kind', 'object_id', 'viewport_preset', 'width']),
  'object.update': new Set(['kind', 'object_id', 'patch'])
} as const
const PATCH_KEYS = new Set(['cornerRadius', 'fill', 'locked', 'name', 'opacity', 'text', 'visible'])

function assertOnlyKeys(value: UnknownRecord, allowed: ReadonlySet<string>, label: string): void {
  const unsupported = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort()
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unsupported.join(', ')}.`)
  }
}

function stringValue(value: UnknownRecord, field: string, maximum = 240): string {
  const candidate = value[field]
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error(`${field} is required.`)
  const trimmed = candidate.trim()
  if (trimmed.length > maximum) {
    throw new Error(`${field} must contain at most ${maximum} characters.`)
  }
  return trimmed
}

function numberValue(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

function parsePatch(value: unknown): ObjectPatch {
  if (!isUnknownRecord(value)) throw new Error('object.update patch must be an object.')
  assertOnlyKeys(value, PATCH_KEYS, 'object.update patch')
  if (Object.keys(value).length === 0) throw new Error('object.update patch cannot be empty.')
  const patch: ObjectPatch = {}
  if (value.cornerRadius !== undefined) {
    patch.cornerRadius = numberValue(value.cornerRadius, 'patch.cornerRadius', 0, MAX_SIZE)
  }
  if (value.fill !== undefined) patch.fill = stringValue(value, 'fill', 32)
  if (value.name !== undefined) patch.name = stringValue(value, 'name')
  if (value.text !== undefined) patch.text = stringValue(value, 'text', 10_000)
  for (const field of ['locked', 'visible'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') {
      throw new TypeError(`patch.${field} must be boolean.`)
    }
  }
  if (typeof value.locked === 'boolean') patch.locked = value.locked
  if (typeof value.visible === 'boolean') patch.visible = value.visible
  if (value.opacity !== undefined) {
    patch.opacity = numberValue(value.opacity, 'patch.opacity', 0, 1)
  }
  return patch
}

export function parseObjectEditOperation(value: unknown): ObjectEditOperation {
  if (!isUnknownRecord(value) || typeof value.kind !== 'string') {
    throw new Error('board edit operation must be an object with a supported kind.')
  }
  if (!(value.kind in OPERATION_KEYS)) {
    throw new Error(`Unsupported board edit operation "${value.kind}".`)
  }
  const kind = value.kind as keyof typeof OPERATION_KEYS
  assertOnlyKeys(value, OPERATION_KEYS[kind], kind)
  const objectId = stringValue(value, 'object_id')
  if (kind === 'object.update') return { kind, objectId, patch: parsePatch(value.patch) }
  if (kind === 'object.move') {
    return {
      kind,
      objectId,
      x: numberValue(value.x, 'x', -MAX_COORDINATE, MAX_COORDINATE),
      y: numberValue(value.y, 'y', -MAX_COORDINATE, MAX_COORDINATE)
    }
  }
  if (kind === 'object.resize') {
    if (
      value.viewport_preset !== undefined &&
      !isCodeObjectViewportPresetId(value.viewport_preset)
    ) {
      throw new Error('viewport_preset must be desktop, laptop, tablet, or phone.')
    }
    return {
      height: numberValue(value.height, 'height', 1, MAX_SIZE),
      kind,
      objectId,
      ...(isCodeObjectViewportPresetId(value.viewport_preset)
        ? { viewportPreset: value.viewport_preset }
        : {}),
      width: numberValue(value.width, 'width', 1, MAX_SIZE)
    }
  }
  if (kind === 'object.duplicate') {
    return {
      kind,
      objectId,
      offsetX:
        value.offset_x === undefined
          ? 20
          : numberValue(value.offset_x, 'offset_x', -10_000, 10_000),
      offsetY:
        value.offset_y === undefined ? 20 : numberValue(value.offset_y, 'offset_y', -10_000, 10_000)
    }
  }
  return { kind, objectId }
}

export function isObjectEditChange(value: unknown): boolean {
  if (!isUnknownRecord(value) || !isUnknownRecord(value.operation)) return false
  return typeof value.operation.kind === 'string' && value.operation.kind in OPERATION_KEYS
}

async function objectEditIntent(args: UnknownRecord): Promise<ObjectEditIntent> {
  const operation = parseObjectEditOperation(args.operation)
  return { ...(await nativeMutationIdentity(args, { operation })), operation }
}

function isCodeObject(node: SceneNode): boolean {
  return node.pluginData.some(
    (entry) =>
      entry.pluginId === CODE_OBJECT_PLUGIN_ID &&
      entry.key === 'kind' &&
      entry.value === CODE_OBJECT_KIND
  )
}

function editableNode(target: AutomationTarget, operation: ObjectEditOperation): SceneNode {
  const node = target.store.graph.getNode(operation.objectId)
  if (!node || node.parentId !== target.pageId || node.type === 'CANVAS') {
    throw new Error(
      `Native object "${operation.objectId}" is not a top-level object on Board "${target.pageId}".`
    )
  }
  if (isCodeObject(node)) {
    if (operation.kind === 'object.update' || operation.kind === 'object.duplicate') {
      throw new Error(
        `Object "${node.id}" is a Code Object; use the Code Object contract for content or identity changes.`
      )
    }
  } else if (operation.kind === 'object.resize' && operation.viewportPreset) {
    throw new Error(`Object "${node.id}" is not a Code Object; viewport_preset is unsupported.`)
  }
  if (node.locked && !(operation.kind === 'object.update' && operation.patch.locked === false)) {
    throw new Error(`Object "${node.id}" is locked.`)
  }
  return node
}

export function assertObjectEditOperationReady(
  target: AutomationTarget,
  operation: ObjectEditOperation
): SceneNode {
  const node = editableNode(target, operation)
  if (operation.kind === 'object.update') updateChanges(node, operation.patch)
  return node
}

function updateChanges(node: SceneNode, patch: ObjectPatch): Partial<SceneNode> {
  if (patch.text !== undefined && node.type !== 'TEXT') {
    throw new Error('patch.text is supported only for a native TEXT object.')
  }
  return {
    ...(patch.cornerRadius === undefined ? {} : { cornerRadius: patch.cornerRadius }),
    ...(patch.fill === undefined ? {} : { fills: [colorToFill(patch.fill)] }),
    ...(patch.locked === undefined ? {} : { locked: patch.locked }),
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
    ...(patch.text === undefined ? {} : { text: patch.text }),
    ...(patch.visible === undefined ? {} : { visible: patch.visible })
  }
}

function changesFor(node: SceneNode, operation: ObjectEditOperation): Partial<SceneNode> | null {
  if (operation.kind === 'object.update') return updateChanges(node, operation.patch)
  if (operation.kind === 'object.move') return { x: operation.x, y: operation.y }
  if (operation.kind === 'object.resize') {
    const pluginData = isCodeObject(node)
      ? codeObjectViewportPluginData(node, operation.viewportPreset ?? null)
      : null
    return {
      height: operation.height,
      ...(pluginData ? { pluginData } : {}),
      width: operation.width
    }
  }
  return null
}

function isNoChange(node: SceneNode, operation: ObjectEditOperation): boolean {
  const changes = changesFor(node, operation)
  return Boolean(
    changes &&
    Object.entries(changes).every(([key, value]) => node[key as keyof SceneNode] === value)
  )
}

function objectReadback(target: AutomationTarget, node: SceneNode) {
  return {
    ...nodeSummary(target, node),
    cornerRadius: node.cornerRadius,
    fills: node.fills,
    locked: node.locked,
    opacity: node.opacity
  }
}

function stripCopiedReceipts(target: AutomationTarget, ownerId: string): void {
  const nodes = [target.store.graph.getNode(ownerId), ...target.store.graph.getDescendants(ownerId)]
  for (const node of nodes) {
    if (!node) continue
    const pluginData = node.pluginData.filter((entry) => entry.pluginId !== RECEIPT_PLUGIN_ID)
    if (pluginData.length === node.pluginData.length) continue
    target.store.updateNodeWithUndo(node.id, { pluginData }, 'Agent: duplicate native object')
  }
}

export function applyObjectEditOperationInBatch(
  target: AutomationTarget,
  operation: ObjectEditOperation,
  historyLabel = 'Agent: build Board plan'
): {
  after: UnknownRecord
  effect: 'already_satisfied' | 'would_change'
  historyLabel: string
  resultObjectId: string | null
} {
  const node = editableNode(target, operation)
  let resultObjectId: string | null = node.id
  const changes = changesFor(node, operation)
  const alreadySatisfied = isNoChange(node, operation)
  if (changes && !alreadySatisfied) {
    target.store.updateNodeWithUndo(node.id, changes, historyLabel)
  } else if (!changes) {
    target.store.select([node.id])
    if (operation.kind === 'object.delete') {
      target.store.deleteSelected()
      resultObjectId = null
    } else {
      if (operation.kind !== 'object.duplicate') {
        throw new Error(`Unsupported object edit operation "${operation.kind}".`)
      }
      target.store.duplicateSelected()
      const duplicateIds = [...target.store.state.selectedIds].filter((id) => id !== node.id)
      if (duplicateIds.length !== 1) throw new Error(`Object "${node.id}" could not be duplicated.`)
      resultObjectId = duplicateIds[0]
      const duplicate = target.store.graph.getNode(resultObjectId)
      if (!duplicate) throw new Error(`Object "${node.id}" could not be duplicated.`)
      target.store.updateNodeWithUndo(
        duplicate.id,
        { x: node.x + operation.offsetX, y: node.y + operation.offsetY },
        historyLabel
      )
      stripCopiedReceipts(target, duplicate.id)
    }
  }
  const resultNode = resultObjectId ? target.store.graph.getNode(resultObjectId) : null
  let after: UnknownRecord
  if (operation.kind === 'object.delete') {
    after = { deleted: true, id: node.id }
  } else if (resultNode) {
    after = objectReadback(target, resultNode)
  } else {
    after = { id: resultObjectId, missing: true }
  }
  return {
    after,
    effect: alreadySatisfied ? 'already_satisfied' : 'would_change',
    historyLabel,
    resultObjectId
  }
}

function applyOperation(
  target: AutomationTarget,
  operation: ObjectEditOperation
): { after: UnknownRecord; historyLabel: string; resultObjectId: string | null } {
  const node = editableNode(target, operation)
  const label = `Agent: ${operation.kind.replace('object.', '')} ${isCodeObject(node) ? 'Code Object' : 'native object'}`
  let result: ReturnType<typeof applyObjectEditOperationInBatch> | undefined
  target.store.undo.runBatch(label, () => {
    result = applyObjectEditOperationInBatch(target, operation, label)
  })
  if (!result) throw new Error(`Object edit operation "${operation.kind}" did not run.`)
  return result
}

function storedResult(receipt: MutationRequestReceipt): {
  after: UnknownRecord
  result_object_id: string | null
} | null {
  if (!isUnknownRecord(receipt.result) || !isUnknownRecord(receipt.result.after)) return null
  const resultObjectId = receipt.result.result_object_id
  if (resultObjectId !== null && typeof resultObjectId !== 'string') return null
  return { after: receipt.result.after, result_object_id: resultObjectId }
}

function reconciliation(
  target: AutomationTarget,
  intent: ObjectEditIntent,
  stored: { after: UnknownRecord; result_object_id: string | null }
) {
  const candidate = stored.result_object_id
    ? target.store.graph.getNode(stored.result_object_id)
    : target.store.graph.getNode(intent.operation.objectId)
  if (intent.operation.kind === 'object.delete') {
    return {
      current: !candidate,
      readback: {
        expected: stored.after,
        reconciliation: {
          reasons: candidate ? ['deleted_object_present'] : [],
          status: candidate ? 'diverged' : 'current'
        }
      },
      resultNode: null
    }
  }
  if (!candidate || candidate.parentId !== target.pageId) {
    return {
      current: false,
      readback: {
        expected: stored.after,
        object: { id: stored.result_object_id },
        reconciliation: { reasons: ['result_object_missing'], status: 'missing' }
      },
      resultNode: null
    }
  }
  const current = objectReadback(target, candidate)
  const matches = JSON.stringify(current) === JSON.stringify(stored.after)
  return {
    current: matches,
    readback: {
      expected: stored.after,
      object: current,
      reconciliation: {
        reasons: matches ? [] : ['object_changed'],
        status: matches ? 'current' : 'diverged'
      }
    },
    resultNode: candidate
  }
}

function mutationReceipt(
  receipt: AutomationMutationReceipt,
  intent: ObjectEditIntent,
  historyLabel: string,
  resultObjectId: string | null
) {
  return {
    ...receipt,
    history_label: historyLabel,
    idempotent_replay: false,
    operation: intent.operation.kind,
    product_grade_path: true,
    ...(resultObjectId
      ? { semantic_owner: { owner_id: resultObjectId, root_object_id: resultObjectId } }
      : {})
  }
}

async function provenResult(options: {
  intent: ObjectEditIntent
  mutation: 'applied' | 'replayed'
  readback: UnknownRecord
  receipt: UnknownRecord
  resultNode: SceneNode | null
  target: AutomationTarget
  tools: ObjectEditOptions
}) {
  const presentation = options.resultNode
    ? await options.tools.presentationFrame(options.target, [options.resultNode.id])
    : { reason: 'object_deleted', status: 'not_applicable' }
  const persistence = await requestAutomationPersistence(
    options.target.store,
    options.target.store.state.sceneVersion
  )
  const context = options.tools.issueContext(options.target)
  const presentationAcknowledged =
    !options.resultNode || ('acknowledged' in presentation && presentation.acknowledged)
  const completed = persistence.status === 'durable' && presentationAcknowledged
  return {
    context,
    execution_surface: 'live_browser',
    owner_id: options.resultNode?.id ?? null,
    persistence,
    presentation,
    readback: { object_edit: options.readback },
    receipt: options.receipt,
    ...(completed
      ? {}
      : {
          next_action: {
            command: 'board_verify',
            instruction:
              'Reacquire Board context and verify this same request ID. Do not retry with a new request ID.',
            request_id: options.intent.requestId,
            requires_fresh_context: true,
            retry_mutation: false
          },
          proof: {
            reason:
              persistence.status === 'durable'
                ? 'presentation_not_acknowledged'
                : 'persistence_not_acknowledged',
            stage: persistence.status === 'durable' ? 'presentation' : 'persistence',
            status: 'partial'
          }
        }),
    status: completed
      ? { attention_required: false, command: 'completed', mutation: options.mutation }
      : {
          attention_required: true,
          command: 'unavailable',
          mutation: options.mutation,
          reason:
            persistence.status === 'durable'
              ? 'presentation_not_acknowledged'
              : 'persistence_not_acknowledged'
        }
  }
}

async function replayResult(
  target: AutomationTarget,
  intent: ObjectEditIntent,
  receipt: MutationRequestReceipt,
  options: ObjectEditOptions
) {
  const stored = storedResult(receipt)
  if (!stored) throw new Error('Stored object edit receipt is unreadable.')
  const current = reconciliation(target, intent, stored)
  const replayReceipt = {
    ...replayNativeMutationReceipt(receipt, current.resultNode?.id),
    historical_only: !current.current,
    operation: intent.operation.kind
  }
  if (!current.current) {
    return {
      context: options.issueContext(target),
      execution_surface: 'live_browser',
      owner_id: current.resultNode?.id ?? null,
      readback: { object_edit: current.readback },
      receipt: replayReceipt,
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'object_edit_not_current'
      }
    }
  }
  return provenResult({
    intent,
    mutation: 'replayed',
    readback: current.readback,
    receipt: replayReceipt,
    resultNode: current.resultNode,
    target,
    tools: options
  })
}

export function createAutomationObjectEditHandler(options: ObjectEditOptions) {
  return async function objectEdit(target: AutomationTarget, rawArgs: unknown) {
    const { args, context } = options.requireContext(target, rawArgs)
    if (!canWriteSmylrProductionDocument(target.store)) {
      throw new Error(
        'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab, then reacquire Board context.'
      )
    }
    const intent = await objectEditIntent(args)
    return coalesceAutomationMutationRequest({
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      target,
      run: async () => {
        const ledger = readyNativeMutationLedger(target, intent)
        if (ledger.status === 'stored') return replayResult(target, intent, ledger.receipt, options)
        const node = editableNode(target, intent.operation)
        if (isNoChange(node, intent.operation)) {
          validateNativeMutationContext(target, args, context, { kind: 'free' })
          assertNativeMutationReady(target, intent, { kind: 'free' })
          return {
            context: options.issueContext(target),
            execution_surface: 'live_browser',
            owner_id: node.id,
            readback: { object_edit: { object: objectReadback(target, node) } },
            receipt: {
              idempotent_replay: false,
              operation: intent.operation.kind,
              requestId: intent.requestId,
              status: 'no_change'
            },
            status: { attention_required: false, command: 'completed', mutation: 'no_change' }
          }
        }
        const outcome = await enqueueNativeArtifactMutation({
          args,
          context,
          existing: null,
          guard: { kind: 'free' },
          intent,
          run: (expectedRevision) => {
            assertNativeMutationReady(target, intent, { kind: 'free' })
            reserveNativeMutation(target, intent)
            const applied = applyOperation(target, intent.operation)
            storeNativeMutationReceipt({
              expectedRevision,
              intent,
              objectIds: [intent.operation.objectId],
              result: {
                after: applied.after,
                history_label: applied.historyLabel,
                object_id: intent.operation.objectId,
                operation: intent.operation.kind,
                result_object_id: applied.resultObjectId
              },
              target
            })
            return applied
          },
          target,
          toolArgs: { id: intent.operation.objectId }
        })
        if (outcome.status === 'rejected') {
          return {
            receipt: outcome.receipt,
            status: {
              attention_required: true,
              command: 'refused',
              mutation: 'not_applied'
            }
          }
        }
        const current = reconciliation(target, intent, {
          after: outcome.value.after,
          result_object_id: outcome.value.resultObjectId
        })
        if (!current.current)
          throw new Error('Applied object edit did not reconcile with readback.')
        return provenResult({
          intent,
          mutation: 'applied',
          readback: current.readback,
          receipt: mutationReceipt(
            outcome.receipt,
            intent,
            outcome.value.historyLabel,
            outcome.value.resultObjectId
          ),
          resultNode: current.resultNode,
          target,
          tools: options
        })
      }
    })
  }
}
