import type { PluginDataEntry, VectorNetwork } from '@open-pencil/scene-graph'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'

import { finite, positive } from './geometry'
import { diagramPathFillColor, diagramPathStrokeColor } from './palette'
import {
  clampedOpacity,
  paintWithOpacity,
  skeletonStroke,
  solidFill,
  strokeCap,
  strokeJoin
} from './style'
import type { MermaidAppearance, MermaidSceneNodeSpec, MermaidSkeletonElement } from './types'

const MIN_NODE_SIZE = 1
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0] as const

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
  pluginData: PluginDataEntry[],
  appearance: MermaidAppearance
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
      ? parseColor(diagramPathFillColor(element.backgroundColor, appearance))
      : null
  const fallbackStrokeColor = element.strokePaint?.gradientStops?.[0]?.color
  const strokeColor = element.strokePaint
    ? fallbackStrokeColor
    : element.strokeColor && element.strokeColor !== 'none'
      ? parseColor(diagramPathStrokeColor(element.strokeColor, appearance))
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
        ? [skeletonStroke(element, strokeColor, strokeOpacity, element.strokePaint)]
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
