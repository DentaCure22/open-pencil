import { parseCodeObjectDocument } from '@open-pencil/core/code-object'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export function authorityNodeClassification(node: SceneNode) {
  const codeObject = parseCodeObjectDocument(node)
  if (!codeObject) return {}
  return {
    code_object_component: codeObject.component,
    role: codeObject.component === 'agent-conversation-terminal' ? 'agent_card' : 'code_object'
  }
}

export function authorityNodeSummary(graph: SceneGraph, node: SceneNode) {
  return {
    bounds: graph.getAbsoluteBounds(node.id),
    child_ids: [...node.childIds],
    ...authorityNodeClassification(node),
    id: node.id,
    name: node.name,
    parent_id: node.parentId,
    ...(node.type === 'TEXT' ? { text: node.text } : {}),
    type: node.type,
    visible: node.visible
  }
}
