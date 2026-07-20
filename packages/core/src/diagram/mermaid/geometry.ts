import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { MermaidLabel } from './types'

export type AbsolutePoint = readonly [number, number]

export function finite(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? (value ?? fallback) : fallback
}

export function positive(value: number | null | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? (value ?? fallback) : fallback
}

export function normalizedDirection(from: AbsolutePoint, to: AbsolutePoint): Vector {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const length = Math.hypot(dx, dy) || 1
  return { x: dx / length, y: dy / length }
}

export function offset(point: AbsolutePoint, direction: Vector, distance: number): AbsolutePoint {
  return [point[0] + direction.x * distance, point[1] + direction.y * distance]
}

export function labelVerticalPosition(
  y: number,
  height: number,
  labelHeight: number,
  align: MermaidLabel['verticalAlign']
): number {
  if (align === 'top') return y + 6
  if (align === 'bottom') return y + height - labelHeight - 6
  return y + (height - labelHeight) / 2
}
