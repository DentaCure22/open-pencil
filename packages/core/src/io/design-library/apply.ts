import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { applyTokenSnapshot } from '#core/io/tokens'

import type { DesignLibraryReview, LibrarySceneNode, OpenPencilLibrary } from './types'
import { OPENPENCIL_LIBRARY_PLUGIN_ID } from './types'

function metadata(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find(
      (entry) => entry.pluginId === OPENPENCIL_LIBRARY_PLUGIN_ID && entry.key === key
    )?.value ?? null
  )
}

function withMetadata(
  pluginData: SceneNode['pluginData'],
  values: Record<string, string>
): SceneNode['pluginData'] {
  return [
    ...pluginData.filter((entry) => entry.pluginId !== OPENPENCIL_LIBRARY_PLUGIN_ID),
    ...Object.entries(values).map(([key, value]) => ({
      pluginId: OPENPENCIL_LIBRARY_PLUGIN_ID,
      key,
      value
    }))
  ]
}

function libraryPage(graph: SceneGraph, library: OpenPencilLibrary): SceneNode {
  const existing = graph
    .getPages(true)
    .find((page) => metadata(page, 'libraryKey') === library.library.key)
  if (existing) {
    graph.updateNode(existing.id, { name: 'Library · ' + library.library.name })
    return existing
  }
  const page = graph.addPage('Library · ' + library.library.name)
  graph.updateNode(page.id, {
    pluginData: withMetadata(page.pluginData, {
      kind: 'library-page',
      libraryKey: library.library.key
    })
  })
  return page
}

function nodeProps(
  source: LibrarySceneNode,
  library: OpenPencilLibrary,
  root: boolean,
  signature: string
): Partial<SceneNode> {
  const {
    sourceId,
    children: _children,
    textPicture,
    type: _type,
    pluginData,
    componentId: _componentId,
    ...props
  } = source
  const isComponent = source.type === 'COMPONENT' || source.type === 'COMPONENT_SET'
  return {
    ...structuredClone(props),
    componentId: source.componentId,
    textPicture: textPicture ? Uint8Array.fromBase64(textPicture) : null,
    sourceLibraryKey: isComponent ? library.library.key : source.sourceLibraryKey,
    publishId: isComponent ? (source.publishId ?? sourceId) : source.publishId,
    publishedVersion: isComponent ? library.library.version : source.publishedVersion,
    pluginData: withMetadata(pluginData, {
      libraryKey: library.library.key,
      sourceId,
      root: root ? 'true' : 'false',
      signature: root ? signature : ''
    })
  }
}

function collectSerialized(node: LibrarySceneNode, out: LibrarySceneNode[]) {
  out.push(node)
  for (const child of node.children) collectSerialized(child, out)
}

function syncTree(
  graph: SceneGraph,
  parentId: string,
  source: LibrarySceneNode,
  library: OpenPencilLibrary,
  root: boolean,
  signature: string,
  localBySourceId: Map<string, string>
): string {
  const existingId = localBySourceId.get(source.sourceId)
  const existing = existingId ? graph.getNode(existingId) : undefined
  const node =
    existing ?? graph.createNode(source.type, parentId, nodeProps(source, library, root, signature))
  if (existing) graph.updateNode(existing.id, nodeProps(source, library, root, signature))
  localBySourceId.set(source.sourceId, node.id)
  const incomingChildren = new Set(source.children.map((child) => child.sourceId))
  for (const childId of node.childIds.slice()) {
    const child = graph.getNode(childId)
    const sourceId = child ? metadata(child, 'sourceId') : null
    if (sourceId && !incomingChildren.has(sourceId)) graph.deleteNode(childId)
  }
  const order = source.children.map((child) =>
    syncTree(graph, node.id, child, library, false, signature, localBySourceId)
  )
  for (const [index, childId] of order.entries()) graph.insertChildAt(childId, node.id, index)
  return node.id
}

function importedRoots(graph: SceneGraph, libraryKey: string): SceneNode[] {
  return [...graph.nodes.values()].filter(
    (node) => node.sourceLibraryKey === libraryKey && metadata(node, 'root') === 'true'
  )
}

function detachInstancesInTree(graph: SceneGraph, root: SceneNode) {
  const nodes = [root, ...graph.flattenTree(root.id).map((entry) => entry.node)]
  for (const node of nodes) {
    if (node.type !== 'COMPONENT') continue
    for (const instance of graph.getInstances(node.id)) graph.detachInstance(instance.id)
  }
}

export function applyOpenPencilLibrary(
  graph: SceneGraph,
  library: OpenPencilLibrary,
  review: DesignLibraryReview
): void {
  const page = libraryPage(graph, library)
  for (const [hash, encoded] of Object.entries(library.images)) {
    graph.images.set(hash, Uint8Array.fromBase64(encoded))
  }
  const localBySourceId = new Map<string, string>()
  for (const node of graph.nodes.values()) {
    const sourceId = metadata(node, 'sourceId')
    if (sourceId && metadata(node, 'libraryKey') === library.library.key) {
      localBySourceId.set(sourceId, node.id)
    }
  }
  const incomingPublishIds = new Set(library.components.map((component) => component.publishId))
  for (const root of importedRoots(graph, library.library.key)) {
    if (root.publishId && incomingPublishIds.has(root.publishId)) continue
    detachInstancesInTree(graph, root)
    graph.deleteNode(root.id)
  }
  const serializedNodes: LibrarySceneNode[] = []
  for (const component of library.components) {
    collectSerialized(component.node, serializedNodes)
    syncTree(graph, page.id, component.node, library, true, component.signature, localBySourceId)
  }
  for (const source of serializedNodes) {
    const localId = localBySourceId.get(source.sourceId)
    const node = localId ? graph.getNode(localId) : undefined
    if (!node) continue
    const componentId = source.componentId
      ? (localBySourceId.get(source.componentId) ?? null)
      : null
    if (componentId !== node.componentId) graph.updateNode(node.id, { componentId })
  }
  for (const localId of localBySourceId.values()) {
    if (graph.getNode(localId)?.type === 'COMPONENT') graph.syncInstances(localId)
  }
  applyTokenSnapshot(graph, review.tokenSnapshot)
  graph.clearAbsPosCache()
}
