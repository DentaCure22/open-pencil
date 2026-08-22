import { computeAbsoluteBounds, type SceneNode } from '@open-pencil/scene-graph'

import type { AutomationTarget } from '@/app/automation/bridge/target'

export function automationNodeSummary(target: AutomationTarget, node: SceneNode) {
  return {
    bounds: computeAbsoluteBounds([node], (id) => target.store.graph.getAbsolutePosition(id)),
    child_ids: [...node.childIds],
    id: node.id,
    name: node.name,
    parent_id: node.parentId,
    text: node.type === 'TEXT' ? node.text : undefined,
    type: node.type,
    visible: node.visible
  }
}
