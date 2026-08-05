import { IS_BROWSER } from '@open-pencil/core/constants'
import { randomHex } from '@open-pencil/core/random'
import type { Rect, SceneNode } from '@open-pencil/scene-graph'
import {
  cancelEditorPresentationFrame,
  scheduleEditorPresentationFrame,
  type EditorPresentationFrame
} from '@open-pencil/vue/presentation'

import type { AutomationMutationReceipt } from '@/app/automation/bridge/mutation-queue'
import {
  mutationRequestLedgerState,
  mutationRequestLedgerStatus,
  mutationRequestReadback
} from '@/app/automation/bridge/request-receipts'
import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import type { ensureGraphFonts } from '@/app/editor/fonts'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { canWriteSmylrProductionDocument } from '@/app/smylr-production/document-state'

import { createAutomationBoardChangeHandler } from './change-handler'
import { createAutomationConnectObjectsHandler } from './connect-handler'
import { boundedNumber, requiredString, trimmedString } from './input'
import { isNativeCardChange } from './native/card'
import { createAutomationNativeCardChangeHandler } from './native/card-change'
import { nativeReceiptMarker, requestNodes } from './native/receipts'
import {
  boardContextSelectionSnapshot,
  boardContextTargetSnapshot,
  boardNeighborhoodSnapshot,
  finalizeBoardContext,
  jsonUtf8ByteLength
} from './neighborhood'
import { createAutomationObjectEditHandler, isObjectEditChange } from './object-edit'
import { nodeBounds } from './readback'
import { boardAppearanceSnapshot } from './visual-context'

const CONTEXT_LIMIT = 48
const DEFAULT_PAGE_READ_LIMIT = 50
const DEFAULT_SELECTION_READ_LIMIT = 25
const PRESENTATION_TIMEOUT_MS = 1_500
const DEFAULT_BOARD_READ_TOKEN_BUDGET = 2_000
const MAX_BOARD_READ_BYTES = 24_000

type BoardReadProjection = 'detail' | 'geometry' | 'id_only' | 'summary'

type BoardContextRecord = {
  boardRevision: number
  contentDocumentId?: string
  documentId: string
  epoch: number
  pageId: string
  runtimeInstanceId: string
  selectedIds: string[]
  token: string
  workspaceId?: string
}

type StoreEpoch = { value: number }

type BoardBuildBase = {
  content_document_id: string
  context_token: string
  contract: 'board-build/v1'
  document_id: string
  expected_revision: number
  page_id: string
  runtime_instance_id: string
  workspace_id: string
}

type ConnectObjectsBase = Omit<BoardBuildBase, 'contract'>

type BoardPresentationResult = {
  acknowledged: boolean
  frame?: {
    render_version: number
    revision: number
    scene_version: number
    timestamp: number
  }
  intersection: Array<{
    bounds: Rect
    object_id: string
    viewport: 'inside' | 'outside' | 'partial'
  }>
  selected_ids: string[]
  viewport: { pan_x: number; pan_y: number; zoom: number }
}

function selectedIds(target: AutomationTarget): string[] {
  return [...target.store.state.selectedIds]
}

function visibleSelectedIds(target: AutomationTarget): string[] {
  return target.store.state.currentPageId === target.pageId ? selectedIds(target) : []
}

function requestedObjectIds(args: UnknownRecord): string[] {
  if (!Array.isArray(args.object_ids)) {
    throw new Error('board_read objects scope requires an object_ids array.')
  }
  const ids = args.object_ids.map((value) => (typeof value === 'string' ? value.trim() : ''))
  if (ids.length === 0 || ids.length > 25 || ids.some((id) => !id)) {
    throw new Error('board_read object_ids must contain from 1 to 25 non-empty strings.')
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('board_read object_ids must be unique.')
  }
  return ids
}

function objectReadCandidates(target: AutomationTarget, ids: string[]): SceneNode[] {
  const seen = new Set<string>()
  return ids.flatMap((id) => {
    const node = target.store.graph.getNode(id)
    if (
      !node ||
      node.type === 'CANVAS' ||
      !target.store.graph.isDescendant(node.id, target.pageId)
    ) {
      throw new Error(`board_read object_id "${id}" is missing or outside the target page.`)
    }
    return [node, ...target.store.graph.getDescendants(id)].filter((candidate) => {
      if (seen.has(candidate.id)) return false
      seen.add(candidate.id)
      return true
    })
  })
}

