import { SceneGraph } from '@open-pencil/scene-graph'
import { hydrateSceneNodeDefaults } from '@open-pencil/scene-graph/node-defaults'

import {
  readCacheJson,
  readCacheValue,
  tryWriteCacheValue,
  writeCacheJson,
  writeCacheValue
} from '../cache'
import type { EditorStore } from '../editor/session'
import {
  loadOpenPencilWorkspaceIdentity,
  OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
  stampOpenPencilWorkspaceIdentity
} from '../workspace-document/identity'
import { canWriteSmylrProductionDocument } from './document-authority'
import {
  INCREMENTAL_MANIFEST_JSON_KEY,
  INCREMENTAL_MANIFEST_KEY,
  planSmylrProductionDocumentPersistence,
  smylrProductionImageSignature,
  type CachedSmylrProductionDocument,
  type IncrementalSmylrProductionPersistencePlan,
  type IncrementalSmylrProductionManifest
} from './document-persistence/plan'
import { loadIncrementalSmylrProductionDocument } from './document-persistence/storage'
import { SMYLR_FOUNDATIONS_REVISION } from './foundations-revision'

const CACHE_KEY = 'smylr-production/document-v3-scene-graph'
const CACHE_JSON_KEY = 'smylr-production/document-v3-scene-graph-json'
const CACHE_VERSION = 2
const PLUGIN_ID = 'smylr-production'
const WORKSPACE_KINDS = new Set([
  'smylr-code-object-frame',
  'smylr-product-map-page',
  'smylr-brand-page',
  'smylr-production-page',
  'smylr-tokens-page'
])

export type { CachedSmylrProductionDocument } from './document-persistence/plan'

export type SmylrProductionPersistenceStats = {
  assetBytesWritten: number
  durationMs: number
  generation: number
  mode: 'incremental' | 'legacy-fallback'
  reusedBoardCount: number
  serializeMs: number
  totalNodeCount: number
  writeMs: number
  writtenBoardCount: number
  writtenNodeCount: number
}

type SmylrProductionPersistenceRuntime = {
  assetSignature: string | null
  dirtyBoards: Map<string, number>
  lastStats: SmylrProductionPersistenceStats | null
  manifest: IncrementalSmylrProductionManifest | null
  mutationRevision: number
  nodeBoardIds: Map<string, string>
  persistedSharedRevision: number
  saveTail: Promise<boolean>
  sharedRevision: number
  stopTracking: (() => void) | null
}

class SmylrProductionWriteDeniedError extends Error {
  override name = 'SmylrProductionWriteDeniedError'
}

const persistenceRuntimes = new WeakMap<EditorStore, SmylrProductionPersistenceRuntime>()

function nowMs() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function createPersistenceRuntime(): SmylrProductionPersistenceRuntime {
  return {
    assetSignature: null,
    dirtyBoards: new Map(),
    lastStats: null,
    manifest: null,
    mutationRevision: 0,
    nodeBoardIds: new Map(),
    persistedSharedRevision: 0,
    saveTail: Promise.resolve(true),
    sharedRevision: 1,
    stopTracking: null
  }
}

function persistenceRuntime(store: EditorStore) {
  let runtime = persistenceRuntimes.get(store)
  if (!runtime) {
    runtime = createPersistenceRuntime()
    persistenceRuntimes.set(store, runtime)
  }
  return runtime
}

