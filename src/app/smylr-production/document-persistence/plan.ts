import {
  type DocumentColorSpace,
  type SceneGraph,
  type SceneNode,
  type Variable,
  type VariableCollection
} from '@open-pencil/scene-graph'

import { SMYLR_FOUNDATIONS_REVISION } from '../foundations-revision'

const INCREMENTAL_CACHE_PREFIX = 'smylr-production/document-v4'

export const INCREMENTAL_MANIFEST_KEY = `${INCREMENTAL_CACHE_PREFIX}/manifest`
export const INCREMENTAL_MANIFEST_JSON_KEY = `${INCREMENTAL_CACHE_PREFIX}/manifest-json`
export const INCREMENTAL_CACHE_VERSION = 1

export type CachedSmylrProductionDocument = {
  activeMode: Array<[string, string]>
  documentColorSpace: DocumentColorSpace
  figKiwiVersion: number | null
  figSchemaDeflated: Uint8Array | null
  foundationsRevision: string
  images: Array<[string, Uint8Array]>
  imagesUnchanged?: boolean
  instanceIndex: Array<[string, string[]]>
  mermaidFingerprint?: string
  mermaidPresent?: boolean
  nodes: Array<[string, SceneNode]>
  retainedPageIds?: string[]
  rootId: string
  variableCollections: Array<[string, VariableCollection]>
  variables: Array<[string, Variable]>
  version: number
}

export type IncrementalSmylrProductionBoardRef = {
  boardId: string
  key: string
  nodeCount: number
  revision: number
}

export type IncrementalSmylrProductionAssetRef = {
  byteLength: number
  key: string
  revision: number
  signature: string
}

export type IncrementalSmylrProductionManifest = {
  activeMode: Array<[string, string]>
  assetRef: IncrementalSmylrProductionAssetRef | null
  boardRefs: IncrementalSmylrProductionBoardRef[]
  documentColorSpace: DocumentColorSpace
  figKiwiVersion: number | null
  figSchemaDeflated: Uint8Array | null
  foundationsRevision: string
  generation: number
  rootId: string
  rootNode: SceneNode
  variableCollections: Array<[string, VariableCollection]>
  variables: Array<[string, Variable]>
  version: typeof INCREMENTAL_CACHE_VERSION
}

export type IncrementalSmylrProductionBoardSnapshot = {
  boardId: string
  nodes: Array<[string, SceneNode]>
  revision: number
  version: typeof INCREMENTAL_CACHE_VERSION
}

export type IncrementalSmylrProductionPersistencePlan = {
  assetsToWrite: Array<[string, Uint8Array]> | null
  boardSnapshots: IncrementalSmylrProductionBoardSnapshot[]
  manifest: IncrementalSmylrProductionManifest
}

function boardCacheKey(boardId: string, revision: number) {
  return `${INCREMENTAL_CACHE_PREFIX}/board/${encodeURIComponent(boardId)}/${revision % 2}`
}

function assetCacheKey(revision: number) {
  return `${INCREMENTAL_CACHE_PREFIX}/assets/${revision % 2}`
}

export function smylrProductionImageSignature(graph: SceneGraph) {
  let byteLength = 0
  let signature = `${graph.images.size}:`
  for (const [hash, data] of graph.images) {
    byteLength += data.byteLength
    signature += `${hash}:${data.byteLength}|`
  }
  return { byteLength, signature }
}

export function omitUnchangedAuthorityImages(
  document: CachedSmylrProductionDocument,
  previousSignature: string | null,
  currentSignature: string
): CachedSmylrProductionDocument {
  if (
    !previousSignature ||
    previousSignature !== currentSignature ||
    document.images.length === 0
  ) {
    return document
  }
  return { ...document, images: [], imagesUnchanged: true }
}

export function omitUnchangedAuthorityPages(
  document: CachedSmylrProductionDocument,
  graph: SceneGraph,
  dirtyBoardIds: ReadonlySet<string> | null,
  pagesRemembered: boolean
): CachedSmylrProductionDocument {
  if (!pagesRemembered || !dirtyBoardIds) return document
  const retainedPageIds = graph
    .getPages(true)
    .map((page) => page.id)
    .filter((pageId) => !dirtyBoardIds.has(pageId))
  if (retainedPageIds.length === 0) return document

  const keep = new Set<string>([document.rootId])
  const root = graph.getNode(document.rootId)
  for (const childId of root?.childIds ?? []) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.type === 'CANVAS' && !dirtyBoardIds.has(childId)) continue
    keep.add(childId)
    for (const node of graph.getDescendants(childId)) keep.add(node.id)
  }
  return {
    ...document,
    nodes: document.nodes.filter(([id]) => keep.has(id)),
    retainedPageIds
  }
}

