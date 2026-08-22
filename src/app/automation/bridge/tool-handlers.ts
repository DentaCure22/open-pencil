import { renderTreeNode } from '@open-pencil/core/design-jsx'
import type { FigmaAPI } from '@open-pencil/core/figma-api'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { ALL_TOOLS, type ToolDef } from '@open-pencil/core/tools'
import type { JsonObject, Rect } from '@open-pencil/scene-graph/primitives'

import {
  automationMutationPropertyPaths,
  coalesceAutomationMutationRequest,
  enqueueAutomationMutation,
  type AutomationMutationMetadata
} from '@/app/automation/bridge/mutation-queue'
import { automationNodeSummary } from '@/app/automation/bridge/node-summary'
import {
  assertMutationRequestIdFresh,
  mutationRequestLedgerSnapshot,
  mutationRequestReceiptsById,
  mutationRequestSignature,
  recordMutationRequestReceipt,
  reserveMutationRequest,
  restoreMutationRequestLedger
} from '@/app/automation/bridge/request-receipts'
import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { canWriteSmylrProductionDocument } from '@/app/smylr-production/document-state'

type FigmaFactory = (store: AutomationTarget['store'], pageId?: string) => FigmaAPI
type ToolMutationGuard = {
  expectedRevision: number
  inputDigest: string
  metadata: AutomationMutationMetadata
  requestId: string
  route: string
  touchedProperties: string[]
}

type MutationReplayLiveStatus = 'diverged' | 'missing' | 'present'
type AutomationToolHandlerOptions = {
  beforeMutationReceiptStorage?: () => Promise<void> | void
}
type StartedToolDefinition = {
  figma: FigmaAPI | null
  postProcessed: boolean
  result: unknown
}

const ASYNC_MUTATING_TOOL_NAMES = new Set([
  'eval',
  'import_svg',
  'insert_icon',
  'node_replace_with',
  'render',
  'stock_photo'
])

function readViewportBounds(result: unknown): Rect | null {
  if (!result || typeof result !== 'object') return null
  const bounds = (result as JsonObject).bounds
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) return null
  const candidate = bounds as JsonObject
  const { height, width, x, y } = candidate
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number'
  ) {
    return null
  }
  return { height, width, x, y }
}

export async function syncAutomationToolState(
  store: AutomationTarget['store'],
  figma: FigmaAPI,
  toolName: string,
  result: unknown
) {
  if (store.state.currentPageId !== figma.currentPageId) {
    await store.switchPage(figma.currentPageId)
  }

  store.select(figma.currentPage.selection.map((node) => node.id))

  if (toolName === 'viewport_zoom_to_fit') {
    const bounds = readViewportBounds(result)
    if (bounds) {
      store.zoomToBounds(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height)
    }
  }
}

async function toolMutationGuard(
  target: AutomationTarget,
  toolName: string,
  toolArgs: Record<string, unknown>,
  metadata: AutomationMutationMetadata | undefined
): Promise<ToolMutationGuard> {
  const requestId = metadata?.requestId?.trim()
  const expectedRevision = metadata?.expectedRevision
  if (!requestId) {
    throw new Error(`Mutating tool "${toolName}" requires a stable request_id.`)
  }
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    throw new Error(`Mutating tool "${toolName}" requires a non-negative expected_revision.`)
  }
  const route = `tool:${toolName}`
  return {
    expectedRevision,
    inputDigest: await mutationRequestSignature(route, {
      args: toolArgs,
      ...(metadata?.taskId ? { taskId: metadata.taskId } : {}),
      ...(metadata?.traceId ? { traceId: metadata.traceId } : {})
    }),
    metadata: { ...metadata, expectedRevision, requestId },
    requestId,
    route,
    touchedProperties: automationMutationPropertyPaths(target, toolName, toolArgs)
  }
}

function resolvedToolArgs(
  def: ToolDef,
  toolArgs: Record<string, unknown>
): Record<string, unknown> {
  const resolved = { ...toolArgs }
  for (const [key, param] of Object.entries(def.params)) {
    if (resolved[key] === undefined && param.default !== undefined) {
      resolved[key] = structuredClone(param.default)
    }
  }
  return resolved
}

function resultRecords(result: unknown): JsonObject[] {
  if (!isUnknownRecord(result)) return []
  const records: JsonObject[] = [result]
  if (Array.isArray(result.results)) {
    records.push(...result.results.filter(isUnknownRecord))
  }
  return records
}