function boardIdForNode(graph: SceneGraph, nodeId: string): string | null {
  let node = graph.getNode(nodeId)
  while (node) {
    if (node.type === 'CANVAS' && node.parentId === graph.rootId) return node.id
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return null
}

function rebuildNodeBoardIndex(store: EditorStore, runtime: SmylrProductionPersistenceRuntime) {
  runtime.nodeBoardIds.clear()
  for (const board of store.graph.getPages(true)) {
    runtime.nodeBoardIds.set(board.id, board.id)
    for (const node of store.graph.getDescendants(board.id)) {
      runtime.nodeBoardIds.set(node.id, board.id)
    }
  }
}

function markSharedDirty(runtime: SmylrProductionPersistenceRuntime) {
  runtime.mutationRevision += 1
  runtime.sharedRevision = runtime.mutationRevision
}

function markBoardDirty(runtime: SmylrProductionPersistenceRuntime, boardId: string | null) {
  if (!boardId) {
    markSharedDirty(runtime)
    return
  }
  runtime.mutationRevision += 1
  runtime.dirtyBoards.set(boardId, runtime.mutationRevision)
}

function updateSubtreeBoardIndex(
  store: EditorStore,
  runtime: SmylrProductionPersistenceRuntime,
  nodeId: string,
  boardId: string | null
) {
  if (boardId) runtime.nodeBoardIds.set(nodeId, boardId)
  else runtime.nodeBoardIds.delete(nodeId)
  for (const node of store.graph.getDescendants(nodeId)) {
    if (boardId) runtime.nodeBoardIds.set(node.id, boardId)
    else runtime.nodeBoardIds.delete(node.id)
  }
}

export function bindSmylrProductionDocumentPersistence(store: EditorStore): () => void {
  const runtime = persistenceRuntime(store)
  if (runtime.stopTracking) return runtime.stopTracking
  rebuildNodeBoardIndex(store, runtime)

  function trackNodeMove(nodeId: string) {
    const previousBoardId = runtime.nodeBoardIds.get(nodeId) ?? null
    const nextBoardId = boardIdForNode(store.graph, nodeId)
    markBoardDirty(runtime, previousBoardId)
    if (nextBoardId !== previousBoardId) markBoardDirty(runtime, nextBoardId)
    updateSubtreeBoardIndex(store, runtime, nodeId, nextBoardId)
    markSharedDirty(runtime)
  }

  const unbinds = [
    store.onEditorEvent('node:created', (node) => {
      const boardId = boardIdForNode(store.graph, node.id)
      updateSubtreeBoardIndex(store, runtime, node.id, boardId)
      markBoardDirty(runtime, boardId)
      if (node.type === 'CANVAS') markSharedDirty(runtime)
    }),
    store.onEditorEvent('node:updated', (nodeId) => {
      markBoardDirty(
        runtime,
        runtime.nodeBoardIds.get(nodeId) ?? boardIdForNode(store.graph, nodeId)
      )
    }),
    store.onEditorEvent('node:deleted', (nodeId) => {
      const boardId = runtime.nodeBoardIds.get(nodeId) ?? null
      runtime.nodeBoardIds.delete(nodeId)
      markBoardDirty(runtime, boardId)
      if (boardId === nodeId) markSharedDirty(runtime)
    }),
    store.onEditorEvent('node:reparented', trackNodeMove),
    store.onEditorEvent('node:reordered', trackNodeMove),
    store.onEditorEvent('graph:replaced', () => {
      runtime.manifest = null
      runtime.assetSignature = null
      runtime.dirtyBoards.clear()
      rebuildNodeBoardIndex(store, runtime)
      for (const board of store.graph.getPages(true)) markBoardDirty(runtime, board.id)
      markSharedDirty(runtime)
    }),
    store.onEditorEvent('render:requested', () => {
      markSharedDirty(runtime)
    })
  ]

  runtime.stopTracking = () => {
    for (const unbind of unbinds) unbind()
    runtime.stopTracking = null
  }
  return runtime.stopTracking
}

export function smylrProductionPersistenceStats(
  store: EditorStore
): SmylrProductionPersistenceStats | null {
  return persistenceRuntimes.get(store)?.lastStats ?? null
}

export {
  bindSmylrProductionDocumentWriteGuard,
  canWriteSmylrProductionDocument,
  setSmylrProductionDocumentWriteGuard
} from './document-authority'

function assertSmylrProductionDocumentWriteAllowed(store: EditorStore) {
  if (!canWriteSmylrProductionDocument(store)) {
    throw new SmylrProductionWriteDeniedError('Workspace writer authority is unavailable')
  }
}

export function isSmylrProductionDocumentGraph(graph: SceneGraph) {
  for (const node of graph.getAllNodes()) {
    if (
      node.pluginData.some(
        (entry) =>
          entry.pluginId === PLUGIN_ID && entry.key === 'kind' && WORKSPACE_KINDS.has(entry.value)
      )
    ) {
      return true
    }
  }
  return false
}

export function isCachedSmylrProductionDocument(
  value: unknown
): value is CachedSmylrProductionDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CachedSmylrProductionDocument>
  // Intentionally do not require foundationsRevision to match. A builder bump
  // restores the user's scene graph and refreshes foundations Boards in place.
  return Boolean(
    candidate.version === CACHE_VERSION &&
    typeof candidate.rootId === 'string' &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.images) &&
    Array.isArray(candidate.variables) &&
    Array.isArray(candidate.variableCollections) &&
    Array.isArray(candidate.activeMode) &&
    Array.isArray(candidate.instanceIndex)
  )
}

