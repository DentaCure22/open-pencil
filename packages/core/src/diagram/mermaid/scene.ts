import { wcagContrast } from 'culori'

import type {
  PluginDataEntry,
  Stroke,
  VectorNetwork,
  VectorSegment,
  VectorVertex
} from '@open-pencil/scene-graph'
import type { Color, Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { parseColor } from '#core/color'
import { DEFAULT_FONT_FAMILY } from '#core/constants'

import {
  finite,
  labelVerticalPosition,
  normalizedDirection,
  offset,
  positive,
  type AbsolutePoint
} from './geometry'
import { diagramShapeColor, diagramStrokeColor, diagramTextColor } from './palette'
import { svgPathSpec } from './path'
import { clampedOpacity, skeletonShapeStyle, solidFill } from './style'
import { diagramTextAlign, diagramTextVerticalAlign, estimateTextSize } from './text'
import type {
  MermaidDiagram,
  MermaidAppearance,
  MermaidLabel,
  MermaidSceneNodeSpec,
  MermaidSceneSpec,
  MermaidSkeletonElement
} from './types'

const MIN_NODE_SIZE = 1
const MARKER_SIZE = 10
const DARK_READABLE_TEXT = parseColor('#1b1b1f')
const LIGHT_READABLE_TEXT = parseColor('#f4f5f7')
const STRICT_DARK_READABLE_TEXT = parseColor('#000000')
const STRICT_LIGHT_READABLE_TEXT = parseColor('#ffffff')
const STRUCTURAL_MERMAID_GROUPS = new Set([
  'background',
  'clusters',
  'defs',
  'edgelabels',
  'edgepaths',
  'grid',
  'label',
  'labels',
  'legend',
  'markers',
  'nodes',
  'root'
])

type MarkerKind = 'arrow' | 'bar' | 'circle' | 'crow' | 'diamond'

interface LineStyle {
  color: Color
  width: number
  dashed: boolean
  opacity: number
}

function colorContrast(left: Color, right: Color): number {
  return wcagContrast({ mode: 'rgb', ...left }, { mode: 'rgb', ...right })
}

function readableTextColor(background: Color): Color {
  const preferred =
    colorContrast(LIGHT_READABLE_TEXT, background) >= colorContrast(DARK_READABLE_TEXT, background)
      ? LIGHT_READABLE_TEXT
      : DARK_READABLE_TEXT
  if (colorContrast(preferred, background) >= 4.5) return preferred
  return colorContrast(STRICT_LIGHT_READABLE_TEXT, background) >=
    colorContrast(STRICT_DARK_READABLE_TEXT, background)
    ? STRICT_LIGHT_READABLE_TEXT
    : STRICT_DARK_READABLE_TEXT
}

function lineStroke(style: LineStyle): Stroke {
  const opacity = clampedOpacity(style.color.a) * clampedOpacity(style.opacity)
  return {
    color: { ...style.color, a: 1 },
    weight: style.width,
    opacity,
    visible: opacity > 0,
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
  element?: MermaidSkeletonElement,
  appearance: MermaidAppearance = 'dark'
): MermaidSceneNodeSpec {
  const textColor = parseColor(diagramTextColor(color, appearance))
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
      fontFamily: DEFAULT_FONT_FAMILY,
      fontWeight: element?.fontWeight ?? 400,
      rotation: element?.rotation ?? 0,
      lineHeight: fontSize * 1.25,
      textAlignHorizontal: diagramTextAlign(label),
      textAlignVertical: diagramTextVerticalAlign(label),
      textAutoResize: 'NONE',
      fills: [solidFill(textColor)],
      pluginData
    }
  }
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
  pluginData: PluginDataEntry[] = [],
  opacity = 1
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
      fills: [solidFill(color, opacity)],
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
  pluginData: PluginDataEntry[],
  appearance: MermaidAppearance
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
          pluginData,
          style.opacity
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
          pluginData,
          style.opacity
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
          fills: [solidFill(parseColor(diagramShapeColor(undefined, appearance)))],
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

function containerSpecs(
  element: MermaidSkeletonElement,
  index: number,
  appearance: MermaidAppearance
): MermaidSceneNodeSpec[] {
  const x = finite(element.x)
  const y = finite(element.y)
  const width = positive(element.width, 120)
  const height = positive(element.height, 64)
  const pluginData = elementPluginData(element, index)
  const style = skeletonShapeStyle(element, appearance)
  const type = element.type === 'ellipse' ? 'ELLIPSE' : 'RECTANGLE'
  const key = elementKey(element, index)
  const specs: MermaidSceneNodeSpec[] = []
  const cornerRadius = Math.min(
    width / 2,
    height / 2,
    Math.max(0, element.cornerRadius ?? (element.roundness ? Math.min(width, height) / 2 : 6))
  )

  if (element.type === 'diamond') {
    const fillColor = style.fills[0]?.color ?? parseColor(diagramShapeColor(undefined, appearance))
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
        fillColor,
        pluginData
      )
    )
    specs[0].props.fills = style.fills
    specs[0].props.strokes = style.strokes
    specs[0].props.blendMode = element.blendMode
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
        cornerRadius: type === 'RECTANGLE' ? cornerRadius : 0,
        ...style,
        blendMode: element.blendMode,
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
        pluginData,
        undefined,
        appearance
      )
    )
  }
  return specs
}

