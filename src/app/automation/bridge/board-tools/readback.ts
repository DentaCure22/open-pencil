import { computeAbsoluteBounds, type Rect, type SceneNode } from '@open-pencil/scene-graph'

import type { AutomationTarget } from '@/app/automation/bridge/target'

export function nodeBounds(target: AutomationTarget, node: SceneNode): Rect {
  return computeAbsoluteBounds([node], (id) => target.store.graph.getAbsolutePosition(id))
}