function serializeSmylrProductionDocument(graph: SceneGraph): CachedSmylrProductionDocument {
  return {
    activeMode: [...graph.activeMode],
    documentColorSpace: graph.documentColorSpace,
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    foundationsRevision: SMYLR_FOUNDATIONS_REVISION,
    images: [...graph.images],
    instanceIndex: [...graph.instanceIndex].map(([id, nodeIds]) => [id, [...nodeIds]]),
    nodes: [...graph.nodes],
    rootId: graph.rootId,
    variableCollections: [...graph.variableCollections],
    variables: [...graph.variables],
    version: CACHE_VERSION
  }
}

export function serializeSmylrProductionDocumentForSync(
  store: EditorStore
): CachedSmylrProductionDocument | null {
  if (!isSmylrProductionDocumentGraph(store.graph)) return null
  const payload = serializeSmylrProductionDocument(store.graph)
  return {
    ...payload,
    // Runtime images and Kiwi bytes are browser-local accelerators. The shared
    // document owns editable structure; previews are regenerated from patches.
    figSchemaDeflated: null,
    images: []
  }
}

export function serializeSmylrProductionDocumentForAuthority(
  store: EditorStore
): CachedSmylrProductionDocument | null {
  if (!isSmylrProductionDocumentGraph(store.graph)) return null
  return serializeSmylrProductionDocument(store.graph)
}

function deserializeSmylrProductionDocument(cached: CachedSmylrProductionDocument) {
  const graph = new SceneGraph()
  graph.rootId = cached.rootId
  graph.nodes = new Map(
    cached.nodes.map(([id, node]) => [id, hydrateSceneNodeDefaults(node)] as const)
  )
  graph.images = new Map(cached.images)
  graph.variables = new Map(cached.variables)
  graph.variableCollections = new Map(cached.variableCollections)
  graph.activeMode = new Map(cached.activeMode)
  graph.instanceIndex = new Map(cached.instanceIndex.map(([id, nodeIds]) => [id, new Set(nodeIds)]))
  graph.figKiwiVersion = cached.figKiwiVersion
  graph.figSchemaDeflated = cached.figSchemaDeflated
  graph.documentColorSpace = cached.documentColorSpace
  return graph
}

export async function applySmylrProductionDocument(
  store: EditorStore,
  value: unknown
): Promise<boolean> {
  if (!isCachedSmylrProductionDocument(value)) return false
  try {
    const graph = deserializeSmylrProductionDocument(value)
    if (!isSmylrProductionDocumentGraph(graph)) return false
    const identity = await loadOpenPencilWorkspaceIdentity()
    stampOpenPencilWorkspaceIdentity(graph, identity)
    store.state.documentName = OPENPENCIL_WORKSPACE_DOCUMENT_NAME
    store.replaceGraph(graph, { preserveViewState: true })
    store.undo.clear()
    return true
  } catch (error) {
    console.warn('[Smylr Production Workspace] document apply skipped', error)
    return false
  }
}

async function restoreIncrementalSmylrProductionDocument(store: EditorStore) {
  const loaded = await loadIncrementalSmylrProductionDocument(CACHE_VERSION)
  if (!loaded || !(await applySmylrProductionDocument(store, loaded.cached))) return false

  const runtime = persistenceRuntime(store)
  runtime.manifest = loaded.manifest
  runtime.assetSignature =
    loaded.manifest.assetRef?.signature ?? smylrProductionImageSignature(store.graph).signature
  runtime.persistedSharedRevision = runtime.sharedRevision
  runtime.dirtyBoards.clear()
  rebuildNodeBoardIndex(store, runtime)
  return true
}

export async function restoreSmylrProductionDocument(store: EditorStore): Promise<boolean> {
  if (await restoreIncrementalSmylrProductionDocument(store)) return true

  let cached = await readCacheValue<unknown>(CACHE_KEY)
  if (!isCachedSmylrProductionDocument(cached)) {
    // Fallback for environments where IndexedDB binary cache is flaky.
    cached = await readCacheJson<unknown>(CACHE_JSON_KEY)
  }
  return applySmylrProductionDocument(store, cached)
}

