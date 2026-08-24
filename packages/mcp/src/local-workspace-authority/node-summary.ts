import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export function authorityNodeSummary(graph: SceneGraph, node: SceneNode) {
  return {
    bounds: graph.getAbsoluteBounds(node.id),
    child_ids: [...node.childIds],
    id: node.id,
    name: node.name,
    parent_id: node.parentId,
    ...(node.type === 'TEXT' ? { text: node.text } : {}),
    type: node.type,
    visible: node.visible
  }
}
