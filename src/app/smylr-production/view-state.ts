import { EDITOR_TOOLS, type Tool } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { readCacheJson, writeCacheJson } from '../cache'
import type { EditorStore } from '../editor/session'
import {
  createWorkViewMemory,
  recordWorkViewMovement,
  rememberWorkViewSnapshot,
  workViewLocationKey,
  type WorkLifecycleActorKind,
  type WorkViewLocation,
  type WorkViewMemory,
  type WorkViewMovementReceipt,
  type WorkViewSnapshot
} from '../flow-state'

const CACHE_KEY = 'smylr-production/view-state'
const PLUGIN_ID = 'smylr-production'
const EDITOR_TOOL_KEYS = new Set<string>(
  EDITOR_TOOLS.flatMap((tool) => [tool.key, ...(tool.flyout ?? [])])
)

export type SmylrProductionPageView = {
  kind: string
  pageId: string
}

export type SmylrProductionViewState = Omit<WorkViewSnapshot, 'activeTool'> & {
  activeTool: Tool
}

export type SmylrProductionViewMovement = {
  receipt: WorkViewMovementReceipt | null
  restored: boolean
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isEditorTool(value: unknown): value is Tool {
  return typeof value === 'string' && EDITOR_TOOL_KEYS.has(value)
}

function isActorKind(value: unknown): value is WorkLifecycleActorKind {
  return value === 'agent' || value === 'human' || value === 'system'
}

function parseLocation(value: unknown): WorkViewLocation | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WorkViewLocation>
  if (typeof candidate.kind !== 'string' || typeof candidate.pageId !== 'string') return null
  return { kind: candidate.kind, pageId: candidate.pageId }
}

function parseStoredViewState(value: unknown): SmylrProductionViewState | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<SmylrProductionViewState> & {
    page?: SmylrProductionPageView
  }
  const location = parseLocation(candidate.location ?? candidate.page)
  if (
    !location ||
    !candidate.viewport ||
    !isFiniteNumber(candidate.viewport.panX) ||
    !isFiniteNumber(candidate.viewport.panY) ||
    !isFiniteNumber(candidate.viewport.zoom) ||
    candidate.viewport.zoom < 0.02 ||
    candidate.viewport.zoom > 256
  ) {
    return null
  }
  return {
    activeTool: isEditorTool(candidate.activeTool) ? candidate.activeTool : 'SELECT',
    location,
    selectedIds: Array.isArray(candidate.selectedIds)
      ? candidate.selectedIds.filter((id): id is string => typeof id === 'string')
      : [],
    viewport: {
      panX: candidate.viewport.panX,
      panY: candidate.viewport.panY,
      zoom: candidate.viewport.zoom
    }
  }
}

function parseMovementReceipt(value: unknown): WorkViewMovementReceipt | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<WorkViewMovementReceipt>
  const from = parseLocation(candidate.from)
  const to = parseLocation(candidate.to)
  const origin = parseStoredViewState(candidate.origin)
  if (
    !from ||
    !to ||
    !origin ||
    typeof candidate.actorId !== 'string' ||
    !isActorKind(candidate.actorKind) ||
    typeof candidate.id !== 'string' ||
    typeof candidate.itemId !== 'string' ||
    typeof candidate.occurredAt !== 'string'
  ) {
    return null
  }
  return {
    actorId: candidate.actorId,
    actorKind: candidate.actorKind,
    from,
    id: candidate.id,
    itemId: candidate.itemId,
    occurredAt: candidate.occurredAt,
    origin,
    to
  }
}

function parseStoredViewMemory(value: unknown): WorkViewMemory {
  const legacy = parseStoredViewState(value)
  if (legacy) return rememberWorkViewSnapshot(createWorkViewMemory(), legacy)
  if (!value || typeof value !== 'object') return createWorkViewMemory()
  const candidate = value as Partial<WorkViewMemory>
  const memory = createWorkViewMemory()
  if (candidate.views && typeof candidate.views === 'object') {
    for (const stored of Object.values(candidate.views)) {
      const snapshot = parseStoredViewState(stored)
      if (snapshot) memory.views[workViewLocationKey(snapshot.location)] = snapshot
    }
  }
  memory.active = parseStoredViewState(candidate.active)
  memory.history = Array.isArray(candidate.history)
    ? candidate.history
        .map(parseMovementReceipt)
        .filter((receipt): receipt is WorkViewMovementReceipt => receipt !== null)
    : []
  return memory
}

async function readStoredViewMemory(): Promise<WorkViewMemory> {
  return parseStoredViewMemory(await readCacheJson<unknown>(CACHE_KEY))
}