async function saveLegacySmylrProductionDocument(store: EditorStore): Promise<boolean> {
  const runtime = persistenceRuntime(store)
  assertSmylrProductionDocumentWriteAllowed(store)
  const startedAt = nowMs()
  const serializeStartedAt = nowMs()
  const payload = serializeSmylrProductionDocument(store.graph)
  const serializeMs = nowMs() - serializeStartedAt
  const writeStartedAt = nowMs()
  let ok = false
  try {
    assertSmylrProductionDocumentWriteAllowed(store)
    await writeCacheValue(CACHE_KEY, payload)
    ok = true
  } catch (error) {
    if (error instanceof SmylrProductionWriteDeniedError) throw error
    console.warn('[Smylr Production Workspace] IndexedDB document save failed', error)
  }

  try {
    assertSmylrProductionDocumentWriteAllowed(store)
    const light = {
      ...payload,
      images: [] as Array<[string, Uint8Array]>,
      figSchemaDeflated: null as Uint8Array | null
    }
    await writeCacheJson(CACHE_JSON_KEY, light)
    ok = true
  } catch (error) {
    if (error instanceof SmylrProductionWriteDeniedError) throw error
    console.warn('[Smylr Production Workspace] JSON document save failed', error)
  }

  runtime.lastStats = {
    assetBytesWritten: [...store.graph.images.values()].reduce(
      (total, image) => total + image.byteLength,
      0
    ),
    durationMs: nowMs() - startedAt,
    generation: runtime.manifest?.generation ?? 0,
    mode: 'legacy-fallback',
    reusedBoardCount: 0,
    serializeMs,
    totalNodeCount: store.graph.nodes.size,
    writeMs: nowMs() - writeStartedAt,
    writtenBoardCount: store.graph.getPages(true).length,
    writtenNodeCount: store.graph.nodes.size
  }
  return ok
}

function incrementalPersistenceIsCurrent(
  runtime: SmylrProductionPersistenceRuntime,
  currentBoardIds: ReadonlySet<string>,
  currentAssetSignature: string
) {
  const manifest = runtime.manifest
  if (!manifest || !runtime.stopTracking) return false
  if (manifest.boardRefs.length !== currentBoardIds.size) return false
  if (manifest.boardRefs.some((ref) => !currentBoardIds.has(ref.boardId))) return false
  if (runtime.sharedRevision !== runtime.persistedSharedRevision) return false
  if (runtime.dirtyBoards.size > 0) return false
  return currentAssetSignature === runtime.assetSignature
}

function dirtyBoardIdsForSave(
  runtime: SmylrProductionPersistenceRuntime,
  currentBoardIds: ReadonlySet<string>
) {
  const dirtyBoardIds = new Set(runtime.dirtyBoards.keys())
  const previousBoardIds = new Set(runtime.manifest?.boardRefs.map((ref) => ref.boardId))
  if (!runtime.manifest || !runtime.stopTracking) {
    for (const boardId of currentBoardIds) dirtyBoardIds.add(boardId)
  } else {
    for (const boardId of currentBoardIds) {
      if (!previousBoardIds.has(boardId)) dirtyBoardIds.add(boardId)
    }
  }
  for (const boardId of previousBoardIds) {
    if (!currentBoardIds.has(boardId)) dirtyBoardIds.add(boardId)
  }
  return dirtyBoardIds
}

async function writeIncrementalBoardSnapshots(
  store: EditorStore,
  plan: IncrementalSmylrProductionPersistencePlan
) {
  const refsByBoard = new Map(plan.manifest.boardRefs.map((ref) => [ref.boardId, ref]))
  for (const snapshot of plan.boardSnapshots) {
    assertSmylrProductionDocumentWriteAllowed(store)
    const ref = refsByBoard.get(snapshot.boardId)
    if (!ref) throw new TypeError(`Missing persistence reference for Board ${snapshot.boardId}`)
    const wroteIndexedDb = await tryWriteCacheValue(ref.key, snapshot)
    if (!wroteIndexedDb) await writeCacheJson(ref.key, snapshot)
  }
}

async function writeIncrementalAssets(
  store: EditorStore,
  plan: IncrementalSmylrProductionPersistencePlan
) {
  if (!plan.assetsToWrite || !plan.manifest.assetRef) return 0
  assertSmylrProductionDocumentWriteAllowed(store)
  const wroteAssets = await tryWriteCacheValue(plan.manifest.assetRef.key, plan.assetsToWrite)
  if (wroteAssets) return plan.manifest.assetRef.byteLength
  plan.manifest.assetRef = null
  return 0
}

async function writeIncrementalManifest(
  store: EditorStore,
  plan: IncrementalSmylrProductionPersistencePlan
) {
  assertSmylrProductionDocumentWriteAllowed(store)
  const wroteManifest = await tryWriteCacheValue(INCREMENTAL_MANIFEST_KEY, plan.manifest)
  const lightManifest: IncrementalSmylrProductionManifest = {
    ...plan.manifest,
    assetRef: null,
    figSchemaDeflated: null
  }
  try {
    assertSmylrProductionDocumentWriteAllowed(store)
    await writeCacheJson(INCREMENTAL_MANIFEST_JSON_KEY, lightManifest)
  } catch (error) {
    if (!wroteManifest) throw error
    console.warn('[Smylr Production Workspace] manifest mirror save skipped', error)
  }
}