function boardReadProjection(args: UnknownRecord): BoardReadProjection {
  const projection = trimmedString(args, 'projection') ?? 'summary'
  if (
    projection !== 'detail' &&
    projection !== 'geometry' &&
    projection !== 'id_only' &&
    projection !== 'summary'
  ) {
    throw new Error('board_read projection must be id_only, summary, geometry, or detail.')
  }
  return projection
}

function boundedPreview(value: string, maximum: number): { text: string; truncated: boolean } {
  return { text: value.slice(0, maximum), truncated: value.length > maximum }
}

function boardReadNode(target: AutomationTarget, node: SceneNode, projection: BoardReadProjection) {
  if (projection === 'id_only') return { id: node.id, type: node.type }
  const name = boundedPreview(node.name, 240)
  const base = {
    bounds: nodeBounds(target, node),
    id: node.id,
    name: name.text,
    name_truncated: name.truncated,
    parent_id: node.parentId,
    type: node.type,
    visible: node.visible
  }
  if (projection === 'geometry') return base
  const text =
    node.type === 'TEXT' ? boundedPreview(node.text, projection === 'detail' ? 2_000 : 512) : null
  return {
    ...base,
    ...(projection === 'detail'
      ? {
          child_count: node.childIds.length,
          child_ids: node.childIds.slice(0, 25),
          child_ids_truncated: node.childIds.length > 25
        }
      : {}),
    ...(text ? { text_preview: text.text, text_truncated: text.truncated } : {})
  }
}

function boardBuildBase(
  target: AutomationTarget,
  context: BoardContextRecord,
  canWrite: boolean
): BoardBuildBase | null {
  if (!canWrite || !target.contentDocumentId || !target.runtimeInstanceId || !target.workspaceId) {
    return null
  }
  return {
    content_document_id: target.contentDocumentId,
    context_token: context.token,
    contract: 'board-build/v1',
    document_id: target.documentId,
    expected_revision: context.boardRevision,
    page_id: target.pageId,
    runtime_instance_id: target.runtimeInstanceId,
    workspace_id: target.workspaceId
  }
}

function connectObjectsBase(buildBase: BoardBuildBase | null): ConnectObjectsBase | null {
  if (!buildBase) return null
  return {
    content_document_id: buildBase.content_document_id,
    context_token: buildBase.context_token,
    document_id: buildBase.document_id,
    expected_revision: buildBase.expected_revision,
    page_id: buildBase.page_id,
    runtime_instance_id: buildBase.runtime_instance_id,
    workspace_id: buildBase.workspace_id
  }
}

function presentationIntersection(
  target: AutomationTarget,
  bounds: Rect
): 'inside' | 'outside' | 'partial' {
  const zoom = target.store.state.zoom
  const left = bounds.x * zoom + target.store.state.panX
  const right = (bounds.x + bounds.width) * zoom + target.store.state.panX
  const top = bounds.y * zoom + target.store.state.panY
  const bottom = (bounds.y + bounds.height) * zoom + target.store.state.panY
  const width = IS_BROWSER ? window.innerWidth : 800
  const height = IS_BROWSER ? window.innerHeight : 600
  if (left >= 0 && top >= 0 && right <= width && bottom <= height) return 'inside'
  if (right <= 0 || bottom <= 0 || left >= width || top >= height) return 'outside'
  return 'partial'
}

