import type { Fill, Stroke } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'

import { positive } from './geometry'
import { diagramShapeColor, diagramStrokeColor } from './palette'
import type { MermaidAppearance, MermaidSkeletonElement } from './types'

export function clampedOpacity(value: number | undefined): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? (value ?? 1) : 1))
}

export function solidFill(color: Color, opacity = 1): Fill {
  const alpha = clampedOpacity(color.a) * clampedOpacity(opacity)
  return {
    type: 'SOLID',
    color: { ...color, a: 1 },
    opacity: alpha,
    visible: alpha > 0
  }
}

export function paintWithOpacity(paint: Fill, opacity: number): Fill {
  const alpha = paint.opacity * clampedOpacity(opacity)
  const next: Fill = {
    ...paint,
    color: { ...paint.color },
    opacity: alpha,
    visible: paint.visible && alpha > 0
  }
  if (paint.gradientStops) {
    next.gradientStops = paint.gradientStops.map((stop) => ({
      ...stop,
      color: { ...stop.color }
    }))
  }
  if (paint.gradientTransform) next.gradientTransform = { ...paint.gradientTransform }
  return next
}

export function strokeCap(value: string | undefined): Stroke['cap'] {
  if (value === 'round') return 'ROUND'
  if (value === 'square') return 'SQUARE'
  return 'NONE'
}

export function strokeJoin(value: string | undefined): Stroke['join'] {
  if (value === 'round') return 'ROUND'
  if (value === 'bevel') return 'BEVEL'
  return 'MITER'
}

export function skeletonStroke(
  element: MermaidSkeletonElement,
  color: Color,
  opacity: number,
  paint?: Fill
): Stroke {
  const alpha = clampedOpacity(color.a) * clampedOpacity(opacity)
  const dashPattern =
    element.strokeDasharray ??
    (element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted' ? [8, 6] : [])
  return {
    align: 'CENTER',
    cap: strokeCap(element.strokeLineCap),
    color: { ...color, a: 1 },
    dashPattern,
    join: strokeJoin(element.strokeLineJoin),
    opacity: alpha,
    paint: paint ? paintWithOpacity(paint, 1) : undefined,
    visible: alpha > 0,
    weight: positive(element.strokeWidth, 1)
  }
}

export function skeletonShapeStyle(
  element: MermaidSkeletonElement,
  appearance: MermaidAppearance
): { fills: Fill[]; strokes: Stroke[] } {
  const overallOpacity = clampedOpacity(element.opacity)
  const fillOpacity = overallOpacity * clampedOpacity(element.fillOpacity)
  const strokeOpacity = overallOpacity * clampedOpacity(element.strokeOpacity)
  const fillColor = parseColor(diagramShapeColor(element.backgroundColor, appearance))
  const strokeColor = element.strokePaint?.gradientStops?.[0]?.color
    ? { ...element.strokePaint.gradientStops[0].color }
    : parseColor(diagramStrokeColor(element.strokeColor, appearance))
  const fills = element.fillPaint
    ? [paintWithOpacity(element.fillPaint, fillOpacity)]
    : element.backgroundColor === 'none'
      ? []
      : [solidFill(fillColor, fillOpacity)]
  const strokes =
    element.strokeColor === 'none' && !element.strokePaint
      ? []
      : [skeletonStroke(element, strokeColor, strokeOpacity, element.strokePaint)]
  return { fills, strokes }
}