function commitIncrementalPersistence(
  runtime: SmylrProductionPersistenceRuntime,
  plan: IncrementalSmylrProductionPersistencePlan,
  capturedBoardRevisions: ReadonlyMap<string, number | null>,
  capturedSharedRevision: number
) {
  runtime.manifest = plan.manifest
  for (const [boardId, revision] of capturedBoardRevisions) {
    if (revision !== null && runtime.dirtyBoards.get(boardId) === revision) {
      runtime.dirtyBoards.delete(boardId)
    }
  }
  if (runtime.sharedRevision === capturedSharedRevision) {
    runtime.persistedSharedRevision = capturedSharedRevision
  }
}

async function saveIncrementalSmylrProductionDocument(store: EditorStore): Promise<boolean> {
  if (!isSmylrProductionDocumentGraph(store.graph)) return false
  const runtime = persistenceRuntime(store)
  assertSmylrProductionDocumentWriteAllowed(store)

  const identity = await loadOpenPencilWorkspaceIdentity()
  assertSmylrProductionDocumentWriteAllowed(store)
  stampOpenPencilWorkspaceIdentity(store.graph, identity)
  store.state.documentName = OPENPENCIL_WORKSPACE_DOCUMENT_NAME

  const startedAt = nowMs()
  const pages = store.graph.getPages(true)
  const currentBoardIds = new Set(pages.map((board) => board.id))
  const currentAssetSignature = smylrProductionImageSignature(store.graph).signature

  if (incrementalPersistenceIsCurrent(runtime, currentBoardIds, currentAssetSignature)) {
    const manifest = runtime.manifest
    if (!manifest) return false
    runtime.lastStats = {
      assetBytesWritten: 0,
      durationMs: nowMs() - startedAt,
      generation: manifest.generation,
      mode: 'incremental',
      reusedBoardCount: pages.length,
      serializeMs: 0,
      totalNodeCount: store.graph.nodes.size,
      writeMs: 0,
      writtenBoardCount: 0,
      writtenNodeCount: 0
    }
    return true
  }

  const dirtyBoardIds = dirtyBoardIdsForSave(runtime, currentBoardIds)
  const capturedBoardRevisions = new Map(
    [...dirtyBoardIds].map((boardId) => [boardId, runtime.dirtyBoards.get(boardId) ?? null])
  )
  const capturedSharedRevision = runtime.sharedRevision
  const serializeStartedAt = nowMs()
  const plan = planSmylrProductionDocumentPersistence(store.graph, runtime.manifest, dirtyBoardIds)
  const serializeMs = nowMs() - serializeStartedAt
  const writeStartedAt = nowMs()

  await writeIncrementalBoardSnapshots(store, plan)
  const assetBytesWritten = await writeIncrementalAssets(store, plan)
  await writeIncrementalManifest(store, plan)
  runtime.assetSignature = currentAssetSignature
  commitIncrementalPersistence(runtime, plan, capturedBoardRevisions, capturedSharedRevision)
  const writtenNodeCount = plan.boardSnapshots.reduce(
    (total, snapshot) => total + snapshot.nodes.length,
    0
  )
  runtime.lastStats = {
    assetBytesWritten,
    durationMs: nowMs() - startedAt,
    generation: plan.manifest.generation,
    mode: 'incremental',
    reusedBoardCount: plan.manifest.boardRefs.length - plan.boardSnapshots.length,
    serializeMs,
    totalNodeCount: store.graph.nodes.size,
    writeMs: nowMs() - writeStartedAt,
    writtenBoardCount: plan.boardSnapshots.length,
    writtenNodeCount
  }
  return true
}

export async function saveSmylrProductionDocument(store: EditorStore): Promise<boolean> {
  const runtime = persistenceRuntime(store)
  if (!canWriteSmylrProductionDocument(store)) return false
  const save = async () => {
    if (!canWriteSmylrProductionDocument(store)) return false
    try {
      return await saveIncrementalSmylrProductionDocument(store)
    } catch (error) {
      if (
        error instanceof SmylrProductionWriteDeniedError ||
        !canWriteSmylrProductionDocument(store)
      ) {
        return false
      }
      console.warn('[Smylr Production Workspace] incremental save fell back', error)
      try {
        return await saveLegacySmylrProductionDocument(store)
      } catch (fallbackError) {
        if (fallbackError instanceof SmylrProductionWriteDeniedError) return false
        throw fallbackError
      }
    }
  }
  const queued = runtime.saveTail.then(save, save)
  runtime.saveTail = queued
  return queued
}
