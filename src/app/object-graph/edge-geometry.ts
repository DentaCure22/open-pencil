import type { Vector } from '@open-pencil/scene-graph'

import type { ObjectGraphPortAnchor } from '@/app/object-graph/projection'

export type ObjectGraphEdgeGeometry = {
  label: Vector
  path: string
}

const MIN_CONTROL_DISTANCE = 32
const MAX_CONTROL_DISTANCE = 220
const CONTROL_DISTANCE_RATIO = 0.35

function cubicPoint(
  source: Vector,
  sourceControl: Vector,
  targetControl: Vector,
  target: Vector,
  progress: number
): Vector {
  const remaining = 1 - progress
  const sourceWeight = remaining ** 3
  const sourceControlWeight = 3 * remaining ** 2 * progress
  const targetControlWeight = 3 * remaining * progress ** 2
  const targetWeight = progress ** 3
  return {
    x:
      sourceWeight * source.x +
      sourceControlWeight * sourceControl.x +
      targetControlWeight * targetControl.x +
      targetWeight * target.x,
    y:
      sourceWeight * source.y +
      sourceControlWeight * sourceControl.y +
      targetControlWeight * targetControl.y +
      targetWeight * target.y
  }
}

export function objectGraphEdgeGeometry(
  source: ObjectGraphPortAnchor,
  target: ObjectGraphPortAnchor
): ObjectGraphEdgeGeometry {
  const distance = Math.hypot(target.point.x - source.point.x, target.point.y - source.point.y)
  const controlDistance = Math.min(
    MAX_CONTROL_DISTANCE,
    Math.max(MIN_CONTROL_DISTANCE, distance * CONTROL_DISTANCE_RATIO)
  )
  const sourceControl = {
    x: source.point.x + source.normal.x * controlDistance,
    y: source.point.y + source.normal.y * controlDistance
  }
  const targetControl = {
    x: target.point.x + target.normal.x * controlDistance,
    y: target.point.y + target.normal.y * controlDistance
  }

  return {
    label: cubicPoint(source.point, sourceControl, targetControl, target.point, 0.5),
    path: [
      `M ${source.point.x} ${source.point.y}`,
      `C ${sourceControl.x} ${sourceControl.y}`,
      `${targetControl.x} ${targetControl.y}`,
      `${target.point.x} ${target.point.y}`
    ].join(' ')
  }
}

export function objectGraphArrowRotation(target: ObjectGraphPortAnchor): number {
  return (Math.atan2(-target.normal.y, -target.normal.x) * 180) / Math.PI
}
