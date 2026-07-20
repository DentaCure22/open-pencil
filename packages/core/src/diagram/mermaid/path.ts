import type { Fill, PluginDataEntry, Stroke, VectorNetwork } from '@open-pencil/scene-graph'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import type { Color, Rect } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'

import { finite, positive } from './geometry'
import type { MermaidSceneNodeSpec, MermaidSkeletonElement } from './types'

const MIN_NODE_SIZE = 1
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0] as const

function clampedOpacity(value: number | undefined): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? (value ?? 1) : 1))
}

function solidFill(color: Color, opacity: number): Fill {
  const alpha = clampedOpacity(opacity)
  return { type: 'SOLID', color, opacity: alpha, visible: color.a * alpha > 0 }
}

function paintWithOpacity(paint: Fill, opacity: number): Fill {
  const next: Fill = {
    ...paint,
    color: { ...paint.color },
    opacity: paint.opacity * clampedOpacity(opacity),
    visible: paint.visible && paint.opacity * clampedOpacity(opacity) > 0
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

function strokeCap(value: string | undefined): Stroke['cap'] {
  if (value === 'round') return 'ROUND'
  if (value === 'square') return 'SQUARE'
  return 'NONE'
}

function strokeJoin(value: string | undefined): Stroke['join'] {
  if (value === 'round') return 'ROUND'
  if (value === 'bevel') return 'BEVEL'
  return 'MITER'
}

function pathStroke(
  element: MermaidSkeletonElement,
  color: Color,
  opacity: number,
  paint?: Fill
): Stroke {
  const alpha = clampedOpacity(opacity)
  return {
    align: 'CENTER',
    cap: strokeCap(element.strokeLineCap),
    color,
    dashPattern: element.strokeDasharray ?? [],
    join: strokeJoin(element.strokeLineJoin),
    opacity: alpha,
    paint: paint ? paintWithOpacity(paint, 1) : undefined,
    visible: color.a * alpha > 0,
    weight: positive(element.strokeWidth, 1)
  }
}

function transformNetwork(
  network: VectorNetwork,
  matrix: readonly [number, number, number, number, number, number]
): void {
  const [a, b, c, d, e, f] = matrix
  for (const vertex of network.vertices) {
    const { x, y } = vertex
    vertex.x = a * x + c * y + e
    vertex.y = b * x + d * y + f
  }
  for (const segment of network.segments) {
    const start = segment.tangentStart
    const end = segment.tangentEnd
    segment.tangentStart = { x: a * start.x + c * start.y, y: b * start.x + d * start.y }
    segment.tangentEnd = { x: a * end.x + c * end.y, y: b * end.x + d * end.y }
  }
}

function networkBounds(network: VectorNetwork): Rect {
  const controlPoints = network.segments.flatMap((segment) => {
    const start = network.vertices[segment.start]
    const end = network.vertices[segment.end]
    return [
      { x: start.x + segment.tangentStart.x, y: start.y + segment.tangentStart.y },
      { x: end.x + segment.tangentEnd.x, y: end.y + segment.tangentEnd.y }
    ]
  })
  const points = [...network.vertices, ...controlPoints]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(MIN_NODE_SIZE, Math.max(...xs) - x),
    height: Math.max(MIN_NODE_SIZE, Math.max(...ys) - y)
  }
}

export function svgPathSpec(
  element: MermaidSkeletonElement,
  key: string,
  pluginData: PluginDataEntry[]
): MermaidSceneNodeSpec | null {
  if (!element.path) return null
  const network = parseSVGPath(element.path, element.fillRule)
  if (network.vertices.length === 0) return null
  transformNetwork(network, element.transform ?? IDENTITY_MATRIX)

  const fallback = networkBounds(network)
  const x = finite(element.x, fallback.x)
  const y = finite(element.y, fallback.y)
  for (const vertex of network.vertices) {
    vertex.x -= x
    vertex.y -= y
  }

  const overallOpacity = clampedOpacity(element.opacity)
  const fillOpacity = overallOpacity * clampedOpacity(element.fillOpacity)
  const strokeOpacity = overallOpacity * clampedOpacity(element.strokeOpacity)
  const fillColor =
    element.backgroundColor && element.backgroundColor !== 'none'
      ? parseColor(element.backgroundColor)
      : null
  const fallbackStrokeColor = element.strokePaint?.gradientStops?.[0]?.color
  const strokeColor = element.strokePaint
    ? fallbackStrokeColor
    : element.strokeColor && element.strokeColor !== 'none'
      ? parseColor(element.strokeColor)
      : fallbackStrokeColor

  return {
    key,
    type: 'VECTOR',
    props: {
      name: element.name || 'Mermaid vector',
      x,
      y,
      width: positive(element.width, fallback.width),
      height: positive(element.height, fallback.height),
      fills: element.fillPaint
        ? [paintWithOpacity(element.fillPaint, fillOpacity)]
        : fillColor
          ? [solidFill(fillColor, fillOpacity)]
          : [],
      strokes: strokeColor
        ? [pathStroke(element, strokeColor, strokeOpacity, element.strokePaint)]
        : [],
      vectorNetwork: network,
      blendMode: element.blendMode,
      strokeCap: strokeCap(element.strokeLineCap),
      strokeJoin: strokeJoin(element.strokeLineJoin),
      dashPattern: element.strokeDasharray ?? [],
      pluginData
    }
  }
}