async function presentationFrame(
  target: AutomationTarget,
  objectIds: string[],
  options: { minimumScreenTextSize?: number } = {}
): Promise<BoardPresentationResult> {
  if (target.store.state.currentPageId !== target.pageId) {
    throw new Error(
      `Board "${target.pageName}" is not visible; durable mutations may continue, but presentation requires opening that page.`
    )
  }
  if (objectIds.length === 0) throw new Error('board_present requires at least one object ID.')
  for (const id of objectIds) {
    const node = target.store.graph.getNode(id)
    if (!node || !target.store.graph.isDescendant(id, target.pageId)) {
      throw new Error(`Object "${id}" is not on Board "${target.pageName}".`)
    }
  }
  target.store.select(objectIds)
  if (objectIds.length === 1) {
    if (options.minimumScreenTextSize !== undefined) {
      target.store.zoomToReadableSelection(options.minimumScreenTextSize, editorViewportInsets())
    } else {
      target.store.revealNode(objectIds[0], editorViewportInsets())
    }
  } else {
    target.store.zoomToSelection(editorViewportInsets())
  }
  target.store.requestOverlayRepaint()

  let frame: EditorPresentationFrame | null = null
  if (typeof requestAnimationFrame === 'function') {
    let scheduledCallback: (value: EditorPresentationFrame) => void = () => undefined
    const framePromise = new Promise<EditorPresentationFrame>((resolve) => {
      scheduledCallback = resolve
    })
    scheduleEditorPresentationFrame(target.store, scheduledCallback)
    let resolveTimeout: (value: null) => void = () => undefined
    const timeoutPromise = new Promise<null>((resolve) => {
      resolveTimeout = resolve
    })
    const timeout = setTimeout(() => resolveTimeout(null), PRESENTATION_TIMEOUT_MS)
    frame = await Promise.race([framePromise, timeoutPromise])
    clearTimeout(timeout)
    if (!frame) {
      cancelEditorPresentationFrame(target.store, scheduledCallback)
    }
  }
  const bounds = objectIds.map((id) => {
    const node = target.store.graph.getNode(id)
    if (!node) throw new Error(`Object "${id}" disappeared during presentation.`)
    return nodeBounds(target, node)
  })
  return {
    acknowledged: Boolean(frame),
    frame: frame
      ? {
          render_version: frame.renderVersion,
          revision: frame.revision,
          scene_version: frame.sceneVersion,
          timestamp: frame.timestamp
        }
      : undefined,
    intersection: bounds.map((item, index) => ({
      bounds: item,
      object_id: objectIds[index],
      viewport: presentationIntersection(target, item)
    })),
    selected_ids: selectedIds(target),
    viewport: {
      pan_x: target.store.state.panX,
      pan_y: target.store.state.panY,
      zoom: target.store.state.zoom
    }
  }
}

type AutomationBoardHandlerOptions = {
  ensureFonts?: typeof ensureGraphFonts
  fontProofTimeoutMs?: number
}

