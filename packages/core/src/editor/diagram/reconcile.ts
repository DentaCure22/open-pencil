import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  mergeSourceReconciliationPluginData,
  readSourceReconciliation,
  type SourceReconciliationResult
} from '#core/io/content-source'

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

function isAttachedToGraph(graph: SceneGraph, nodeId: string): boolean {
  let node = graph.getNode(nodeId)
  const visited = new Set<string>()
  if (!node) return false

  while (node.parentId) {
    if (visited.has(node.id)) return false
    visited.add(node.id)
    const parent = graph.getNode(node.parentId)
    if (!parent || !parent.childIds.includes(node.id)) return false
    node = parent
  }
  return node.id === graph.rootId
}

export function mermaidDiagramOwner(graph: SceneGraph, nodeId: string): SceneNode | null {
  let node = graph.getNode(nodeId)
  const diagramId = node ? pluginValue(node, 'mermaid/diagram-id') : null
  if (!node || !diagramId || !isAttachedToGraph(graph, node.id)) return null

  while (node.parentId) {
    const parent = graph.getNode(node.parentId)
    if (!parent || pluginValue(parent, 'mermaid/diagram-id') !== diagramId) break
    node = parent
  }
  return node
}

export function initializeMermaidSourceReconciliation(graph: SceneGraph, ownerId: string): void {
  const owner = graph.getNode(ownerId)
  if (!owner) return
  graph.updateNode(owner.id, {
    pluginData: mergeSourceReconciliationPluginData(owner.pluginData, {
      status: 'current',
      message: 'Mermaid SVG is derived directly from this source.',
      baseline: null,
      revision: 1
    })
  })
}

export function reconcileMermaidDiagramSource(
  graph: SceneGraph,
  nodeId: string
): SourceReconciliationResult | null {
  const owner = mermaidDiagramOwner(graph, nodeId)
  if (!owner) return null
  const source = pluginValue(owner, 'mermaid/source')
  if (source === null) return null
  const state = readSourceReconciliation(owner)
  return {
    status: 'current',
    source,
    revision: state?.revision ?? 1,
    message: 'Mermaid SVG is derived directly from this source.'
  }
}
