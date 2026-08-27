import type { Color, SceneGraph, SceneNode, VectorNetwork } from '@open-pencil/scene-graph'

import { solid } from '@/app/demo/colors'

import { appFlowNodePlacement, type AppFlowComposition, type AppFlowTone } from './layout'
import type { AppScreenFlowDefinition, AppScreenFlowEdge, AppScreenFlowEdgeKind } from './model'
import {
  addAppFlowText,
  APP_FLOW_COLOR as COLOR,
  appFlowPluginData as pluginData,
  appScreenFlowPluginValue,
  mergeAppFlowPluginData as mergePluginData,
  updateAppFlowText
} from './primitives'
import { APP_FLOW_EDGE_ARROW_SIZE, type AppFlowEdgeRoute, type AppFlowRoutePoint } from './routing'

const FLOW_EDGE_KIND = 'app-screen-flow-edge'
const FLOW_PART_KIND = 'app-screen-flow-part'
export const APP_FLOW_CONNECTOR_VERSION = '10'
const EDGE_PADDING = 32
const EDGE_LABEL_HEIGHT = 36
const EDGE_CORNER_RADIUS = 18

const LABELED_EDGE_IDS = new Set(['open-chart', 'record', 'return', 'save', 'submit', 'undo'])

export type AppFlowSceneBounds = Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>

function toneColor(tone: AppFlowTone): Color {
  if (tone === 'amber') return COLOR.amber
  if (tone === 'coral') return COLOR.coral
  return COLOR.connector
}

function flowPartValue(node: SceneNode | null | undefined) {
  return appScreenFlowPluginValue(node, 'part')
}

function directTextChildren(graph: SceneGraph, parentId: string) {
  return graph.getChildren(parentId).filter((node) => node.type === 'TEXT')
}

function upsertText(
  graph: SceneGraph,
  parentId: string,
  existing: SceneNode | undefined,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontWeight: 400 | 600 | 700,
  color: Color,
  maxWidth: number
) {
  if (existing) {
    return updateAppFlowText(graph, existing.id, text, x, y, fontSize, fontWeight, color, maxWidth)
  }
  return addAppFlowText(graph, parentId, text, x, y, fontSize, fontWeight, color, maxWidth)
}

function findFlowPart(graph: SceneGraph, parentId: string, part: string) {
  return graph
    .getChildren(parentId)
    .find(
      (child) =>
        appScreenFlowPluginValue(child, 'kind') === FLOW_PART_KIND && flowPartValue(child) === part
    )
}

function edgeColor(
  edge: AppScreenFlowEdge,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition
): Color {
  if (edge.kind === 'alternate') return COLOR.amber
  if (edge.kind === 'exit') return COLOR.green
  if (edge.kind === 'feedback') {
    const semanticNode =
      definition.nodes.find((node) => node.id === edge.targetId && node.kind === 'feedback') ??
      definition.nodes.find((node) => node.id === edge.sourceId && node.kind === 'feedback')
    const tone = semanticNode ? appFlowNodePlacement(composition, semanticNode)?.tone : undefined
    return toneColor(tone ?? 'violet')
  }
  return COLOR.connector
}

function edgeStrokeWidth(kind: AppScreenFlowEdgeKind) {
  return kind === 'alternate' || kind === 'feedback' ? 2 : 2.5
}

function edgeStroke(color: Color, weight: number, opacity = 1): SceneNode['strokes'] {
  return [
    {
      align: 'CENTER',
      cap: 'ROUND',
      color,
      join: 'ROUND',
      opacity,
      visible: true,
      weight
    }
  ]
}

function samePoint(left: AppFlowRoutePoint, right: AppFlowRoutePoint) {
  return left.x === right.x && left.y === right.y
}

function pointToward(
  point: AppFlowRoutePoint,
  target: AppFlowRoutePoint,
  distance: number
): AppFlowRoutePoint {
  if (point.x !== target.x) {
    return { x: point.x + Math.sign(target.x - point.x) * distance, y: point.y }
  }
  return { x: point.x, y: point.y + Math.sign(target.y - point.y) * distance }
}

function isTurn(previous: AppFlowRoutePoint, corner: AppFlowRoutePoint, next: AppFlowRoutePoint) {
  return (
    (previous.x === corner.x && corner.x !== next.x) ||
    (previous.y === corner.y && corner.y !== next.y)
  )
}