function standaloneTextSpec(
  element: MermaidSkeletonElement,
  index: number,
  appearance: MermaidAppearance
): MermaidSceneNodeSpec {
  const text = element.text || ''
  const fontSize = positive(element.fontSize, 16)
  const estimated = estimateTextSize(text, fontSize)
  const sourceWidth = positive(element.width, estimated.width)
  const sourceHeight = positive(element.height, estimated.height)
  const width = Math.max(sourceWidth, estimated.width + 8)
  const height = Math.max(sourceHeight, estimated.height + 4)
  const horizontalAlign = diagramTextAlign(element.label)
  let xOffset = 0
  if (horizontalAlign === 'RIGHT') xOffset = width - sourceWidth
  else if (horizontalAlign === 'CENTER') xOffset = (width - sourceWidth) / 2
  return textSpec(
    elementKey(element, index),
    text,
    {
      x: finite(element.x) - xOffset,
      y: finite(element.y) - (height - sourceHeight) / 2,
      width,
      height
    },
    fontSize,
    element.strokeColor,
    element.label,
    elementPluginData(element, index),
    element,
    appearance
  )
}

function linearSpecs(
  element: MermaidSkeletonElement,
  index: number,
  appearance: MermaidAppearance
): MermaidSceneNodeSpec[] {
  const points = elementPoints(element)
  const pluginData = elementPluginData(element, index)
  const style: LineStyle = {
    color: parseColor(diagramStrokeColor(element.strokeColor, appearance)),
    width: positive(element.strokeWidth, 2),
    dashed: element.strokeStyle === 'dashed' || element.strokeStyle === 'dotted',
    opacity: clampedOpacity(element.opacity) * clampedOpacity(element.strokeOpacity)
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
        pluginData,
        appearance
      ),
      ...markerSpecs(
        `${key}:end`,
        end,
        normalizedDirection(endPrevious, end),
        markerKinds(element.endArrowhead, element.endArrowhead === undefined),
        style,
        pluginData,
        appearance
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
        pluginData,
        undefined,
        appearance
      )
    )
  }
  return specs
}

function svgPathMarkerSpecs(
  element: MermaidSkeletonElement,
  index: number,
  path: MermaidSceneNodeSpec,
  appearance: MermaidAppearance
): MermaidSceneNodeSpec[] {
  const network = path.props.vectorNetwork
  const firstSegment = network?.segments[0]
  const lastSegment = network?.segments.at(-1)
  if (!network || !firstSegment || !lastSegment) return []

  const nodeX = finite(path.props.x)
  const nodeY = finite(path.props.y)
  const pluginData = elementPluginData(element, index)
  const pathStroke = path.props.strokes?.[0]
  const style: LineStyle = {
    color:
      pathStroke?.color ??
      element.strokePaint?.gradientStops?.[0]?.color ??
      parseColor(diagramStrokeColor(element.strokeColor, appearance)),
    width: pathStroke?.weight ?? positive(element.strokeWidth, 2),
    dashed: Boolean(pathStroke?.dashPattern?.length),
    opacity: pathStroke?.opacity ?? 1
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
      pluginData,
      appearance
    ),
    ...markerSpecs(
      `${path.key}:end`,
      end,
      normalizedDirection([nodeX + endFrom.x, nodeY + endFrom.y], end),
      markerKinds(element.endArrowhead, false),
      style,
      pluginData,
      appearance
    )
  )
  return specs
}

