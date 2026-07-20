import type {
  Fill,
  PluginDataEntry,
  Stroke,
  VectorNetwork,
  VectorSegment,
  VectorVertex
} from '@open-pencil/scene-graph'
import type { Color, Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'

import {
  finite,
  labelVerticalPosition,
  normalizedDirection,
  offset,
  positive,
  type AbsolutePoint
} from './geometry'
import {
  DEFAULT_SHAPE_COLOR,
  diagramShapeColor,
  diagramStrokeColor,
  diagramTextColor
} from './palette'
import { svgPathSpec } from './path'
import { diagramTextAlign, diagramTextVerticalAlign, estimateTextSize } from './text'
import type {
  MermaidDiagram,
  MermaidLabel,
  MermaidSceneNodeSpec,
  MermaidSceneSpec,
  MermaidSkeletonElement
} from './types'

const MIN_NODE_SIZE = 1
const MARKER_SIZE = 10

type MarkerKind = 'arrow' | 'bar' | 'circle' | 'crow' | 'diamond'

interface LineStyle {
  color: Color
  width: number
  dashed: boolean
}

function solidFill(color: Color): Fill {
  return { type: 'SOLID', color, opacity: color.a, visible: color.a > 0 }
}

function lineStroke(style: LineStyle): Stroke {
  return {
    color: style.color,
    weight: style.width,
    opacity: style.color.a,
    visible: style.color.a > 0,
    align: 'CENTER',
    cap: 'ROUND',
    join: 'ROUND',
    dashPattern: style.dashed ? [8, 6] : []
  }
}

function elementPluginData(element: MermaidSkeletonElement, index: number): PluginDataEntry[] {
  const data: PluginDataEntry[] = [
    {
      pluginId: 'open-pencil',
      key: 'mermaid/element-id',
      value: element.id ?? `element-${index + 1}`
    }
  ]
  if (element.groupIds?.length) {
    data.push({
      pluginId: 'open-pencil',
      key: 'mermaid/group-ids',
      value: JSON.stringify(element.groupIds)
    })
  }
  return data
}

function elementKey(element: MermaidSkeletonElement, index: number, suffix = ''): string {
  const base = element.id?.trim() || `${element.type}-${index + 1}`
  return suffix ? `${base}:${suffix}` : base
}

function textSpec(
  key: string,
  text: string,
  rect: Rect,
  fontSize: number,
  color: string | null | undefined,
  label?: MermaidLabel,
  pluginData: PluginDataEntry[] = [],
  element?: MermaidSkeletonElement
): MermaidSceneNodeSpec {
  const textColor = parseColor(diagramTextColor(color))
  textColor.a *= Math.min(1, Math.max(0, (element?.opacity ?? 1) * (element?.fillOpacity ?? 1)))
  return {
    key,
    type: 'TEXT',
    props: {
      name: text.split('\n')[0]?.slice(0, 80) || 'Diagram label',
      x: rect.x,
      y: rect.y,
      width: Math.max(MIN_NODE_SIZE, rect.width),
      height: Math.max(MIN_NODE_SIZE, rect.height),
      text,
      fontSize,
      fontFamily: element?.fontFamily,
      fontWeight: element?.fontWeight ?? 400,
      lineHeight: fontSize * 1.25,
      textAlignHorizontal: diagramTextAlign(label),
      textAlignVertical: diagramTextVerticalAlign(label),
      textAutoResize: 'NONE',
      fills: [solidFill(textColor)],
      pluginData
    }
  }
}

function shapeStyle(element: MermaidSkeletonElement): {
  fills: Fill[]
  strokes: Stroke[]
} {
  const fillColor = parseColor(diagramShapeColor(element.backgroundColor))
  const stroke = lineStroke({
    color: parseColor(diagramStrokeColor(element.strokeColor)),
    width: positive(element.strokeWidth, 2),
    dashed: element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted'
  })
  return { fills: [solidFill(fillColor)], strokes: [stroke] }
}

function openNetwork(points: readonly AbsolutePoint[]): VectorNetwork {
  const vertices: VectorVertex[] = points.map(([x, y]) => ({ x, y }))
  const segments: VectorSegment[] = points.slice(1).map((_, index) => ({
    start: index,
    end: index + 1,
    tangentStart: { x: 0, y: 0 },
    tangentEnd: { x: 0, y: 0 }
  }))
  return { vertices, segments, regions: [] }
}

function polygonNetwork(points: readonly AbsolutePoint[]): VectorNetwork {
  const vertices: VectorVertex[] = points.map(([x, y]) => ({ x, y }))
  const segments: VectorSegment[] = points.map((_, index) => ({
    start: index,
    end: (index + 1) % points.length,
    tangentStart: { x: 0, y: 0 },
    tangentEnd: { x: 0, y: 0 }
  }))
  return {
    vertices,
    segments,
    regions: [{ windingRule: 'NONZERO', loops: [segments.map((_, index) => index)] }]
  }
}

function vectorBounds(points: readonly AbsolutePoint[]): {
  x: number
  y: number
  width: number
  height: number
  local: AbsolutePoint[]
} {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const width = Math.max(MIN_NODE_SIZE, Math.max(...xs) - x)
  const height = Math.max(MIN_NODE_SIZE, Math.max(...ys) - y)
  return { x, y, width, height, local: points.map(([px, py]) => [px - x, py - y]) }
}

function openVectorSpec(
  key: string,
  points: readonly AbsolutePoint[],
  style: LineStyle,
  pluginData: PluginDataEntry[] = []
): MermaidSceneNodeSpec | null {
  if (points.length < 2) return null
  const bounds = vectorBounds(points)
  return {
    key,
    type: 'VECTOR',
    props: {
      name: 'Diagram connector',
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fills: [],
      strokes: [lineStroke(style)],
      vectorNetwork: openNetwork(bounds.local),
      strokeCap: 'ROUND',
      strokeJoin: 'ROUND',
      dashPattern: style.dashed ? [8, 6] : [],
      pluginData
    }
  }
}

function polygonVectorSpec(
  key: string,
  name: string,
  points: readonly AbsolutePoint[],
  color: Color,
  pluginData: PluginDataEntry[] = []
): MermaidSceneNodeSpec {
  const bounds = vectorBounds(points)
  return {
    key,
    type: 'VECTOR',
    props: {
      name,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      fills: [solidFill(color)],
      strokes: [],
      vectorNetwork: polygonNetwork(bounds.local),
      pluginData
    }
  }
}

function elementPoints(element: MermaidSkeletonElement): AbsolutePoint[] {
  const x = finite(element.x)
  const y = finite(element.y)
  if (element.points?.length) {
    return element.points.flatMap((point) => {
      const [px, py] = point
      return Number.isFinite(px) && Number.isFinite(py)
        ? ([[x + px, y + py]] as AbsolutePoint[])
        : []
    })
  }
  return [
    [x, y],
    [x + finite(element.width), y + finite(element.height)]
  ]
}

function markerKinds(value: string | null | undefined, fallbackArrow: boolean): MarkerKind[] {
  if (value === null) return []
  switch (value) {
    case 'bar':
    case 'cardinality_one':
    case 'cardinality_exactly_one':
      return ['bar']
    case 'circle':
      return ['circle']
    case 'diamond':
    case 'diamond_outline':
      return ['diamond']
    case 'cardinality_many':
      return ['crow']
    case 'cardinality_one_or_many':
      return ['bar', 'crow']
    case 'cardinality_zero_or_one':
      return ['circle', 'bar']
    case 'cardinality_zero_or_many':
      return ['circle', 'crow']
    case 'arrow':
    case 'triangle':
      return ['arrow']
    case undefined:
      return fallbackArrow ? ['arrow'] : []
    default:
      return fallbackArrow ? ['arrow'] : []
  }
}

function markerSpecs(
  key: string,
  point: AbsolutePoint,
  direction: Vector,
  kinds: MarkerKind[],
  style: LineStyle,
  pluginData: PluginDataEntry[]
): MermaidSceneNodeSpec[] {
  const perp = { x: -direction.y, y: direction.x }
  const specs: MermaidSceneNodeSpec[] = []
  let cursor = point

  for (const [index, kind] of kinds.entries()) {
    const markerKey = `${key}:marker-${index + 1}-${kind}`
    if (kind === 'arrow') {
      const back = offset(cursor, direction, -MARKER_SIZE)
      specs.push(
        polygonVectorSpec(
          markerKey,
          'Arrowhead',
          [cursor, offset(back, perp, 5), offset(back, perp, -5)],
          style.color,
          pluginData
        )
      )
      cursor = offset(cursor, direction, -MARKER_SIZE - 3)
      continue
    }

    if (kind === 'diamond') {
      const middle = offset(cursor, direction, -5)
      const back = offset(cursor, direction, -10)
      specs.push(
        polygonVectorSpec(
          markerKey,
          'Diamond marker',
          [cursor, offset(middle, perp, 4), back, offset(middle, perp, -4)],
          style.color,
          pluginData
        )
      )
      cursor = offset(cursor, direction, -14)
      continue
    }

    if (kind === 'circle') {
      const center = offset(cursor, direction, -5)
      specs.push({
        key: markerKey,
        type: 'ELLIPSE',
        props: {
          name: 'Circle marker',
          x: center[0] - 4,
          y: center[1] - 4,
          width: 8,
          height: 8,
          fills: [solidFill(parseColor(DEFAULT_SHAPE_COLOR))],
          strokes: [lineStroke(style)],
          pluginData
        }
      })
      cursor = offset(cursor, direction, -13)
      continue
    }

    const center = offset(cursor, direction, -2)
    const points =
      kind === 'bar'
        ? [offset(center, perp, 5), offset(center, perp, -5)]
        : [
            center,
            offset(offset(center, direction, -9), perp, 6),
            center,
            offset(center, direction, -9),
            center,
            offset(offset(center, direction, -9), perp, -6)
          ]
    const vector = openVectorSpec(markerKey, points, { ...style, dashed: false }, pluginData)
    if (vector) specs.push(vector)
    cursor = offset(cursor, direction, kind === 'bar' ? -7 : -13)
  }
  return specs
}

function containerSpecs(element: MermaidSkeletonElement, index: number): MermaidSceneNodeSpec[] {
  const x = finite(element.x)
  const y = finite(element.y)
  const width = positive(element.width, 120)
  const height = positive(element.height, 64)
  const pluginData = elementPluginData(element, index)
  const style = shapeStyle(element)
  const type = element.type === 'ellipse' ? 'ELLIPSE' : 'RECTANGLE'
  const key = elementKey(element, index)
  const specs: MermaidSceneNodeSpec[] = []

  if (element.type === 'diamond') {
    specs.push(
      polygonVectorSpec(
        key,
        element.label?.text || 'Decision',
        [
          [x + width / 2, y],
          [x + width, y + height / 2],
          [x + width / 2, y + height],
          [x, y + height / 2]
        ],
        style.fills[0].color,
        pluginData
      )
    )
    specs[0].props.strokes = style.strokes
  } else {
    specs.push({
      key,
      type,
      props: {
        name: element.label?.text || element.name || 'Diagram node',
        x,
        y,
        width,
        height,
        cornerRadius: type === 'RECTANGLE' && element.roundness ? Math.min(width, height) / 2 : 6,
        ...style,
        pluginData
      }
    })
  }

  const labelText = element.label?.text?.trim()
  if (labelText) {
    const fontSize = positive(element.label?.fontSize, 16)
    const labelHeight = Math.min(height, estimateTextSize(labelText, fontSize).height + 8)
    const labelY = labelVerticalPosition(y, height, labelHeight, element.label?.verticalAlign)
    specs.push(
      textSpec(
        elementKey(element, index, 'label'),
        labelText,
        {
          x: x + 8,
          y: labelY,
          width: Math.max(MIN_NODE_SIZE, width - 16),
          height: Math.max(MIN_NODE_SIZE, labelHeight)
        },
        fontSize,
        element.label?.strokeColor || element.label?.color,
        element.label,
        pluginData
      )
    )
  }
  return specs
}

function standaloneTextSpec(element: MermaidSkeletonElement, index: number): MermaidSceneNodeSpec {
  const text = element.text || ''
  const fontSize = positive(element.fontSize, 16)
  const estimated = estimateTextSize(text, fontSize)
  return textSpec(
    elementKey(element, index),
    text,
    {
      x: finite(element.x),
      y: finite(element.y),
      width: positive(element.width, estimated.width),
      height: positive(element.height, estimated.height)
    },
    fontSize,
    element.strokeColor,
    undefined,
    elementPluginData(element, index),
    element
  )
}

function linearSpecs(element: MermaidSkeletonElement, index: number): MermaidSceneNodeSpec[] {
  const points = elementPoints(element)
  const pluginData = elementPluginData(element, index)
  const style: LineStyle = {
    color: parseColor(diagramStrokeColor(element.strokeColor)),
    width: positive(element.strokeWidth, 2),
    dashed: element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted'
  }
  const key = elementKey(element, index)
  const specs: MermaidSceneNodeSpec[] = []
  const body = openVectorSpec(key, points, style, pluginData)
  if (body) specs.push(body)

  if (element.type === 'arrow' && points.length >= 2) {
    const start = points[0]
    const startNext = points[1]
    const end = points[points.length - 1]
    const endPrevious = points[points.length - 2]
    specs.push(
      ...markerSpecs(
        `${key}:start`,
        start,
        normalizedDirection(startNext, start),
        markerKinds(element.startArrowhead, false),
        style,
        pluginData
      ),
      ...markerSpecs(
        `${key}:end`,
        end,
        normalizedDirection(endPrevious, end),
        markerKinds(element.endArrowhead, element.endArrowhead === undefined),
        style,
        pluginData
      )
    )
  }

  const labelText = element.label?.text?.trim()
  if (labelText) {
    const fontSize = positive(element.label?.fontSize, 16)
    const size = estimateTextSize(labelText, fontSize)
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2
    specs.push(
      textSpec(
        `${key}:label`,
        labelText,
        {
          x: centerX - size.width / 2 - 4,
          y: centerY - size.height / 2 - 3,
          width: size.width + 8,
          height: size.height + 6
        },
        fontSize,
        element.label?.strokeColor,
        element.label,
        pluginData
      )
    )
  }
  return specs
}

function svgPathMarkerSpecs(
  element: MermaidSkeletonElement,
  index: number,
  path: MermaidSceneNodeSpec
): MermaidSceneNodeSpec[] {
  const network = path.props.vectorNetwork
  const firstSegment = network?.segments[0]
  const lastSegment = network?.segments.at(-1)
  if (!network || !firstSegment || !lastSegment) return []

  const nodeX = finite(path.props.x)
  const nodeY = finite(path.props.y)
  const pluginData = elementPluginData(element, index)
  const style: LineStyle = {
    color:
      element.strokePaint?.gradientStops?.[0]?.color ??
      parseColor(diagramStrokeColor(element.strokeColor)),
    width: positive(element.strokeWidth, 2),
    dashed: false
  }
  const startVertex = network.vertices[firstSegment.start]
  const startControl = {
    x: startVertex.x + firstSegment.tangentStart.x,
    y: startVertex.y + firstSegment.tangentStart.y
  }
  const startFrom =
    Math.hypot(firstSegment.tangentStart.x, firstSegment.tangentStart.y) > 0.001
      ? startControl
      : network.vertices[firstSegment.end]
  const endVertex = network.vertices[lastSegment.end]
  const endControl = {
    x: endVertex.x + lastSegment.tangentEnd.x,
    y: endVertex.y + lastSegment.tangentEnd.y
  }
  const endFrom =
    Math.hypot(lastSegment.tangentEnd.x, lastSegment.tangentEnd.y) > 0.001
      ? endControl
      : network.vertices[lastSegment.start]
  const start: AbsolutePoint = [nodeX + startVertex.x, nodeY + startVertex.y]
  const end: AbsolutePoint = [nodeX + endVertex.x, nodeY + endVertex.y]
  const specs: MermaidSceneNodeSpec[] = []

  specs.push(
    ...markerSpecs(
      `${path.key}:start`,
      start,
      normalizedDirection([nodeX + startFrom.x, nodeY + startFrom.y], start),
      markerKinds(element.startArrowhead, false),
      style,
      pluginData
    ),
    ...markerSpecs(
      `${path.key}:end`,
      end,
      normalizedDirection([nodeX + endFrom.x, nodeY + endFrom.y], end),
      markerKinds(element.endArrowhead, false),
      style,
      pluginData
    )
  )
  return specs
}

function elementSpecs(element: MermaidSkeletonElement, index: number): MermaidSceneNodeSpec[] {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
      return containerSpecs(element, index)
    case 'text':
      return [standaloneTextSpec(element, index)]
    case 'line':
    case 'arrow':
      return linearSpecs(element, index)
    case 'path': {
      const spec = svgPathSpec(
        element,
        elementKey(element, index),
        elementPluginData(element, index)
      )
      return spec ? [spec, ...svgPathMarkerSpecs(element, index, spec)] : []
    }
    case 'frame':
      return []
    case 'image':
      throw new Error('This Mermaid diagram must be converted into editable SVG pieces first.')
    default:
      return []
  }
}