function roundedRouteNetwork(
  points: AppFlowRoutePoint[],
  origin: AppFlowRoutePoint
): VectorNetwork {
  const localPoints = points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y }))
  const vertices: VectorNetwork['vertices'] = []
  const segments: VectorNetwork['segments'] = []
  const addVertex = (point: AppFlowRoutePoint) => {
    vertices.push({ x: point.x, y: point.y })
    return vertices.length - 1
  }
  const addLine = (start: AppFlowRoutePoint, end: AppFlowRoutePoint) => {
    if (samePoint(start, end)) return
    segments.push({
      end: addVertex(end),
      start: addVertex(start),
      tangentEnd: { x: 0, y: 0 },
      tangentStart: { x: 0, y: 0 }
    })
  }
  const addCorner = (
    start: AppFlowRoutePoint,
    corner: AppFlowRoutePoint,
    end: AppFlowRoutePoint
  ) => {
    const controlRatio = 2 / 3
    segments.push({
      end: addVertex(end),
      start: addVertex(start),
      tangentEnd: {
        x: (corner.x - end.x) * controlRatio,
        y: (corner.y - end.y) * controlRatio
      },
      tangentStart: {
        x: (corner.x - start.x) * controlRatio,
        y: (corner.y - start.y) * controlRatio
      }
    })
  }

  const first = localPoints[0]
  let cursor = first
  for (let index = 1; index < localPoints.length - 1; index += 1) {
    const previous = localPoints[index - 1]
    const corner = localPoints[index]
    const next = localPoints[index + 1]
    if (!isTurn(previous, corner, next)) {
      addLine(cursor, corner)
      cursor = corner
      continue
    }
    const incomingDistance = Math.abs(corner.x - previous.x) + Math.abs(corner.y - previous.y)
    const outgoingDistance = Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y)
    const radius = Math.min(EDGE_CORNER_RADIUS, incomingDistance / 2, outgoingDistance / 2)
    if (radius < 1) {
      addLine(cursor, corner)
      cursor = corner
      continue
    }
    const incoming = pointToward(corner, previous, radius)
    const outgoing = pointToward(corner, next, radius)
    addLine(cursor, incoming)
    addCorner(incoming, corner, outgoing)
    cursor = outgoing
  }
  const last = localPoints.at(-1) ?? first
  addLine(cursor, last)
  return { regions: [], segments, vertices }
}

function edgePathProps(
  edge: AppScreenFlowEdge,
  part: string,
  network: VectorNetwork,
  width: number,
  height: number,
  color: Color,
  weight: number,
  opacity: number
) {
  return {
    fills: [],
    height,
    name: `${edge.label} ${part}`,
    pluginData: [pluginData('kind', FLOW_PART_KIND), pluginData('part', part)],
    strokes: edgeStroke(color, weight, opacity),
    vectorNetwork: network,
    width,
    x: 0,
    y: 0
  }
}

function upsertEdgePath(
  graph: SceneGraph,
  edgeNode: SceneNode,
  edge: AppScreenFlowEdge,
  part: string,
  network: VectorNetwork,
  width: number,
  height: number,
  color: Color,
  weight: number,
  opacity: number
) {
  const existing = findFlowPart(graph, edgeNode.id, part)
  const props = edgePathProps(edge, part, network, width, height, color, weight, opacity)
  if (existing?.type === 'VECTOR') {
    graph.updateNode(existing.id, {
      ...props,
      pluginData: mergePluginData(existing, ['kind', 'part'], props.pluginData)
    })
    return
  }
  if (existing) graph.deleteNode(existing.id)
  graph.createNode('VECTOR', edgeNode.id, props)
}

function edgePluginData(
  definition: AppScreenFlowDefinition,
  edge: AppScreenFlowEdge,
  route: AppFlowEdgeRoute
): SceneNode['pluginData'] {
  return [
    pluginData('kind', FLOW_EDGE_KIND),
    pluginData('flowId', definition.id),
    pluginData('appFlowEdgeId', edge.id),
    pluginData('sourceFlowNodeId', edge.sourceId),
    pluginData('targetFlowNodeId', edge.targetId),
    pluginData('transitionLabel', edge.label),
    pluginData('edgeKind', edge.kind),
    pluginData('connectorVersion', APP_FLOW_CONNECTOR_VERSION),
    pluginData('sourceAnchorSide', route.sourceSide),
    pluginData('targetAnchorSide', route.targetSide),
    pluginData('routeChannel', route.channel),
    pluginData('flowSchemaVersion', definition.schemaVersion),
    pluginData('flowSourceFile', definition.sourceFile)
  ]
}