function elementSpecs(
  element: MermaidSkeletonElement,
  index: number,
  appearance: MermaidAppearance
): MermaidSceneNodeSpec[] {
  switch (element.type) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
      return containerSpecs(element, index, appearance)
    case 'text':
      return [standaloneTextSpec(element, index, appearance)]
    case 'line':
    case 'arrow':
      return linearSpecs(element, index, appearance)
    case 'path': {
      const spec = svgPathSpec(
        element,
        elementKey(element, index),
        elementPluginData(element, index),
        appearance
      )
      return spec ? [spec, ...svgPathMarkerSpecs(element, index, spec, appearance)] : []
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

function nodePluginValue(node: MermaidSceneNodeSpec, key: string): string | null {
  return (
    node.props.pluginData?.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)
      ?.value ?? null
  )
}

function nodeGroupPath(node: MermaidSceneNodeSpec): string[] {
  const value = nodePluginValue(node, 'mermaid/group-ids')
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((part) => typeof part === 'string') ? parsed : []
  } catch {
    return []
  }
}

function groupKind(value: string): string {
  return (value.split('@')[0]?.split(/\s+/)[0] ?? '').toLowerCase()
}

function groupPrefix(path: string[], index: number): string {
  return path.slice(0, index + 1).join('\u001f')
}

function semanticGroupCandidates(nodes: MermaidSceneNodeSpec[]): Map<string, string> {
  const paths = new Map(nodes.map((node) => [node.key, nodeGroupPath(node)]))
  const prefixCounts = new Map<string, number>()
  const elementCounts = new Map<string, number>()
  for (const node of nodes) {
    const path = paths.get(node.key) ?? []
    path.forEach((_, index) => {
      const prefix = groupPrefix(path, index)
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1)
    })
    const elementId = nodePluginValue(node, 'mermaid/element-id')
    if (elementId) elementCounts.set(elementId, (elementCounts.get(elementId) ?? 0) + 1)
  }

  const candidates = new Map<string, string>()
  for (const node of nodes) {
    const path = paths.get(node.key) ?? []
    const pathCandidateIndex = path.findIndex((segment, index) => {
      if (STRUCTURAL_MERMAID_GROUPS.has(groupKind(segment))) return false
      const count = prefixCounts.get(groupPrefix(path, index)) ?? 0
      return count >= 2 && count < nodes.length
    })
    if (pathCandidateIndex !== -1) {
      candidates.set(node.key, `group:${groupPrefix(path, pathCandidateIndex)}`)
      continue
    }
    const elementId = nodePluginValue(node, 'mermaid/element-id')
    if (elementId && (elementCounts.get(elementId) ?? 0) >= 2) {
      candidates.set(node.key, `element:${elementId}`)
    }
  }
  return candidates
}

function semanticGroupName(nodes: MermaidSceneNodeSpec[]): string {
  const label = nodes.find((node) => node.type === 'TEXT')?.props.text?.trim()
  if (label) return label.split('\n')[0]?.slice(0, 80) || 'Mermaid node'
  return nodes[0]?.props.name?.slice(0, 80) || 'Mermaid part'
}

