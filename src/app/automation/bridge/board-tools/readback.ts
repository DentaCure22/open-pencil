import { computeAbsoluteBounds, type Rect, type SceneNode } from '@open-pencil/scene-graph'

import type { AutomationTarget } from '@/app/automation/bridge/target'

export function nodeBounds(target: AutomationTarget, node: SceneNode): Rect {
  return computeAbsoluteBounds([node], (id) => target.store.graph.getAbsolutePosition(id))
}

export function nodeSummary(target: AutomationTarget, node: SceneNode) {
  return {
    bounds: nodeBounds(target, node),
    child_ids: [...node.childIds],
    id: node.id,
    name: node.name,
    parent_id: node.parentId,
    text: node.type === 'TEXT' ? node.text : undefined,
    type: node.type,
    visible: node.visible
  }
}
