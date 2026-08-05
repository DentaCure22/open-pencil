import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  canonicalMemoryDerivedFromId,
  canonicalMemoryObjectId,
  canonicalMemoryObjectPluginData,
  canonicalMemorySourceNodeId
} from '#core/tools/read/memory'

const AGENT_RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'

export type CanonicalObjectNodeUpdater = (
  node: SceneNode,
  pluginData: SceneNode['pluginData']
) => void

export type CanonicalObjectTreeCloner = (
  sourceId: string,
  parentId: string,
  overrides: Partial<SceneNode>
) => SceneNode | null

export type MaterializeCanonicalObjectInput = {
  sourceObjectId: string
  x: number
  y: number
}

export type CanonicalObjectMaterializationResult = {
  canonical_object_id: string
  object_ids: string[]
  placement_id: string
  source_object_id: string
}

export type CanonicalObjectForkResult = {
  canonical_object_id: string
  derived_from_canonical_object_id: string
  object_ids: string[]
  placement_id: string
}

function requiredObject(graph: SceneGraph, objectId: string, label: string): SceneNode {
  const node = graph.getNode(objectId)
  if (!node || node.type === 'CANVAS') throw new Error(`${label} "${objectId}" does not exist.`)
  return node
}

function boardPage(graph: SceneGraph, pageId: string): SceneNode {
  const page = graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Board page "${pageId}" does not exist.`)
  return page
}

function pairedSubtrees(graph: SceneGraph, source: SceneNode, clone: SceneNode) {
  const pairs: Array<{ clone: SceneNode; source: SceneNode }> = [{ clone, source }]
  for (let index = 0; index < source.childIds.length; index += 1) {
    const sourceChildId = source.childIds[index]
    const cloneChildId = clone.childIds[index]
    if (!sourceChildId || !cloneChildId) {
      throw new Error('Canonical object materialization produced an incomplete subtree.')
    }
    const sourceChild = graph.getNode(sourceChildId)
    const cloneChild = graph.getNode(cloneChildId)
    if (!sourceChild || !cloneChild) {
      throw new Error('Canonical object materialization produced a missing subtree node.')
    }
    pairs.push(...pairedSubtrees(graph, sourceChild, cloneChild))
  }
  return pairs
}

export function canonicalMemoryPeerNodes(graph: SceneGraph, node: SceneNode): SceneNode[] {
  const canonicalObjectId = canonicalMemoryObjectId(node)
  return [...graph.nodes.values()].filter(
    (candidate) =>
      candidate.type === node.type && canonicalMemoryObjectId(candidate) === canonicalObjectId
  )
}

export function materializeCanonicalObject(
  graph: SceneGraph,
  pageId: string,
  input: MaterializeCanonicalObjectInput,
  cloneTree: CanonicalObjectTreeCloner = (sourceId, parentId, overrides) =>
    graph.cloneTree(sourceId, parentId, overrides),
  updateNode: CanonicalObjectNodeUpdater = (node, pluginData) => {
    graph.updateNode(node.id, { pluginData })
  }
): CanonicalObjectMaterializationResult {
  boardPage(graph, pageId)
  const source = requiredObject(graph, input.sourceObjectId, 'Canonical source object')
  const clone = cloneTree(source.id, pageId, { name: source.name, x: input.x, y: input.y })
  if (!clone) throw new Error(`Canonical source object "${source.id}" could not be materialized.`)
  const pairs = pairedSubtrees(graph, source, clone)
  for (const pair of pairs) {
    const cloneWithoutReceipts = {
      pluginData: pair.clone.pluginData.filter(
        (entry) => entry.pluginId !== AGENT_RECEIPT_PLUGIN_ID
      )
    }
    updateNode(
      pair.clone,
      canonicalMemoryObjectPluginData(cloneWithoutReceipts, {
        canonicalObjectId: canonicalMemoryObjectId(pair.source),
        ...(canonicalMemoryDerivedFromId(pair.source)
          ? { derivedFromCanonicalObjectId: canonicalMemoryDerivedFromId(pair.source) }
          : {}),
        sourceNodeId: canonicalMemorySourceNodeId(pair.source) ?? pair.source.id
      })
    )
  }
  return {
    canonical_object_id: canonicalMemoryObjectId(source),
    object_ids: pairs.map(({ clone: candidate }) => candidate.id),
    placement_id: clone.id,
    source_object_id: source.id
  }
}

export function forkCanonicalObject(
  graph: SceneGraph,
  pageId: string,
  objectId: string,
  updateNode: CanonicalObjectNodeUpdater = (node, pluginData) => {
    graph.updateNode(node.id, { pluginData })
  }
): CanonicalObjectForkResult {
  boardPage(graph, pageId)
  const placement = requiredObject(graph, objectId, 'Canonical object placement')
  if (!graph.isDescendant(placement.id, pageId)) {
    throw new Error(`Canonical object placement "${objectId}" is outside the targeted Board.`)
  }
  if (!canonicalMemorySourceNodeId(placement)) {
    throw new Error(`Canonical object placement "${objectId}" is already an independent object.`)
  }
  const nodes = [placement, ...graph.getDescendants(placement.id)]
  const derivedFromCanonicalObjectId = canonicalMemoryObjectId(placement)
  for (const node of nodes) {
    updateNode(
      node,
      canonicalMemoryObjectPluginData(node, {
        canonicalObjectId: node.id,
        derivedFromCanonicalObjectId: canonicalMemoryObjectId(node)
      })
    )
  }
  return {
    canonical_object_id: placement.id,
    derived_from_canonical_object_id: derivedFromCanonicalObjectId,
    object_ids: nodes.map(({ id }) => id),
    placement_id: placement.id
  }
}
