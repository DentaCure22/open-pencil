import type { Rect } from '@open-pencil/scene-graph'

import type { AutomationTarget } from '@/app/automation/bridge/target'

import {
  requireVisibleBoardAnchor,
  resolveNearestFreePlacement,
  visibleBoardObstacles,
  type BoardPlacementDirection,
  type BoardPlacementResult,
  type BoardPlacementTarget,
  type BoardRelativePlacementOffset
} from '../placement'
import { nodeBounds } from '../readback'

type NativeFallbackPlacementTarget = Exclude<
  BoardPlacementTarget,
  { kind: 'anchor' } | { kind: 'relative' }
>

type NativeNearestPlacementOperation = {
  clearance: number
  placementTarget: BoardPlacementTarget
  preferredDirections: BoardPlacementDirection[]
  relativeOffset?: BoardRelativePlacementOffset
}

type NativeNearestPlacementResolution =
  | { kind: 'fallback'; obstacles: Rect[]; placementTarget: NativeFallbackPlacementTarget }
  | { kind: 'nearest'; placement: BoardPlacementResult | null }

export function resolveNativePlacement(
  target: AutomationTarget,
  operation: NativeNearestPlacementOperation,
  footprint: Pick<Rect, 'height' | 'width'>
): NativeNearestPlacementResolution {
  const obstacles = visibleBoardObstacles(target)
  const placementTarget = operation.placementTarget
  if (placementTarget.kind !== 'anchor' && placementTarget.kind !== 'relative') {
    return { kind: 'fallback', obstacles, placementTarget }
  }
  const anchorId =
    placementTarget.kind === 'anchor' ? placementTarget.anchorId : placementTarget.objectId
  return {
    kind: 'nearest',
    placement: resolveNearestFreePlacement({
      anchor: nodeBounds(target, requireVisibleBoardAnchor(target, anchorId)),
      clearance: operation.clearance,
      footprint,
      obstacles,
      preferredDirections: operation.preferredDirections,
      ...(operation.relativeOffset ? { relativeOffset: operation.relativeOffset } : {})
    })
  }
}