function serializeBoard(
  graph: SceneGraph,
  boardId: string,
  revision: number
): IncrementalSmylrProductionBoardSnapshot {
  const board = graph.getNode(boardId)
  if (board?.type !== 'CANVAS') {
    throw new TypeError(`Board ${boardId} is unavailable during persistence`)
  }
  const nodes: Array<[string, SceneNode]> = [[board.id, structuredClone(board)]]
  for (const node of graph.getDescendants(board.id)) {
    nodes.push([node.id, structuredClone(node)])
  }
  return {
    boardId,
    nodes,
    revision,
    version: INCREMENTAL_CACHE_VERSION
  }
}

export function planSmylrProductionDocumentPersistence(
  graph: SceneGraph,
  previousManifest: IncrementalSmylrProductionManifest | null,
  dirtyBoardIds: ReadonlySet<string>
): IncrementalSmylrProductionPersistencePlan {
  const previousRefs = new Map(previousManifest?.boardRefs.map((ref) => [ref.boardId, ref]))
  const boardSnapshots: IncrementalSmylrProductionBoardSnapshot[] = []
  const boardRefs = graph.getPages(true).map((board) => {
    const previous = previousRefs.get(board.id)
    if (previous && !dirtyBoardIds.has(board.id)) return previous
    const revision = (previous?.revision ?? 0) + 1
    const snapshot = serializeBoard(graph, board.id, revision)
    boardSnapshots.push(snapshot)
    return {
      boardId: board.id,
      key: boardCacheKey(board.id, revision),
      nodeCount: snapshot.nodes.length,
      revision
    }
  })
  const currentAssets = smylrProductionImageSignature(graph)
  const assetsChanged = currentAssets.signature !== previousManifest?.assetRef?.signature
  const assetRevision = assetsChanged ? (previousManifest?.assetRef?.revision ?? 0) + 1 : 0
  let assetRef = previousManifest?.assetRef ?? null
  if (currentAssets.byteLength === 0) {
    assetRef = null
  } else if (assetsChanged) {
    assetRef = {
      byteLength: currentAssets.byteLength,
      key: assetCacheKey(assetRevision),
      revision: assetRevision,
      signature: currentAssets.signature
    }
  }
  const root = graph.getNode(graph.rootId)
  if (!root) throw new TypeError('Document root is unavailable during persistence')

  return {
    assetsToWrite: assetsChanged && currentAssets.byteLength > 0 ? [...graph.images] : null,
    boardSnapshots,
    manifest: {
      activeMode: structuredClone([...graph.activeMode]),
      assetRef,
      boardRefs,
      documentColorSpace: graph.documentColorSpace,
      figKiwiVersion: graph.figKiwiVersion,
      figSchemaDeflated: graph.figSchemaDeflated?.slice() ?? null,
      foundationsRevision: SMYLR_FOUNDATIONS_REVISION,
      generation: (previousManifest?.generation ?? 0) + 1,
      rootId: graph.rootId,
      rootNode: structuredClone(root),
      variableCollections: structuredClone([...graph.variableCollections]),
      variables: structuredClone([...graph.variables]),
      version: INCREMENTAL_CACHE_VERSION
    }
  }
}

export function assembleIncrementalSmylrProductionDocument(
  manifest: IncrementalSmylrProductionManifest,
  snapshots: IncrementalSmylrProductionBoardSnapshot[],
  images: Array<[string, Uint8Array]>,
  cacheVersion: number
): CachedSmylrProductionDocument | null {
  if (snapshots.length !== manifest.boardRefs.length) return null
  const nodes: Array<[string, SceneNode]> = [[manifest.rootId, structuredClone(manifest.rootNode)]]
  for (let index = 0; index < manifest.boardRefs.length; index += 1) {
    const ref = manifest.boardRefs[index]
    const snapshot = snapshots[index]
    if (snapshot.boardId !== ref.boardId || snapshot.revision !== ref.revision) {
      return null
    }
    nodes.push(...snapshot.nodes)
  }

  const instanceIndex = new Map<string, string[]>()
  for (const [, node] of nodes) {
    if (node.type !== 'INSTANCE' || !node.componentId) continue
    const instanceIds = instanceIndex.get(node.componentId) ?? []
    instanceIds.push(node.id)
    instanceIndex.set(node.componentId, instanceIds)
  }

  return {
    activeMode: manifest.activeMode,
    documentColorSpace: manifest.documentColorSpace,
    figKiwiVersion: manifest.figKiwiVersion,
    figSchemaDeflated:
      manifest.figSchemaDeflated instanceof Uint8Array ? manifest.figSchemaDeflated : null,
    foundationsRevision: manifest.foundationsRevision,
    images,
    instanceIndex: [...instanceIndex],
    nodes,
    rootId: manifest.rootId,
    variableCollections: manifest.variableCollections,
    variables: manifest.variables,
    version: cacheVersion
  }
}
