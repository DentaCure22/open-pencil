import type { Editor, ViewportInsets } from '@open-pencil/core/editor'
import type { SceneNode, Vector } from '@open-pencil/scene-graph'

import {
  SPATIAL_DIRECTION_VECTORS,
  type SpatialNavigationDirection
} from '@/app/editor/spatial-navigation'

export type SpatialSelectionNavigation = {
  navigateInDirection: (direction: SpatialNavigationDirection, insets?: ViewportInsets) => boolean
}

type DirectionalCandidate = {
  distance: number
  id: string
  name: string
  offAxisRatio: number
}

function isNavigable(node: SceneNode): boolean {
  return node.type !== 'CANVAS' && node.visible && !node.locked && !node.internalOnly
}

function nodeCenter(editor: Editor, node: SceneNode): Vector {
  const position = editor.graph.getAbsolutePosition(node.id)
  return {
    x: position.x + node.width / 2,
    y: position.y + node.height / 2
  }
}

function nearestNodeInDirection(
  editor: Editor,
  anchor: SceneNode,
  candidates: SceneNode[],
  direction: SpatialNavigationDirection
): SceneNode | null {
  const origin = nodeCenter(editor, anchor)
  const vector = SPATIAL_DIRECTION_VECTORS[direction]
  const directional: DirectionalCandidate[] = []

  for (const candidate of candidates) {
    if (candidate.id === anchor.id || !isNavigable(candidate)) continue
    const target = nodeCenter(editor, candidate)
    const dx = target.x - origin.x
    const dy = target.y - origin.y
    const primary = dx * vector.x + dy * vector.y
    const perpendicular = Math.abs(dx * vector.y - dy * vector.x)
    if (primary <= 0 || perpendicular > primary) continue
    directional.push({
      distance: Math.hypot(dx, dy),
      id: candidate.id,
      name: candidate.name,
      offAxisRatio: perpendicular / primary
    })
  }

  directional.sort(
    (first, second) =>
      first.distance - second.distance ||
      first.offAxisRatio - second.offAxisRatio ||
      first.name.localeCompare(second.name) ||
      first.id.localeCompare(second.id)
  )
  const target = directional[0]
  return target ? (editor.graph.getNode(target.id) ?? null) : null
}

export function createSpatialSelectionNavigation(editor: Editor): SpatialSelectionNavigation {
  function navigateInDirection(
    direction: SpatialNavigationDirection,
    insets?: ViewportInsets
  ): boolean {
    if (editor.state.selectedIds.size !== 1) return false
    const selectedId = editor.state.selectedIds.values().next().value
    let anchor = typeof selectedId === 'string' ? editor.graph.getNode(selectedId) : undefined
    if (!anchor || anchor.type === 'CANVAS') return false

    while (anchor.parentId) {
      const target = nearestNodeInDirection(
        editor,
        anchor,
        editor.graph.getChildren(anchor.parentId),
        direction
      )
      if (target) {
        editor.select([target.id])
        editor.centerNode(target.id, insets)
        return true
      }

      const parent = editor.graph.getNode(anchor.parentId)
      if (!parent || parent.type === 'CANVAS') break
      anchor = parent
    }

    return false
  }

  return { navigateInDirection }
}