function normalizeSceneNodes(nodes: MermaidSceneNodeSpec[]): {
  width: number
  height: number
  nodes: MermaidSceneNodeSpec[]
} {
  if (nodes.length === 0) return { width: 0, height: 0, nodes }
  const minX = Math.min(...nodes.map((node) => finite(node.props.x)))
  const minY = Math.min(...nodes.map((node) => finite(node.props.y)))
  const maxX = Math.max(
    ...nodes.map((node) => finite(node.props.x) + positive(node.props.width, MIN_NODE_SIZE))
  )
  const maxY = Math.max(
    ...nodes.map((node) => finite(node.props.y) + positive(node.props.height, MIN_NODE_SIZE))
  )
  return {
    width: Math.max(MIN_NODE_SIZE, maxX - minX),
    height: Math.max(MIN_NODE_SIZE, maxY - minY),
    nodes: nodes.map((node) => ({
      ...node,
      props: {
        ...node.props,
        x: finite(node.props.x) - minX,
        y: finite(node.props.y) - minY
      }
    }))
  }
}

export function createMermaidSceneSpec(diagram: MermaidDiagram): MermaidSceneSpec {
  const normalized = normalizeSceneNodes(
    diagram.elements.flatMap((element, index) => elementSpecs(element, index))
  )
  if (normalized.nodes.length === 0) {
    throw new Error('This Mermaid definition did not produce editable diagram nodes.')
  }
  return {
    source: diagram.source,
    revision: diagram.revision,
    parser: diagram.parser,
    mode: 'editable',
    width: normalized.width,
    height: normalized.height,
    nodes: normalized.nodes
  }
}
