import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { hydrateSceneNodeDefaults } from '@open-pencil/scene-graph/node-defaults'

import type { EditorStore } from '../editor/session'
import {
  loadOpenPencilWorkspaceIdentity,
  OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
  stampOpenPencilWorkspaceIdentity
} from '../workspace-document/identity'
import type { CachedSmylrProductionDocument } from './document-persistence/plan'
import { SMYLR_FOUNDATIONS_REVISION } from './foundations-revision'

export const SMYLR_PRODUCTION_CACHE_VERSION = 2

const PLUGIN_ID = 'smylr-production'
const WORKSPACE_KINDS = new Set([
  'smylr-code-object-frame',
  'smylr-product-map-page',
  'smylr-brand-page',
  'smylr-production-page',
  'smylr-tokens-page'
])

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
  // A foundations revision bump restores the user's graph, then refreshes
  // foundations Boards in place, so it is intentionally not part of validity.
  return Boolean(
    candidate.version === SMYLR_PRODUCTION_CACHE_VERSION &&
    typeof candidate.rootId === 'string' &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.images) &&
    Array.isArray(candidate.variables) &&
    Array.isArray(candidate.variableCollections) &&
    Array.isArray(candidate.activeMode) &&
    Array.isArray(candidate.instanceIndex)
  )
}

function pluginEntry(node: SceneNode, key: string): string | null {
  const value = node.pluginData.find(
    (entry) => entry.pluginId === 'open-pencil' && entry.key === key
  )?.value
  return typeof value === 'string' ? value : null
}

function mermaidNodeFingerprint(node: SceneNode): string | null {
  const mermaidSource = 'mermaidSource' in node ? node.mermaidSource : undefined
  if (typeof mermaidSource === 'string') return `src:${node.id}:${mermaidSource}`
  if (pluginEntry(node, 'mermaid/role') !== 'diagram') return null
  return `role:${node.id}:${pluginEntry(node, 'mermaid/source') ?? ''}`
}

function serializeGraphNodes(graph: SceneGraph): {
  mermaidFingerprint: string
  mermaidPresent: boolean
  nodes: Array<[string, SceneNode]>
} {
  const nodes: Array<[string, SceneNode]> = []
  const fingerprints: string[] = []
  for (const entry of graph.nodes) {
    nodes.push(entry)
    const fingerprint = mermaidNodeFingerprint(entry[1])
    if (fingerprint) fingerprints.push(fingerprint)
  }
  fingerprints.sort()
  return {
    mermaidFingerprint: fingerprints.join('\n'),
    mermaidPresent: fingerprints.length > 0,
    nodes
  }
}

export function serializeSmylrProductionDocument(graph: SceneGraph): CachedSmylrProductionDocument {
  const { mermaidFingerprint, mermaidPresent, nodes } = serializeGraphNodes(graph)
  return {
    activeMode: [...graph.activeMode],
    documentColorSpace: graph.documentColorSpace,
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    foundationsRevision: SMYLR_FOUNDATIONS_REVISION,
    images: [...graph.images],
    instanceIndex: [...graph.instanceIndex].map(([id, nodeIds]) => [id, [...nodeIds]]),
    mermaidFingerprint,
    mermaidPresent,
    nodes,
    rootId: graph.rootId,
    variableCollections: [...graph.variableCollections],
    variables: [...graph.variables],
    version: SMYLR_PRODUCTION_CACHE_VERSION
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