function groupSemanticNodes(nodes: MermaidSceneNodeSpec[]): MermaidSceneNodeSpec[] {
  const candidates = semanticGroupCandidates(nodes)
  const members = new Map<string, MermaidSceneNodeSpec[]>()
  for (const node of nodes) {
    const candidate = candidates.get(node.key)
    if (!candidate) continue
    const group = members.get(candidate) ?? []
    group.push(node)
    members.set(candidate, group)
  }

  const groupedKeys = new Set<string>()
  const groups: MermaidSceneNodeSpec[] = []
  const parentKeys = new Map<string, string>()
  for (const [semanticId, groupNodes] of members) {
    if (groupNodes.length < 2) continue
    const x = Math.min(...groupNodes.map((node) => finite(node.props.x)))
    const y = Math.min(...groupNodes.map((node) => finite(node.props.y)))
    const maxX = Math.max(
      ...groupNodes.map((node) => finite(node.props.x) + positive(node.props.width, MIN_NODE_SIZE))
    )
    const maxY = Math.max(
      ...groupNodes.map((node) => finite(node.props.y) + positive(node.props.height, MIN_NODE_SIZE))
    )
    const key = `semantic:${groups.length + 1}`
    groups.push({
      key,
      type: 'GROUP',
      props: {
        name: semanticGroupName(groupNodes),
        x,
        y,
        width: Math.max(MIN_NODE_SIZE, maxX - x),
        height: Math.max(MIN_NODE_SIZE, maxY - y),
        fills: [],
        strokes: [],
        pluginData: [{ pluginId: 'open-pencil', key: 'mermaid/semantic-id', value: semanticId }]
      }
    })
    for (const node of groupNodes) {
      groupedKeys.add(node.key)
      parentKeys.set(node.key, key)
    }
  }

  return [
    ...groups,
    ...nodes.map((node) => {
      const parentKey = parentKeys.get(node.key)
      if (!parentKey || !groupedKeys.has(node.key)) return node
      const parent = groups.find((group) => group.key === parentKey)
      return {
        ...node,
        parentKey,
        props: {
          ...node.props,
          x: finite(node.props.x) - finite(parent?.props.x),
          y: finite(node.props.y) - finite(parent?.props.y)
        }
      }
    })
  ]
}

function readableTextNodes(nodes: MermaidSceneNodeSpec[]): MermaidSceneNodeSpec[] {
  const solidBackgrounds = nodes.filter(
    (node) =>
      (node.type === 'ELLIPSE' ||
        node.type === 'RECTANGLE' ||
        (node.type === 'VECTOR' && Boolean(node.props.vectorNetwork?.regions.length))) &&
      node.props.fills?.[0]?.type === 'SOLID' &&
      node.props.fills[0].visible &&
      node.props.fills[0].opacity >= 0.8 &&
      node.props.fills[0].color.a >= 0.8
  )
  return nodes.map((node) => {
    const textFill = node.type === 'TEXT' ? node.props.fills?.[0] : undefined
    if (textFill?.type !== 'SOLID') return node
    const centerX = finite(node.props.x) + positive(node.props.width, MIN_NODE_SIZE) / 2
    const centerY = finite(node.props.y) + positive(node.props.height, MIN_NODE_SIZE) / 2
    const background = solidBackgrounds
      .filter(
        (candidate) =>
          centerX >= finite(candidate.props.x) &&
          centerX <= finite(candidate.props.x) + positive(candidate.props.width, MIN_NODE_SIZE) &&
          centerY >= finite(candidate.props.y) &&
          centerY <= finite(candidate.props.y) + positive(candidate.props.height, MIN_NODE_SIZE)
      )
      .sort(
        (left, right) =>
          positive(left.props.width, MIN_NODE_SIZE) * positive(left.props.height, MIN_NODE_SIZE) -
          positive(right.props.width, MIN_NODE_SIZE) * positive(right.props.height, MIN_NODE_SIZE)
      )
      .at(0)
    const backgroundFill = background?.props.fills?.[0]
    if (backgroundFill?.type !== 'SOLID') return node
    if (colorContrast(textFill.color, backgroundFill.color) >= 4.5) return node
    const readable = readableTextColor(backgroundFill.color)
    return {
      ...node,
      props: {
        ...node.props,
        fills: [{ ...textFill, color: { ...readable, a: textFill.color.a } }]
      }
    }
  })
}

export function createMermaidSceneSpec(diagram: MermaidDiagram): MermaidSceneSpec {
  const appearance = diagram.appearance ?? 'dark'
  const normalized = normalizeSceneNodes(
    readableTextNodes(
      diagram.elements.flatMap((element, index) => elementSpecs(element, index, appearance))
    )
  )
  if (normalized.nodes.length === 0) {
    throw new Error('This Mermaid definition did not produce editable diagram nodes.')
  }
  return {
    appearance,
    source: diagram.source,
    revision: diagram.revision,
    parser: diagram.parser,
    mode: 'editable',
    width: normalized.width,
    height: normalized.height,
    nodes: groupSemanticNodes(normalized.nodes)
  }
}