export function createAutomationBoardHandlers(
  runtimeInstanceId: string,
  options: AutomationBoardHandlerOptions = {}
) {
  const contexts = new Map<string, BoardContextRecord>()
  const storeEpochs = new WeakMap<AutomationTarget['store'], StoreEpoch>()

  function storeEpoch(target: AutomationTarget): StoreEpoch {
    const existing = storeEpochs.get(target.store)
    if (existing) return existing
    const created: StoreEpoch = { value: 0 }
    target.store.onEditorEvent('graph:replaced', () => created.value++)
    storeEpochs.set(target.store, created)
    return created
  }

  function issueContext(target: AutomationTarget) {
    if (target.runtimeInstanceId !== runtimeInstanceId) {
      throw new Error('The resolved Board does not belong to this running client.')
    }
    const pageVisible = target.store.state.currentPageId === target.pageId
    const token = `board-context:${randomHex(16)}`
    const epoch = storeEpoch(target).value
    const record: BoardContextRecord = {
      boardRevision: target.store.state.sceneVersion,
      ...(target.contentDocumentId ? { contentDocumentId: target.contentDocumentId } : {}),
      documentId: target.documentId,
      epoch,
      pageId: target.pageId,
      runtimeInstanceId,
      selectedIds: visibleSelectedIds(target),
      token,
      ...(target.workspaceId ? { workspaceId: target.workspaceId } : {})
    }
    const canWrite = canWriteSmylrProductionDocument(target.store)
    const buildBase = boardBuildBase(target, record, canWrite)
    const connectionBase = connectObjectsBase(buildBase)
    const selection = boardContextSelectionSnapshot(target, record.selectedIds)
    const neighborhood = boardNeighborhoodSnapshot(target, record.selectedIds)
    const contextTarget = boardContextTargetSnapshot(target)
    const result = finalizeBoardContext(
      {
        appearance: boardAppearanceSnapshot(target),
        ...(buildBase ? { board_build_base: buildBase } : {}),
        ...(connectionBase ? { connect_objects_base: connectionBase } : {}),
        capabilities: [
          'board.read.selection',
          'board.read.page',
          'board.read.objects',
          ...(canWrite
            ? [
                'board.build.native_text',
                'board.build.native_card',
                'board.build.plan.v1',
                'board.build.plan.grid.v1',
                'board.build.plan.flow.v1',
                'board.build.transaction.revert.v1',
                'board.build.native_diagram.mermaid',
                'board.build.code_object.tsx.create',
                'board.build.code_object.tsx.refine',
                'board.change.artifact.create.native_text',
                'board.change.artifact.create.native_text.visual.local_legible_text_v1',
                'board.change.artifact.create.native_card',
                'board.change.artifact.create.native_card.visual.local_legible_card_v1',
                'board.change.object.update',
                'board.change.object.move',
                'board.change.object.resize',
                'board.change.object.delete',
                'board.change.object.duplicate',
                'board.change.object_graph.connect'
              ]
            : []),
          ...(pageVisible ? ['board.present'] : []),
          'board.verify.request'
        ],
        context_token: token,
        neighborhood,
        request_ledger: mutationRequestLedgerStatus(target.store.graph.getNode(target.pageId)),
        revisions: {
          board: record.boardRevision,
          presentation: target.store.state.renderVersion,
          selection: `selection:${randomHex(8)}`
        },
        runtime: {
          instance_id: runtimeInstanceId,
          page_visibility: pageVisible ? 'visible' : 'background',
          write_authority: canWrite ? 'writer' : 'viewer',
          visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState
        },
        ...selection,
        target: contextTarget.target,
        viewport: {
          pan_x: target.store.state.panX,
          pan_y: target.store.state.panY,
          zoom: target.store.state.zoom
        }
      },
      {
        neighborhoodNodes: neighborhood.omitted.nodes,
        neighborhoodUnscannedPageRootChildren: neighborhood.omitted.unscanned_page_root_children,
        selectionNodes: selection.selection_summary.omitted.nodes,
        targetStringBytes: contextTarget.omittedBytes,
        targetStringCodeUnits: contextTarget.omittedCodeUnits,
        truncated: neighborhood.truncated || selection.selection_summary.truncated
      }
    )
    contexts.set(token, record)
    while (contexts.size > CONTEXT_LIMIT) {
      const oldest = contexts.keys().next().value
      if (typeof oldest !== 'string') break
      contexts.delete(oldest)
    }
    return result
  }

  function requireContext(
    target: AutomationTarget,
    rawArgs: unknown
  ): { args: UnknownRecord; context: BoardContextRecord } {
    if (!isUnknownRecord(rawArgs)) throw new Error('Board tool arguments must be an object.')
    const token = requiredString(rawArgs, 'context_token')
    const context = contexts.get(token)
    if (!context) throw new Error('Board context is missing or expired. Call board_context again.')
    const currentWorkspaceId = target.workspaceId
    if (
      context.runtimeInstanceId !== runtimeInstanceId ||
      target.runtimeInstanceId !== runtimeInstanceId ||
      context.contentDocumentId !== target.contentDocumentId ||
      context.documentId !== target.documentId ||
      context.pageId !== target.pageId ||
      context.workspaceId !== currentWorkspaceId ||
      context.epoch !== storeEpoch(target).value
    ) {
      throw new Error('Board context changed. Reacquire context; do not retarget the operation.')
    }
    return { args: rawArgs, context }
  }

  const connect = createAutomationConnectObjectsHandler({
    issueContext,
    presentationFrame,
    requireContext
  })

  const nativeTextChange = createAutomationBoardChangeHandler({
    ...(options.ensureFonts ? { ensureFonts: options.ensureFonts } : {}),
    ...(options.fontProofTimeoutMs === undefined
      ? {}
      : { fontProofTimeoutMs: options.fontProofTimeoutMs }),
    issueContext,
    presentationFrame,
    requireContext
  })
  const nativeCardChange = createAutomationNativeCardChangeHandler({
    ...(options.ensureFonts ? { ensureFonts: options.ensureFonts } : {}),
    ...(options.fontProofTimeoutMs === undefined
      ? {}
      : { fontProofTimeoutMs: options.fontProofTimeoutMs }),
    issueContext,
    presentationFrame,
    requireContext
  })
  const objectEdit = createAutomationObjectEditHandler({
    issueContext,
    presentationFrame,
    requireContext
  })
  const change = (target: AutomationTarget, rawArgs: unknown) => {
    if (isObjectEditChange(rawArgs)) return objectEdit(target, rawArgs)
    if (isNativeCardChange(rawArgs)) return nativeCardChange(target, rawArgs)
    return nativeTextChange(target, rawArgs)
  }

  return {
    context(target: AutomationTarget) {
      return Promise.resolve(issueContext(target))
    },

    read(target: AutomationTarget, rawArgs: unknown) {
      const { args } = requireContext(target, rawArgs)
      const scope = trimmedString(args, 'scope') ?? 'selection'
      if (scope !== 'selection' && scope !== 'page' && scope !== 'objects') {
        throw new Error('board_read scope must be "selection", "page", or "objects".')
      }
      const limit = boundedNumber(
        args.limit,
        scope === 'selection' ? DEFAULT_SELECTION_READ_LIMIT : DEFAULT_PAGE_READ_LIMIT,
        1,
        100
      )
      const projection = boardReadProjection(args)
      const tokenBudget = boundedNumber(
        args.token_budget,
        DEFAULT_BOARD_READ_TOKEN_BUDGET,
        256,
        6_000
      )
      const byteLimit = Math.min(MAX_BOARD_READ_BYTES, tokenBudget * 4)
      const objectIds = scope === 'objects' ? requestedObjectIds(args) : undefined
      const currentSelection = visibleSelectedIds(target)
      let candidates: SceneNode[]
      if (objectIds) {
        candidates = objectReadCandidates(target, objectIds)
      } else if (scope === 'selection') {
        candidates = currentSelection.flatMap((id) => {
          const node = target.store.graph.getNode(id)
          return node ? [node] : []
        })
      } else {
        candidates = [...target.store.graph.getDescendants(target.pageId)]
      }
      const nodes: ReturnType<typeof boardReadNode>[] = []
      for (const candidate of candidates.slice(0, limit)) {
        const projected = boardReadNode(target, candidate, projection)
        if (jsonUtf8ByteLength([...nodes, projected]) > byteLimit) break
        nodes.push(projected)
      }
      return Promise.resolve({
        board_revision: target.store.state.sceneVersion,
        byte_limit: byteLimit,
        count: candidates.length,
        limit,
        ...(objectIds ? { requested_object_ids: objectIds } : {}),
        ...(scope === 'selection'
          ? { neighborhood: boardNeighborhoodSnapshot(target, currentSelection) }
          : {}),
        nodes,
        projection,
        scope,
        token_budget: tokenBudget,
        truncated: candidates.length > nodes.length,
        truncation_reason:
          candidates.length <= nodes.length
            ? null
            : nodes.length >= limit
              ? 'limit'
              : 'token_budget'
      })
    },

    connect,

    change,

    async present(target: AutomationTarget, rawArgs: unknown) {
      const { args } = requireContext(target, rawArgs)
      const objectIds = Array.isArray(args.object_ids)
        ? args.object_ids.filter((value): value is string => typeof value === 'string')
        : []
      return {
        presentation: await presentationFrame(target, objectIds),
        status: { command: 'completed', mutation: 'not_applicable' }
      }
    },

    verify(target: AutomationTarget, rawArgs: unknown) {
      const { args } = requireContext(target, rawArgs)
      const requestId = requiredString(args, 'request_id')
      let nativeMatches
      try {
        nativeMatches = requestNodes(target, requestId)
      } catch {
        return Promise.resolve({
          board_revision: target.store.state.sceneVersion,
          reason: 'native_request_receipt_unreadable',
          status: 'error'
        })
      }
      const ledgerState = mutationRequestLedgerState(target, requestId)
      if (
        ledgerState.status === 'expired' ||
        ledgerState.status === 'pending' ||
        ledgerState.status === 'saturated' ||
        ledgerState.status === 'unreadable'
      ) {
        return Promise.resolve({
          board_revision: target.store.state.sceneVersion,
          reason: `request_ledger_${ledgerState.status}`,
          status: 'error'
        })
      }
      if (ledgerState.status === 'stored') {
        if (nativeMatches.length > 1) {
          return Promise.resolve({
            board_revision: target.store.state.sceneVersion,
            node_ids: nativeMatches.map((node) => node.id),
            reason: 'duplicate_native_request_receipts',
            status: 'ambiguous'
          })
        }
        const nativeMarker = nativeMatches[0] ? nativeReceiptMarker(nativeMatches[0]) : null
        if (
          nativeMarker &&
          (nativeMarker.route !== ledgerState.receipt.route ||
            nativeMarker.inputDigest !== ledgerState.receipt.inputDigest)
        ) {
          return Promise.resolve({
            board_revision: target.store.state.sceneVersion,
            reason: 'conflicting_request_receipts',
            status: 'error'
          })
        }
        return Promise.resolve({
          board_revision: target.store.state.sceneVersion,
          readback: mutationRequestReadback(target, ledgerState.receipt),
          receipt: ledgerState.receipt,
          status: 'matched'
        })
      }
      if (nativeMatches.length > 0) {
        return Promise.resolve({
          board_revision: target.store.state.sceneVersion,
          node_ids: nativeMatches.map((node) => node.id),
          reason: 'native_receipt_missing_durable_ledger',
          status: 'error'
        })
      }
      return Promise.resolve({
        board_revision: target.store.state.sceneVersion,
        reason: 'request_not_found',
        status: 'empty'
      })
    }
  }
}

export type AutomationBoardHandlers = ReturnType<typeof createAutomationBoardHandlers>
export type BoardChangeReceipt = AutomationMutationReceipt
