import {
  SceneGraph,
  type DocumentColorSpace,
  type SceneNode,
  type Variable,
  type VariableCollection
} from '@open-pencil/scene-graph'

import { readCacheJson, readCacheValue, writeCacheJson, writeCacheValue } from '../cache'
import type { EditorStore } from '../editor/session'
import {
  loadOpenPencilWorkspaceIdentity,
  OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
  stampOpenPencilWorkspaceIdentity
} from '../workspace-document/identity'
import { SMYLR_FOUNDATIONS_REVISION } from './foundations-revision'
import { applyLiveFrameTombstones, loadLiveFrameTombstones } from './live/frame-tombstones'

const CACHE_KEY = 'smylr-production/document-v3-scene-graph'
const CACHE_JSON_KEY = 'smylr-production/document-v3-scene-graph-json'
const CACHE_VERSION = 2
const PLUGIN_ID = 'smylr-production'
const WORKSPACE_KINDS = new Set([
  'live-app-frame',
  'smylr-product-map-page',
  'smylr-brand-page',
  'smylr-production-page',
  'smylr-tokens-page'
])

export type CachedSmylrProductionDocument = {
  activeMode: Array<[string, string]>
  documentColorSpace: DocumentColorSpace
  figKiwiVersion: number | null
  figSchemaDeflated: Uint8Array | null
  foundationsRevision: string
  images: Array<[string, Uint8Array]>
  instanceIndex: Array<[string, string[]]>
  nodes: Array<[string, SceneNode]>
  rootId: string
  variableCollections: Array<[string, VariableCollection]>
  variables: Array<[string, Variable]>
  version: number
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
  // Intentionally do NOT require foundationsRevision to match. A builder bump
  // should restore the user's scene graph (including deleted iframes/designs)
  // and refresh foundations boards in place — not discard the whole cache.
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

function deserializeSmylrProductionDocument(cached: CachedSmylrProductionDocument) {
  const graph = new SceneGraph()
  graph.rootId = cached.rootId
  graph.nodes = new Map(cached.nodes)
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
  value: unknown,
  options: { applyTombstones?: boolean } = {}
): Promise<boolean> {
  await loadLiveFrameTombstones()
  if (!isCachedSmylrProductionDocument(value)) return false
  try {
    const graph = deserializeSmylrProductionDocument(value)
    if (options.applyTombstones !== false) applyLiveFrameTombstones(graph)
    if (!isSmylrProductionDocumentGraph(graph)) return false
    const identity = await loadOpenPencilWorkspaceIdentity()
    stampOpenPencilWorkspaceIdentity(graph, identity)
    store.state.documentName = OPENPENCIL_WORKSPACE_DOCUMENT_NAME
    store.replaceGraph(graph)
    store.undo.clear()
    return true
  } catch (error) {
    console.warn('[Smylr Production Workspace] document apply skipped', error)
    return false
  }
}

export async function restoreSmylrProductionDocument(store: EditorStore): Promise<boolean> {
  await loadLiveFrameTombstones()

  let cached = await readCacheValue<unknown>(CACHE_KEY)
  if (!isCachedSmylrProductionDocument(cached)) {
    // Fallback for environments where IndexedDB binary cache is flaky.
    cached = await readCacheJson<unknown>(CACHE_JSON_KEY)
  }
  return applySmylrProductionDocument(store, cached)
}

export async function saveSmylrProductionDocument(store: EditorStore): Promise<boolean> {
  if (!isSmylrProductionDocumentGraph(store.graph)) return false

  const identity = await loadOpenPencilWorkspaceIdentity()
  stampOpenPencilWorkspaceIdentity(store.graph, identity)
  store.state.documentName = OPENPENCIL_WORKSPACE_DOCUMENT_NAME
  const payload = serializeSmylrProductionDocument(store.graph)
  let ok = false
  try {
    await writeCacheValue(CACHE_KEY, payload)
    ok = true
  } catch (error) {
    console.warn('[Smylr Production Workspace] IndexedDB document save failed', error)
  }

  // JSON/localStorage mirror so reloads still restore when IDB is unavailable.
  // Drop bulky image bytes — scene structure (including deleted frames) is enough.
  try {
    const light = {
      ...payload,
      images: [] as Array<[string, Uint8Array]>,
      figSchemaDeflated: null as Uint8Array | null
    }
    await writeCacheJson(CACHE_JSON_KEY, light)
    ok = true
  } catch (error) {
    console.warn('[Smylr Production Workspace] JSON document save failed', error)
  }
  return ok
}