function createEdgeLabel(
  graph: SceneGraph,
  parentId: string,
  definition: AppScreenFlowDefinition,
  edge: AppScreenFlowEdge,
  route: AppFlowEdgeRoute,
  origin: AppFlowRoutePoint,
  occupiedBounds: AppFlowSceneBounds[]
) {
  const { points } = route
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index] ?? point
    return {
      end: point,
      length: Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y),
      start: previous
    }
  })
  if (
    !edge.label ||
    !LABELED_EDGE_IDS.has(edge.id) ||
    (definition.id === 'user-journey-complete-dental-exam' &&
      (edge.id === 'open-chart' || edge.id === 'return')) ||
    edge.kind === 'feedback' ||
    edge.sourceId === 'entry' ||
    edge.targetId === 'exit'
  ) {
    return null
  }
  const width = Math.min(220, Math.max(92, edge.label.length * 10 + 20))
  const pageId = graph.getNode(parentId)?.parentId
  const occupiedLabelBounds = pageId
    ? graph.getChildren(pageId).flatMap((edgeNode) =>
        edgeNode.id === parentId
          ? []
          : graph
              .getChildren(edgeNode.id)
              .filter((node) => flowPartValue(node) === 'label')
              .map((node) => ({
                height: node.height,
                width: node.width,
                x: edgeNode.x + node.x,
                y: edgeNode.y + node.y
              }))
      )
    : []
  const firstPoint = points[0]
  const lastPoint = points.at(-1) ?? firstPoint
  const midpointCandidates = [
    {
      x: (firstPoint.x + lastPoint.x) / 2 - width / 2,
      y: (firstPoint.y + lastPoint.y) / 2 - EDGE_LABEL_HEIGHT - 12
    },
    {
      x: (firstPoint.x + lastPoint.x) / 2 - width / 2,
      y: (firstPoint.y + lastPoint.y) / 2 + 12
    }
  ]
  const segmentCandidates = segments
    .sort((left, right) => {
      const leftVertical = left.start.x === left.end.x
      const rightVertical = right.start.x === right.end.x
      if (edge.kind === 'feedback' && leftVertical !== rightVertical) {
        return rightVertical ? 1 : -1
      }
      return right.length - left.length
    })
    .flatMap((segment) => {
      const horizontal = segment.start.y === segment.end.y
      const centerX = (segment.start.x + segment.end.x) / 2
      const centerY = (segment.start.y + segment.end.y) / 2
      if (horizontal) {
        return [12, 56, 100, 144].flatMap((offset) => [
          { x: centerX - width / 2, y: centerY - EDGE_LABEL_HEIGHT - offset },
          { x: centerX - width / 2, y: centerY + offset }
        ])
      }
      return [12, 56, 100, 144].flatMap((offset) => [
        { x: centerX - width - offset, y: centerY - EDGE_LABEL_HEIGHT / 2 },
        { x: centerX + offset, y: centerY - EDGE_LABEL_HEIGHT / 2 }
      ])
    })
  const candidatePositions = [...segmentCandidates, ...midpointCandidates]
  const overlapsContent = (candidate: AppFlowRoutePoint) =>
    [...occupiedBounds, ...occupiedLabelBounds].some(
      (bounds) =>
        candidate.x < bounds.x + bounds.width + 8 &&
        candidate.x + width > bounds.x - 8 &&
        candidate.y < bounds.y + bounds.height + 8 &&
        candidate.y + EDGE_LABEL_HEIGHT > bounds.y - 8
    )
  const position = candidatePositions.find((candidate) => !overlapsContent(candidate))
  if (!position) return null
  const labelProps = {
    cornerRadius: 0,
    fills: [] as SceneNode['fills'],
    height: EDGE_LABEL_HEIGHT,
    name: `${edge.label} label`,
    pluginData: [pluginData('kind', FLOW_PART_KIND), pluginData('part', 'label')],
    strokes: [] as SceneNode['strokes'],
    width,
    x: position.x - origin.x,
    y: position.y - origin.y
  }
  const existing = findFlowPart(graph, parentId, 'label')
  let label: SceneNode
  if (existing) {
    graph.updateNode(existing.id, {
      ...labelProps,
      pluginData: mergePluginData(existing, ['kind', 'part'], labelProps.pluginData)
    })
    label = graph.getNode(existing.id) ?? existing
  } else {
    label = graph.createNode('FRAME', parentId, labelProps)
  }
  upsertText(
    graph,
    label.id,
    directTextChildren(graph, label.id)[0],
    edge.label,
    0,
    4,
    20,
    600,
    COLOR.mutedLight,
    width
  )
  return label
}

function arrowRotation(previous: AppFlowRoutePoint, end: AppFlowRoutePoint) {
  if (end.x > previous.x) return 90
  if (end.x < previous.x) return 270
  return end.y > previous.y ? 180 : 0
}

function removeStaleEdgeParts(
  graph: SceneGraph,
  edgeNode: SceneNode,
  desiredParts: ReadonlySet<string>
) {
  for (const child of graph.getChildren(edgeNode.id)) {
    const part = flowPartValue(child)
    if (!part || !desiredParts.has(part)) graph.deleteNode(child.id)
  }
}