export function smylrProductionPageView(node: SceneNode | null | undefined) {
  if (node?.type !== 'CANVAS') return null
  const kind = pluginValue(node, 'kind')
  const pageId = pluginValue(node, 'pageId')
  return kind && pageId ? { kind, pageId } : { kind: 'ordinary-board', pageId: node.id }
}

export function captureSmylrProductionView(store: EditorStore): SmylrProductionViewState | null {
  const location = smylrProductionPageView(store.graph.getNode(store.state.currentPageId))
  const { panX, panY, zoom } = store.state
  if (!location || !isFiniteNumber(panX) || !isFiniteNumber(panY) || !isFiniteNumber(zoom)) {
    return null
  }
  return {
    activeTool: store.state.activeTool,
    location,
    selectedIds: [...store.state.selectedIds],
    viewport: { panX, panY, zoom }
  }
}

function findSavedPage(store: EditorStore, saved: SmylrProductionViewState) {
  return (
    store.graph.getPages().find((page) => {
      const view = smylrProductionPageView(page)
      return view?.kind === saved.location.kind && view.pageId === saved.location.pageId
    }) ?? null
  )
}

function applySnapshotToCurrentPage(store: EditorStore, saved: SmylrProductionViewState) {
  const current = smylrProductionPageView(store.graph.getNode(store.state.currentPageId))
  if (current?.kind !== saved.location.kind || current.pageId !== saved.location.pageId) {
    return false
  }
  const selectedIds = saved.selectedIds.filter((id) => store.graph.getNode(id))
  store.select(selectedIds.length === saved.selectedIds.length ? selectedIds : [])
  store.setTool(saved.activeTool)
  store.zoomToLevel(saved.viewport.zoom)
  store.pan(saved.viewport.panX - store.state.panX, saved.viewport.panY - store.state.panY)
  return true
}

export async function applySmylrProductionView(
  store: EditorStore,
  value: unknown
): Promise<boolean> {
  const saved = parseStoredViewState(value)
  if (!saved) return false
  const page = findSavedPage(store, saved)
  if (!page) return false

  await store.switchPage(page.id)
  return applySnapshotToCurrentPage(store, saved)
}

export async function restoreSmylrProductionView(
  store: EditorStore,
  options: { expectedPageId?: string } = {}
): Promise<boolean> {
  const saved = (await readStoredViewMemory()).active
  if (options.expectedPageId && store.state.currentPageId !== options.expectedPageId) return false
  if (!saved) return false
  return applySmylrProductionView(store, parseStoredViewState(saved))
}

export async function saveSmylrProductionView(store: EditorStore): Promise<boolean> {
  const view = captureSmylrProductionView(store)
  if (!view) return false
  const memory = rememberWorkViewSnapshot(await readStoredViewMemory(), view)
  await writeCacheJson(CACHE_KEY, memory)
  return true
}

export async function moveBetweenSmylrProductionViews(
  store: EditorStore,
  input: {
    destination?: WorkViewLocation
    focusTarget: (ids: string[]) => Promise<void>
    itemId: string
    prepareTarget: () => string[]
    targetPageId: string
  }
): Promise<SmylrProductionViewMovement | null> {
  const targetPage = store.graph.getNode(input.targetPageId)
  const destination = input.destination ?? smylrProductionPageView(targetPage)
  if (!destination) return null

  return runSmylrProductionViewMovement(store, {
    destination,
    itemId: input.itemId,
    transition: async () => {
      await store.switchPage(input.targetPageId)
      const fallbackIds = input.prepareTarget()
      store.select(fallbackIds)
      await input.focusTarget(fallbackIds)
    }
  })
}

export async function runSmylrProductionViewMovement(
  store: EditorStore,
  input: {
    destination: WorkViewLocation
    itemId: string
    transition: () => Promise<void>
  }
): Promise<SmylrProductionViewMovement> {
  const destination = input.destination

  const origin = captureSmylrProductionView(store)
  let memory = await readStoredViewMemory()
  let receipt: WorkViewMovementReceipt | null = null
  if (origin) {
    const movement = recordWorkViewMovement(input.itemId, memory, origin, destination)
    memory = movement.memory
    receipt = movement.receipt
  }

  const savedTarget = parseStoredViewState(memory.views[workViewLocationKey(destination)])
  await input.transition()
  const restored = savedTarget ? applySnapshotToCurrentPage(store, savedTarget) : false

  const arrived = captureSmylrProductionView(store)
  if (arrived) memory = rememberWorkViewSnapshot(memory, arrived)
  await writeCacheJson(CACHE_KEY, memory)
  return { receipt, restored }
}

export function isBrowserPageReload(): boolean {
  if (typeof performance === 'undefined') return false
  return performance
    .getEntriesByType('navigation')
    .some((entry) => 'type' in entry && entry.type === 'reload')
}
