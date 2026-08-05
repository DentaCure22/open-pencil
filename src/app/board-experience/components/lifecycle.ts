import type { SceneNode } from '@open-pencil/scene-graph'

import type { BoardComponentLifecycle, BoardComponentSessionContext } from './contracts'

export const COMPONENT_LIFECYCLE_PLUGIN_ID = 'openpencil-board-permissions'
export const COMPONENT_LIFECYCLE_KEY = 'component-lifecycle'
export const COMPONENT_SESSION_KEY = 'component-session'

export function componentLifecycle(node: SceneNode): BoardComponentLifecycle {
  return node.pluginData.some(
    (entry) =>
      entry.pluginId === COMPONENT_LIFECYCLE_PLUGIN_ID &&
      entry.key === COMPONENT_LIFECYCLE_KEY &&
      entry.value === 'transient'
  )
    ? 'transient'
    : 'durable'
}

export function componentSessionMatches(
  node: SceneNode,
  owner: BoardComponentSessionContext
): boolean {
  return node.pluginData.some(
    (entry) =>
      entry.pluginId === COMPONENT_LIFECYCLE_PLUGIN_ID &&
      entry.key === COMPONENT_SESSION_KEY &&
      entry.value === owner.sessionId
  )
}