function storedObjectReplay(
  target: AutomationTarget,
  objectIds: string[],
  result: unknown
): {
  liveStatus: MutationReplayLiveStatus
  nodes: Record<string, unknown>[]
} {
  const expectedById = new Map(
    resultRecords(result)
      .filter((record): record is JsonObject & { id: string } => typeof record.id === 'string')
      .map((record) => [record.id, record])
  )
  let missing = false
  let diverged = false
  const nodes: Record<string, unknown>[] = []
  for (const id of objectIds) {
    const node = target.store.graph.getNode(id)
    if (!node) {
      missing = true
      nodes.push({ id, missing: true })
      continue
    }
    const summary = automationNodeSummary(target, node)
    const expected = expectedById.get(id)
    if (!target.store.graph.isDescendant(id, target.pageId)) diverged = true
    if (expected) {
      if (typeof expected.name === 'string' && expected.name !== node.name) diverged = true
      if (typeof expected.type === 'string' && expected.type !== node.type) diverged = true
      if (
        Array.isArray(expected.children) &&
        (expected.children.length !== node.childIds.length ||
          expected.children.some((childId, index) => childId !== node.childIds[index]))
      ) {
        diverged = true
      }
    }
    nodes.push(summary)
  }
  let liveStatus: MutationReplayLiveStatus = 'present'
  if (missing) liveStatus = 'missing'
  else if (diverged) liveStatus = 'diverged'
  return {
    liveStatus,
    nodes
  }
}

function storedToolMutationReplay(
  target: AutomationTarget,
  guard: ToolMutationGuard
): { found: false } | { found: true; response: unknown } {
  const storedReceipts = mutationRequestReceiptsById(target, guard.requestId)
  if (storedReceipts.length > 1) {
    throw new Error(`Request "${guard.requestId}" has duplicate stored mutation receipts.`)
  }
  if (storedReceipts.length === 0) return { found: false }
  const stored = storedReceipts[0]
  if (stored.inputDigest !== guard.inputDigest || stored.route !== guard.route) {
    throw new Error(`Request "${guard.requestId}" was already used for a different mutation.`)
  }
  const replay = storedObjectReplay(target, stored.objectIds, stored.result)
  return {
    found: true,
    response: {
      ok: true,
      result: withMutationReceipt(
        stored.result,
        {
          ...stored.mutationReceipt,
          historicalOnly: replay.liveStatus !== 'present',
          historicalStatus: 'applied',
          idempotentReplay: true,
          liveStatus: replay.liveStatus,
          replayAction: 'none'
        },
        {
          action: 'none',
          historical: 'applied',
          live: replay.liveStatus,
          readback: { nodes: replay.nodes }
        }
      )
    }
  }
}

