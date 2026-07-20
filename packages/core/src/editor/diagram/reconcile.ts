import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  mergeSourceReconciliationPluginData,
  readSourceReconciliation,
  sourceSceneSignature,
  type SourceReconciliationResult
} from '#core/io/content-source'

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

export function mermaidDiagramOwner(graph: SceneGraph, nodeId: string): SceneNode | null {
  let node = graph.getNode(nodeId)
  const diagramId = node ? pluginValue(node, 'mermaid/diagram-id') : null
  if (!node || !diagramId) return null

  while (node.parentId) {
    const parent = graph.getNode(node.parentId)
    if (!parent || pluginValue(parent, 'mermaid/diagram-id') !== diagramId) break
    node = parent
  }
  return node
}

export function initializeMermaidSourceReconciliation(graph: SceneGraph, ownerId: string): void {
  const owner = graph.getNode(ownerId)
  const baseline = sourceSceneSignature(graph, ownerId)
  if (!owner || !baseline) return
  graph.updateNode(owner.id, {
    pluginData: mergeSourceReconciliationPluginData(owner.pluginData, {
      status: 'current',
      message: 'Source matches the editable Mermaid projection.',
      baseline,
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
  const revision = state?.revision ?? 1
  if (state?.baseline && sourceSceneSignature(graph, owner.id) === state.baseline) {
    return {
      status: 'current',
      source,
      revision,
      message: 'Source matches the editable Mermaid projection.'
    }
  }
  return {
    status: 'unsupported',
    source,
    revision,
    message:
      'Original Mermaid source was preserved. Native diagram edits cannot be regenerated safely yet.'
  }
}