export function syncRoutedAppFlowEdgeGeometry(
  graph: SceneGraph,
  edgeNode: SceneNode,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition,
  edge: AppScreenFlowEdge,
  route: AppFlowEdgeRoute,
  occupiedBounds: AppFlowSceneBounds[]
) {
  const { points } = route
  if (points.length < 2) {
    removeStaleEdgeParts(graph, edgeNode, new Set())
    graph.updateNode(edgeNode.id, { height: 1, width: 1, x: 0, y: 0 })
    return
  }
  const minX = Math.min(...points.map((point) => point.x)) - EDGE_PADDING
  const minY = Math.min(...points.map((point) => point.y)) - EDGE_PADDING
  const maxX = Math.max(...points.map((point) => point.x)) + EDGE_PADDING
  const maxY = Math.max(...points.map((point) => point.y)) + EDGE_PADDING
  graph.updateNode(edgeNode.id, {
    clipsContent: false,
    height: Math.max(1, maxY - minY),
    width: Math.max(1, maxX - minX),
    x: minX,
    y: minY
  })
  const color = edgeColor(edge, definition, composition)
  const width = maxX - minX
  const height = maxY - minY
  const network = roundedRouteNetwork(points, { x: minX, y: minY })
  const desiredParts = new Set<string>(['path'])
  upsertEdgePath(
    graph,
    edgeNode,
    edge,
    'path',
    network,
    width,
    height,
    color,
    edgeStrokeWidth(edge.kind),
    1
  )
  const local = points.map((point) => ({ x: point.x - minX, y: point.y - minY }))
  const end = local.at(-1)
  const previous = local.at(-2)
  if (end && previous) {
    desiredParts.add('arrow')
    const arrowProps = {
      fills: [solid(color)],
      height: APP_FLOW_EDGE_ARROW_SIZE,
      name: `${edge.label} arrow`,
      pluginData: [pluginData('kind', FLOW_PART_KIND), pluginData('part', 'arrow')],
      pointCount: 3,
      rotation: arrowRotation(previous, end),
      strokes: [] as SceneNode['strokes'],
      width: APP_FLOW_EDGE_ARROW_SIZE,
      x: end.x - APP_FLOW_EDGE_ARROW_SIZE / 2,
      y: end.y - APP_FLOW_EDGE_ARROW_SIZE / 2
    }
    const arrow = findFlowPart(graph, edgeNode.id, 'arrow')
    if (arrow) graph.updateNode(arrow.id, arrowProps)
    else graph.createNode('POLYGON', edgeNode.id, arrowProps)
  }
  const label = createEdgeLabel(
    graph,
    edgeNode.id,
    definition,
    edge,
    route,
    { x: minX, y: minY },
    occupiedBounds
  )
  if (label) desiredParts.add('label')
  removeStaleEdgeParts(graph, edgeNode, desiredParts)
  const orderedParts = graph.getChildren(edgeNode.id).sort((left, right) => {
    const rank = (node: SceneNode) => {
      const part = flowPartValue(node)
      if (part === 'path') return 0
      if (part === 'arrow') return 1
      if (part === 'label') return 2
      return 3
    }
    return rank(left) - rank(right) || left.id.localeCompare(right.id)
  })
  orderedParts.forEach((node, index) => graph.reorderChild(node.id, edgeNode.id, index))
}

export function syncRoutedAppFlowEdge(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition,
  edge: AppScreenFlowEdge,
  route: AppFlowEdgeRoute,
  occupiedBounds: AppFlowSceneBounds[]
) {
  const existing = graph
    .getChildren(pageId)
    .find((candidate) => appScreenFlowPluginValue(candidate, 'appFlowEdgeId') === edge.id)
  const props = {
    clipsContent: false,
    fills: [],
    height: 1,
    name: `${edge.label}: ${edge.sourceId} to ${edge.targetId}`,
    strokes: [],
    width: 1,
    x: 0,
    y: 0
  }
  let edgeNode: SceneNode
  if (existing) {
    graph.updateNode(existing.id, {
      ...props,
      pluginData: mergePluginData(
        existing,
        [
          'kind',
          'flowId',
          'appFlowEdgeId',
          'sourceFlowNodeId',
          'targetFlowNodeId',
          'transitionLabel',
          'edgeKind',
          'connectorVersion',
          'sourceAnchorSide',
          'targetAnchorSide',
          'routeChannel',
          'flowSchemaVersion',
          'flowSourceFile'
        ],
        edgePluginData(definition, edge, route)
      )
    })
    edgeNode = graph.getNode(existing.id) ?? existing
  } else {
    edgeNode = graph.createNode('FRAME', pageId, {
      ...props,
      pluginData: edgePluginData(definition, edge, route)
    })
  }
  syncRoutedAppFlowEdgeGeometry(
    graph,
    edgeNode,
    definition,
    composition,
    edge,
    route,
    occupiedBounds
  )
  return edgeNode
}