export function createAutomationToolHandler(
  makeFigma: FigmaFactory,
  options: AutomationToolHandlerOptions = {}
) {
  async function handleToolRender(
    target: AutomationTarget,
    toolArgs: Record<string, unknown>
  ): Promise<unknown> {
    const store = target.store
    const tree = toolArgs.tree as Parameters<typeof renderTreeNode>[1]
    const result = await renderTreeNode(store.graph, tree, {
      parentId: (toolArgs.parent_id as string | undefined) ?? target.pageId,
      x: toolArgs.x as number | undefined,
      y: toolArgs.y as number | undefined
    })
    await ensureGraphFonts(store.graph, [result.id])
    computeAllLayouts(store.graph, target.pageId)
    store.requestRender()
    store.flashNodes([result.id])
    return {
      ok: true,
      result: { id: result.id, name: result.name, type: result.type, children: result.childIds }
    }
  }

  function startToolDefinition(
    target: AutomationTarget,
    def: ToolDef,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): StartedToolDefinition {
    const store = target.store
    if (toolName === 'render' && toolArgs.tree) {
      return {
        figma: null,
        postProcessed: true,
        result: handleToolRender(target, toolArgs)
      }
    }
    const figma = makeFigma(store, target.pageId)
    return {
      figma,
      postProcessed: false,
      result: def.execute(figma, toolArgs)
    }
  }

  async function completeToolDefinition(
    target: AutomationTarget,
    toolName: string,
    result: unknown,
    started: StartedToolDefinition
  ): Promise<void> {
    if (started.postProcessed || !started.figma) return
    const { store } = target
    const figma = started.figma
    await syncAutomationToolState(store, figma, toolName, result)
    const pageNode = store.graph.getNode(figma.currentPageId)
    if (pageNode) await ensureGraphFonts(store.graph, pageNode.childIds)
    computeAllLayouts(store.graph, figma.currentPageId)
    store.requestRender()
    store.flashNodes(extractNodeIds(result))
  }

  async function applyToolMutation(
    target: AutomationTarget,
    def: ToolDef,
    toolName: string,
    toolArgs: Record<string, unknown>,
    guard: ToolMutationGuard
  ): Promise<unknown> {
    const store = target.store
    const outcome = await enqueueAutomationMutation({
      metadata: guard.metadata,
      target,
      toolArgs,
      toolName,
      run: async () => {
        assertMutationRequestIdFresh(target, guard.requestId)
        reserveMutationRequest(target, {
          inputDigest: guard.inputDigest,
          requestId: guard.requestId,
          route: guard.route,
          version: 1
        })
        if (store.state.currentPageId !== target.pageId) await store.switchPage(target.pageId)
        const before = store.snapshotPage()
        const started = startToolDefinition(target, def, toolName, toolArgs)
        // Synchronous ToolDefs reach receipt storage before node-event persistence microtasks.
        // Async ToolDefs remain reservation-backed but need an authority commit acknowledgement
        // before any caller can claim that their receipt is durable.
        const result = started.result instanceof Promise ? await started.result : started.result
        const objectIds = receiptObjectIds(target, toolArgs, result)
        if (options.beforeMutationReceiptStorage) {
          await options.beforeMutationReceiptStorage()
        }
        recordMutationRequestReceipt(target, {
          inputDigest: guard.inputDigest,
          mutationReceipt: {
            appliedRevision: target.store.state.sceneVersion + 1,
            enqueuedRevision: guard.expectedRevision,
            expectedRevision: guard.expectedRevision,
            requestId: guard.requestId,
            status: 'applied',
            touchedProperties: guard.touchedProperties,
            ...(guard.metadata.taskId ? { taskId: guard.metadata.taskId } : {}),
            ...(guard.metadata.traceId ? { traceId: guard.metadata.traceId } : {})
          },
          objectIds,
          requestId: guard.requestId,
          result,
          route: guard.route,
          semanticIds: [],
          ...(guard.metadata.taskId ? { taskId: guard.metadata.taskId } : {}),
          ...(guard.metadata.traceId ? { traceId: guard.metadata.traceId } : {}),
          version: 1
        })
        await completeToolDefinition(target, toolName, result, started)
        pushAutomationUndo(target, toolName, before)
        return result
      }
    })

    if (outcome.status === 'rejected') {
      return {
        ok: true,
        result: { applied: false, mutation_receipt: outcome.receipt }
      }
    }
    return {
      ok: true,
      result: withMutationReceipt(outcome.value, outcome.receipt)
    }
  }

  async function handleMutatingTool(
    target: AutomationTarget,
    def: ToolDef,
    toolName: string,
    toolArgs: Record<string, unknown>,
    metadata: AutomationMutationMetadata | undefined
  ): Promise<unknown> {
    if (!canWriteSmylrProductionDocument(target.store)) {
      throw new Error(
        'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab before mutating it.'
      )
    }
    if (ASYNC_MUTATING_TOOL_NAMES.has(toolName)) {
      throw new Error(
        `Mutating tool "${toolName}" is asynchronous and is not available through guarded automation until its applied receipt can be durably acknowledged.`
      )
    }
    const resolvedArgs = resolvedToolArgs(def, toolArgs)
    const guard = await toolMutationGuard(target, toolName, resolvedArgs, metadata)
    return coalesceAutomationMutationRequest({
      inputDigest: guard.inputDigest,
      requestId: guard.requestId,
      run: () => {
        const replay = storedToolMutationReplay(target, guard)
        return replay.found
          ? replay.response
          : applyToolMutation(target, def, toolName, resolvedArgs, guard)
      },
      target
    })
  }

  return async function handleTool(target: AutomationTarget, args: unknown): Promise<unknown> {
    const toolName = (args as { name?: string }).name
    const toolArgs = (args as { args?: Record<string, unknown> }).args ?? {}
    const metadata = (args as { mutation?: AutomationMutationMetadata }).mutation
    if (!toolName) throw new Error('Missing "name" in args')

    const def = ALL_TOOLS.find((tool) => tool.name === toolName)
    if (!def) throw new Error(`Unknown tool: ${toolName}`)
    if (def.mutates) return handleMutatingTool(target, def, toolName, toolArgs, metadata)
    const figma = makeFigma(target.store, target.pageId)
    const result = await def.execute(figma, toolArgs)
    return { ok: true, result }
  }
}

function pushAutomationUndo(
  target: AutomationTarget,
  toolName: string,
  before: ReturnType<AutomationTarget['store']['snapshotPage']>
) {
  const store = target.store
  const after = store.snapshotPage()
  const restore = (snapshot: typeof before) => {
    const ledger = mutationRequestLedgerSnapshot(store.graph.getNode(target.pageId))
    store.restorePageFromSnapshot(snapshot)
    restoreMutationRequestLedger(target, ledger)
  }
  store.pushUndoEntry({
    label: `Agent: ${toolName}`,
    forward: () => restore(after),
    inverse: () => restore(before)
  })
}

function withMutationReceipt(
  result: unknown,
  receipt: Record<string, unknown>,
  replay?: Record<string, unknown>
) {
  const replayResult = replay ? { mutation_replay: replay } : {}
  if (isUnknownRecord(result)) {
    return { ...result, mutation_receipt: receipt, ...replayResult }
  }
  return { mutation_receipt: receipt, ...replayResult, value: result }
}

function extractNodeIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return []
  const obj = result as JsonObject
  if (typeof obj.deleted === 'string') return []
  const ids: string[] = []
  if (typeof obj.id === 'string') ids.push(obj.id)
  if (Array.isArray(obj.results)) {
    for (const item of obj.results) {
      if (item && typeof item === 'object' && typeof (item as JsonObject).id === 'string')
        ids.push((item as JsonObject).id as string)
    }
  }
  return ids
}

function receiptObjectIds(
  target: AutomationTarget,
  toolArgs: Record<string, unknown>,
  result: unknown
): string[] {
  const ids = extractNodeIds(result)
  if (typeof toolArgs.id === 'string') ids.push(toolArgs.id)
  return [
    ...new Set(
      ids.filter((id) => {
        const node = target.store.graph.getNode(id)
        return Boolean(node && target.store.graph.isDescendant(id, target.pageId))
      })
    )
  ]
}
