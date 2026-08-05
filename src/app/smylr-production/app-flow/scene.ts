import type { Color, SceneGraph, SceneNode, VectorNetwork } from '@open-pencil/scene-graph'

import { DEFAULT_CODE_OBJECT_RADIUS } from '@/app/code-object/transform'
import { solid } from '@/app/demo/colors'

import {
  ensureSmylrBoardGuide,
  SMYLR_BOARD_GUIDE_KIND,
  SMYLR_BOARD_GUIDE_VERSION
} from '../board-guide'
import {
  APP_FLOW_LAYOUT_VERSION,
  type AppFlowComposition,
  type AppFlowCompositionGuide,
  type AppFlowNodePlacement,
  type AppFlowTone,
  appFlowNodePlacement,
  resolveAppFlowComposition
} from './layout'
import {
  appScreenFlowDefinitionById,
  DENTAL_CHART_APP_FLOW,
  PRODUCT_MAP_DENTAL_CHART_APP_FLOW,
  type AppScreenFlowDefinition,
  type AppScreenFlowEdge,
  type AppScreenFlowEdgeKind,
  type AppScreenFlowLane,
  type AppScreenFlowNode
} from './model'
import {
  addAppFlowText as addText,
  APP_FLOW_COLOR as COLOR,
  APP_FLOW_CODE_OBJECT_MEDIUM,
  appFlowPluginData as pluginData,
  appScreenFlowPluginValue,
  mergeAppFlowPluginData as mergePluginData,
  updateAppFlowText
} from './primitives'
import {
  APP_FLOW_EDGE_ARROW_SIZE,
  type AppFlowEdgeRoute,
  type AppFlowRouteNode,
  type AppFlowRoutePoint,
  planAppFlowEdgeRoutes
} from './routing'

const CODE_OBJECT_KIND = 'smylr-code-object-frame'
const FLOW_EDGE_KIND = 'app-screen-flow-edge'
const FLOW_FEEDBACK_KIND = 'app-screen-flow-feedback'
const FLOW_CHAPTER_KIND = 'app-screen-flow-chapter'
const FLOW_LABEL_KIND = 'app-screen-flow-state-label'
const FLOW_LANE_KIND = 'app-screen-flow-lane'
const FLOW_MARKER_KIND = 'app-screen-flow-marker'
const FLOW_PART_KIND = 'app-screen-flow-part'
const LEGACY_EDGE_KIND = 'flow-connector'
const FLOW_CONNECTOR_VERSION = '10'

export { APP_FLOW_SCREEN_GAP, APP_FLOW_SCREEN_HEIGHT, APP_FLOW_SCREEN_WIDTH } from './layout'

const STATE_LABEL_HEIGHT = 56
const STATE_LABEL_Y_OFFSET = 128
const MARKER_SIZE = 20
const MARKER_GAP = 128
const EDGE_PADDING = 32
const EDGE_LABEL_HEIGHT = 36
const EDGE_CORNER_RADIUS = 18

const LABELED_EDGE_IDS = new Set(['open-chart', 'record', 'return', 'save', 'submit', 'undo'])

type Bounds = Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>

type FlowSceneResult = {
  changed: boolean
  screenIds: string[]
}

function flowScreenNodes(definition: AppScreenFlowDefinition) {
  return definition.nodes.filter(
    (node): node is AppScreenFlowNode & { kind: 'screen'; state: string } =>
      node.kind === 'screen' && Boolean(node.state)
  )
}

function flowFeedbackNodes(definition: AppScreenFlowDefinition) {
  return definition.nodes.filter((node) => node.kind === 'feedback')
}

function primaryScreenNodes(definition: AppScreenFlowDefinition) {
  return flowScreenNodes(definition)
    .filter((node) => node.lane === 'primary')
    .sort((left, right) => (left.column ?? 0) - (right.column ?? 0))
}

function nodePlacement(
  composition: AppFlowComposition,
  node: AppScreenFlowNode
): AppFlowNodePlacement {
  const placement = appFlowNodePlacement(composition, node)
  if (!placement) throw new Error(`Missing ${composition.kind} placement for ${node.id}`)
  return placement
}

function journeyNodePluginData(
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode,
  index: number
): SceneNode['pluginData'] {
  return [
    pluginData('flowId', definition.id),
    pluginData('flowLane', node.lane),
    pluginData('flowColumn', String(node.column ?? index)),
    pluginData('appFlowNodeId', node.id),
    pluginData('appFlowNodeKind', node.kind),
    pluginData('flowSchemaVersion', definition.schemaVersion),
    pluginData('flowSourceFile', definition.sourceFile),
    ...(node.status ? [pluginData('flowFeedbackStatus', node.status)] : [])
  ]
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
  return addText(graph, parentId, text, x, y, fontSize, fontWeight, color, maxWidth)
}

function directTextChildren(graph: SceneGraph, parentId: string) {
  return graph.getChildren(parentId).filter((node) => node.type === 'TEXT')
}

function directChild(graph: SceneGraph, parentId: string, type: SceneNode['type']) {
  return graph.getChildren(parentId).find((node) => node.type === type)
}

function flowPartValue(node: SceneNode | null | undefined) {
  return appScreenFlowPluginValue(node, 'part')
}

function stateDisplayLabel(node: AppScreenFlowNode, composition: AppFlowComposition) {
  const prefix = 'Dental Chart '
  const suffix = node.label.startsWith(prefix) ? node.label.slice(prefix.length) : ''
  if (!suffix) return node.label
  const state = `${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}`
  return composition.kind === 'product-map' ? `Chart · ${state}` : state
}

function screenFramePluginData(
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode & { kind: 'screen'; state: string },
  index: number,
  composition: AppFlowComposition,
  placement: AppFlowNodePlacement
) {
  return [
    pluginData('kind', CODE_OBJECT_KIND),
    pluginData('pageId', node.pageId ?? definition.pageId),
    pluginData('route', node.route ?? definition.route),
    pluginData('state', node.state),
    pluginData('flowIndex', String(index)),
    pluginData('flowComposition', composition.kind),
    pluginData('flowEmphasis', placement.emphasis ?? 'standard'),
    pluginData('renderMedium', APP_FLOW_CODE_OBJECT_MEDIUM),
    ...(node.captureSrc ? [pluginData('captureSrc', node.captureSrc)] : []),
    ...journeyNodePluginData(definition, node, index)
  ]
}

function ensureScreenFrame(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode & { kind: 'screen'; state: string },
  index: number,
  composition: AppFlowComposition
) {
  const existing = graph
    .getChildren(pageId)
    .find(
      (candidate) =>
        appScreenFlowPluginValue(candidate, 'appFlowNodeId') === node.id ||
        (appScreenFlowPluginValue(candidate, 'kind') === CODE_OBJECT_KIND &&
          appScreenFlowPluginValue(candidate, 'state') === node.state &&
          !appScreenFlowPluginValue(candidate, 'workspaceItemId'))
    )
  const placement = nodePlacement(composition, node)
  const props = {
    clipsContent: true,
    cornerRadius: DEFAULT_CODE_OBJECT_RADIUS,
    fills: [] as SceneNode['fills'],
    height: placement.height,
    name: `${definition.label} / ${node.label}`,
    strokes: [] as SceneNode['strokes'],
    width: placement.width,
    x: placement.x,
    y: placement.y
  }
  if (!existing) {
    return graph.createNode('FRAME', pageId, {
      ...props,
      pluginData: screenFramePluginData(definition, node, index, composition, placement)
    })
  }
  graph.updateNode(existing.id, {
    ...props,
    pluginData: mergePluginData(
      existing,
      [
        'kind',
        'pageId',
        'route',
        'state',
        'captureSrc',
        'renderMedium',
        'flowComposition',
        'flowEmphasis',
        'flowId',
        'flowIndex',
        'flowLane',
        'flowColumn',
        'appFlowNodeId',
        'appFlowNodeKind',
        'flowSchemaVersion',
        'flowSourceFile'
      ],
      screenFramePluginData(definition, node, index, composition, placement)
    )
  })
  return graph.getNode(existing.id) ?? existing
}

function laneColor(lane: AppScreenFlowLane): Color {
  if (lane === 'alternate') return COLOR.amber
  if (lane === 'feedback') return COLOR.coral
  return COLOR.connector
}

function toneColor(tone: AppFlowTone): Color {
  if (tone === 'amber') return COLOR.amber
  if (tone === 'coral') return COLOR.coral
  return COLOR.connector
}

function createStateLabel(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode,
  frame: SceneNode,
  laneIndex: number,
  composition: AppFlowComposition
) {
  const accent = laneColor(node.lane)
  const placement = nodePlacement(composition, node)
  const labelPluginData = [
    pluginData('kind', FLOW_LABEL_KIND),
    pluginData('flowId', definition.id),
    pluginData('flowLane', node.lane),
    pluginData('flowComposition', composition.kind),
    pluginData('flowEmphasis', placement.emphasis ?? 'standard'),
    pluginData('appFlowNodeId', node.id),
    pluginData('flowSchemaVersion', definition.schemaVersion)
  ]
  const existing = graph
    .getChildren(pageId)
    .find(
      (candidate) =>
        appScreenFlowPluginValue(candidate, 'kind') === FLOW_LABEL_KIND &&
        appScreenFlowPluginValue(candidate, 'appFlowNodeId') === node.id
    )
  const props = {
    cornerRadius: 0,
    fills: [] as SceneNode['fills'],
    height: STATE_LABEL_HEIGHT,
    name: `${node.label} state label`,
    strokes: [] as SceneNode['strokes'],
    width: frame.width,
    x: frame.x,
    y: frame.y - STATE_LABEL_Y_OFFSET
  }
  let label: SceneNode
  if (existing) {
    graph.updateNode(existing.id, {
      ...props,
      pluginData: mergePluginData(
        existing,
        [
          'kind',
          'flowId',
          'flowLane',
          'flowComposition',
          'flowEmphasis',
          'appFlowNodeId',
          'flowSchemaVersion'
        ],
        labelPluginData
      )
    })
    label = graph.getNode(existing.id) ?? existing
  } else {
    label = graph.createNode('FRAME', pageId, { ...props, pluginData: labelPluginData })
  }
  for (const child of graph.getChildren(label.id)) {
    if (child.type !== 'TEXT') graph.deleteNode(child.id)
  }
  const labelText = directTextChildren(graph, label.id)
  const step = node.lane === 'alternate' ? 'ALTERNATE' : `${laneIndex + 1}`.padStart(2, '0')
  upsertText(graph, label.id, labelText[0], step, 0, 2, 18, 700, accent, label.width)
  const cueWidth = node.lane === 'alternate' ? 124 : 38
  upsertText(
    graph,
    label.id,
    labelText[1],
    stateDisplayLabel(node, composition),
    cueWidth,
    0,
    placement.emphasis === 'focal' ? 32 : 30,
    600,
    COLOR.white,
    label.width - cueWidth
  )
  for (const child of directTextChildren(graph, label.id).slice(2)) graph.deleteNode(child.id)
  return label
}

function createFeedbackNode(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode,
  index: number,
  composition: AppFlowComposition
) {
  const placement = nodePlacement(composition, node)
  const tone = placement.tone ?? 'violet'
  const accent = toneColor(tone)
  const feedbackPluginData = [
    pluginData('kind', FLOW_FEEDBACK_KIND),
    pluginData('flowComposition', composition.kind),
    pluginData('flowTone', tone),
    ...journeyNodePluginData(definition, node, index)
  ]
  const existing = graph
    .getChildren(pageId)
    .find(
      (candidate) =>
        appScreenFlowPluginValue(candidate, 'kind') === FLOW_FEEDBACK_KIND &&
        appScreenFlowPluginValue(candidate, 'appFlowNodeId') === node.id
    )
  const props = {
    cornerRadius: 8,
    fills: [solid(accent, tone === 'coral' ? 0.14 : 0.1)],
    height: placement.height,
    name: node.label,
    strokes: [] as SceneNode['strokes'],
    width: placement.width,
    x: placement.x,
    y: placement.y
  }
  let card: SceneNode
  if (existing) {
    graph.updateNode(existing.id, {
      ...props,
      pluginData: mergePluginData(
        existing,
        [
          'kind',
          'flowId',
          'flowLane',
          'flowColumn',
          'flowComposition',
          'flowTone',
          'appFlowNodeId',
          'appFlowNodeKind',
          'flowSchemaVersion',
          'flowSourceFile',
          'flowFeedbackStatus'
        ],
        feedbackPluginData
      )
    })
    card = graph.getNode(existing.id) ?? existing
  } else {
    card = graph.createNode('FRAME', pageId, { ...props, pluginData: feedbackPluginData })
  }
  for (const child of graph.getChildren(card.id)) {
    if (child.type !== 'TEXT') graph.deleteNode(child.id)
  }
  const textChildren = directTextChildren(graph, card.id)
  upsertText(
    graph,
    card.id,
    textChildren[0],
    (node.status ?? 'FEEDBACK').toUpperCase(),
    20,
    12,
    16,
    700,
    accent,
    placement.width - 40
  )
  upsertText(
    graph,
    card.id,
    textChildren[1],
    node.label,
    20,
    34,
    26,
    700,
    COLOR.white,
    placement.width - 40
  )
  upsertText(
    graph,
    card.id,
    textChildren[2],
    node.body ?? '',
    20,
    70,
    18,
    400,
    COLOR.mutedLight,
    placement.width - 40
  )
  for (const child of directTextChildren(graph, card.id).slice(3)) graph.deleteNode(child.id)
  return card
}

function markerBounds(kind: 'entry' | 'exit', screens: Bounds[]): Bounds {
  const anchor = kind === 'entry' ? screens[0] : screens.at(-1)
  if (!anchor) return { height: MARKER_SIZE, width: MARKER_SIZE, x: 0, y: 0 }
  const previous = kind === 'exit' ? screens.at(-2) : undefined
  const exitsLeft = Boolean(previous && anchor.x < previous.x)
  return {
    height: MARKER_SIZE,
    width: MARKER_SIZE,
    x:
      kind === 'entry' || exitsLeft
        ? anchor.x - MARKER_SIZE - MARKER_GAP
        : anchor.x + anchor.width + MARKER_GAP,
    y: anchor.y + anchor.height / 2 - MARKER_SIZE / 2
  }
}

function createMarker(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode,
  bounds: Bounds
) {
  const markerPluginData = [
    pluginData('kind', FLOW_MARKER_KIND),
    pluginData('flowId', definition.id),
    pluginData('flowLane', node.lane),
    pluginData('appFlowNodeId', node.id),
    pluginData('appFlowNodeKind', node.kind),
    pluginData('flowSchemaVersion', definition.schemaVersion),
    pluginData('flowSourceFile', definition.sourceFile)
  ]
  const existing = graph
    .getChildren(pageId)
    .find(
      (candidate) =>
        appScreenFlowPluginValue(candidate, 'kind') === FLOW_MARKER_KIND &&
        appScreenFlowPluginValue(candidate, 'appFlowNodeId') === node.id
    )
  const props = {
    ...bounds,
    clipsContent: false,
    fills: [],
    name: node.label,
    strokes: []
  }
  let marker: SceneNode
  if (existing) {
    graph.updateNode(existing.id, {
      ...props,
      pluginData: mergePluginData(
        existing,
        [
          'kind',
          'flowId',
          'flowLane',
          'appFlowNodeId',
          'appFlowNodeKind',
          'flowSchemaVersion',
          'flowSourceFile'
        ],
        markerPluginData
      )
    })
    marker = graph.getNode(existing.id) ?? existing
  } else {
    marker = graph.createNode('FRAME', pageId, { ...props, pluginData: markerPluginData })
  }
  const circle = directChild(graph, marker.id, 'ELLIPSE')
  if (circle) {
    graph.updateNode(circle.id, {
      fills: [solid(node.kind === 'exit' ? COLOR.green : COLOR.connector)],
      height: MARKER_SIZE,
      name: `${node.label} marker`,
      width: MARKER_SIZE,
      x: 0,
      y: 0
    })
  }
  if (!circle) {
    graph.createNode('ELLIPSE', marker.id, {
      fills: [solid(node.kind === 'exit' ? COLOR.green : COLOR.connector)],
      height: MARKER_SIZE,
      name: `${node.label} marker`,
      width: MARKER_SIZE,
      x: 0,
      y: 0
    })
  }
  upsertText(
    graph,
    marker.id,
    directTextChildren(graph, marker.id)[0],
    node.label,
    node.kind === 'entry' ? -72 : 32,
    -2,
    18,
    600,
    COLOR.mutedLight,
    64
  )
  return marker
}

function createCompositionGuide(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition,
  spec: AppFlowCompositionGuide
) {
  const kind = spec.kind === 'chapter' ? FLOW_CHAPTER_KIND : FLOW_LANE_KIND
  const guidePluginData = [
    pluginData('kind', kind),
    pluginData('flowId', definition.id),
    pluginData('flowComposition', composition.kind),
    pluginData('flowGuideId', spec.id),
    pluginData('flowTone', spec.tone),
    ...(spec.lane ? [pluginData('flowLane', spec.lane)] : []),
    pluginData('flowSchemaVersion', definition.schemaVersion),
    pluginData('flowSourceFile', definition.sourceFile)
  ]
  const existing = graph
    .getChildren(pageId)
    .find(
      (candidate) =>
        appScreenFlowPluginValue(candidate, 'kind') === kind &&
        appScreenFlowPluginValue(candidate, 'flowGuideId') === spec.id
    )
  const props = {
    fills: [] as SceneNode['fills'],
    height: 48,
    name: spec.label,
    strokes: [] as SceneNode['strokes'],
    width: spec.width,
    x: spec.x,
    y: spec.y
  }
  let guide: SceneNode
  if (existing) {
    graph.updateNode(existing.id, {
      ...props,
      pluginData: mergePluginData(
        existing,
        [
          'kind',
          'flowId',
          'flowComposition',
          'flowGuideId',
          'flowTone',
          'flowLane',
          'flowSchemaVersion',
          'flowSourceFile'
        ],
        guidePluginData
      )
    })
    guide = graph.getNode(existing.id) ?? existing
  } else {
    guide = graph.createNode('FRAME', pageId, { ...props, pluginData: guidePluginData })
  }
  for (const child of graph.getChildren(guide.id)) {
    if (child.type !== 'TEXT') graph.deleteNode(child.id)
  }
  const textChildren = directTextChildren(graph, guide.id)
  upsertText(
    graph,
    guide.id,
    textChildren[0],
    spec.label,
    0,
    4,
    spec.kind === 'chapter' ? 24 : 20,
    700,
    toneColor(spec.tone),
    spec.width
  )
  for (const child of directTextChildren(graph, guide.id).slice(1)) graph.deleteNode(child.id)
  return guide
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
    pluginData('connectorVersion', FLOW_CONNECTOR_VERSION),
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
  occupiedBounds: Bounds[]
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

function renderEdgeGeometry(
  graph: SceneGraph,
  edgeNode: SceneNode,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition,
  edge: AppScreenFlowEdge,
  route: AppFlowEdgeRoute,
  occupiedBounds: Bounds[]
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

function createRoutedEdge(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition,
  edge: AppScreenFlowEdge,
  route: AppFlowEdgeRoute,
  occupiedBounds: Bounds[]
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
  renderEdgeGeometry(graph, edgeNode, definition, composition, edge, route, occupiedBounds)
  return edgeNode
}

function removeStaleGeneratedFlowNodes(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition
) {
  const validNodeIds = new Set(definition.nodes.map((node) => node.id))
  const validEdgeIds = new Set(definition.edges.map((edge) => edge.id))
  const validGuideIds = new Set(composition.guides.map((guide) => guide.id))
  for (const child of graph.getChildren(pageId)) {
    const kind = appScreenFlowPluginValue(child, 'kind')
    const isSoftwareWorkflowProjection =
      kind === CODE_OBJECT_KIND && Boolean(appScreenFlowPluginValue(child, 'workspaceItemId'))
    const flowNodeId = appScreenFlowPluginValue(child, 'appFlowNodeId')
    const flowEdgeId = appScreenFlowPluginValue(child, 'appFlowEdgeId')
    const flowGuideId = appScreenFlowPluginValue(child, 'flowGuideId')
    const isStaleNode =
      (kind === CODE_OBJECT_KIND ||
        kind === FLOW_FEEDBACK_KIND ||
        kind === FLOW_LABEL_KIND ||
        kind === FLOW_MARKER_KIND) &&
      (!flowNodeId || !validNodeIds.has(flowNodeId))
    const isStaleGuide =
      (kind === FLOW_CHAPTER_KIND || kind === FLOW_LANE_KIND) &&
      (!flowGuideId || !validGuideIds.has(flowGuideId))
    if (
      isSoftwareWorkflowProjection ||
      kind === LEGACY_EDGE_KIND ||
      (kind === FLOW_EDGE_KIND && (!flowEdgeId || !validEdgeIds.has(flowEdgeId))) ||
      isStaleNode ||
      isStaleGuide
    ) {
      graph.deleteNode(child.id)
    }
  }
}

function expectedSceneKind(node: AppScreenFlowNode) {
  if (node.kind === 'screen') return CODE_OBJECT_KIND
  if (node.kind === 'feedback') return FLOW_FEEDBACK_KIND
  return FLOW_MARKER_KIND
}

function pageHasCurrentSchema(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition
) {
  const page = graph.getNode(pageId)
  const children = graph.getChildren(pageId)
  const guide = children.find(
    (candidate) => appScreenFlowPluginValue(candidate, 'kind') === SMYLR_BOARD_GUIDE_KIND
  )
  return (
    appScreenFlowPluginValue(page, 'flowLayoutVersion') === APP_FLOW_LAYOUT_VERSION &&
    appScreenFlowPluginValue(page, 'flowComposition') === composition.kind &&
    appScreenFlowPluginValue(page, 'flowSchemaVersion') === definition.schemaVersion &&
    appScreenFlowPluginValue(page, 'flowSource') === definition.source &&
    appScreenFlowPluginValue(page, 'flowSourceFile') === definition.sourceFile &&
    appScreenFlowPluginValue(guide, 'guideVersion') === SMYLR_BOARD_GUIDE_VERSION &&
    composition.guides.every((spec) =>
      children.some(
        (node) =>
          appScreenFlowPluginValue(node, 'flowGuideId') === spec.id &&
          appScreenFlowPluginValue(node, 'kind') ===
            (spec.kind === 'chapter' ? FLOW_CHAPTER_KIND : FLOW_LANE_KIND)
      )
    ) &&
    definition.nodes.every((node) =>
      children.some((candidate) => {
        if (
          appScreenFlowPluginValue(candidate, 'appFlowNodeId') !== node.id ||
          appScreenFlowPluginValue(candidate, 'kind') !== expectedSceneKind(node)
        ) {
          return false
        }
        if (node.kind === 'feedback') {
          return appScreenFlowPluginValue(candidate, 'flowFeedbackStatus') === node.status
        }
        if (node.kind !== 'screen') return true
        return (
          appScreenFlowPluginValue(candidate, 'pageId') === (node.pageId ?? definition.pageId) &&
          appScreenFlowPluginValue(candidate, 'route') === (node.route ?? definition.route) &&
          appScreenFlowPluginValue(candidate, 'state') === node.state &&
          appScreenFlowPluginValue(candidate, 'renderMedium') === APP_FLOW_CODE_OBJECT_MEDIUM &&
          appScreenFlowPluginValue(candidate, 'captureSrc') === node.captureSrc
        )
      })
    ) &&
    definition.edges.every((edge) =>
      children.some(
        (node) =>
          appScreenFlowPluginValue(node, 'appFlowEdgeId') === edge.id &&
          Boolean(appScreenFlowPluginValue(node, 'sourceAnchorSide')) &&
          Boolean(appScreenFlowPluginValue(node, 'targetAnchorSide')) &&
          Boolean(appScreenFlowPluginValue(node, 'routeChannel')) &&
          appScreenFlowPluginValue(node, 'connectorVersion') === FLOW_CONNECTOR_VERSION
      )
    )
  )
}

function updatePageSchema(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition
) {
  const page = graph.getNode(pageId)
  if (!page) return
  graph.updateNode(page.id, {
    pluginData: mergePluginData(
      page,
      [
        'flowId',
        'flowComposition',
        'flowLayoutVersion',
        'flowSchemaVersion',
        'flowSource',
        'flowSourceFile',
        'flowSourceFormat'
      ],
      [
        pluginData('flowId', definition.id),
        pluginData('flowComposition', composition.kind),
        pluginData('flowLayoutVersion', APP_FLOW_LAYOUT_VERSION),
        pluginData('flowSchemaVersion', definition.schemaVersion),
        pluginData('flowSource', definition.source),
        pluginData('flowSourceFile', definition.sourceFile),
        pluginData('flowSourceFormat', 'markdown')
      ]
    )
  })
}

function routeNode(
  node: AppScreenFlowNode,
  bounds: Bounds,
  composition?: AppFlowComposition
): AppFlowRouteNode {
  const routeLane = composition ? appFlowNodePlacement(composition, node)?.routeLane : undefined
  return { bounds, node: routeLane ? { ...node, lane: routeLane } : node }
}

function markerRouteNode(
  marker: AppScreenFlowNode,
  bounds: Bounds,
  adjacentScreen: AppScreenFlowNode | undefined,
  composition: AppFlowComposition
): AppFlowRouteNode {
  const lane = adjacentScreen
    ? (appFlowNodePlacement(composition, adjacentScreen)?.routeLane ?? adjacentScreen.lane)
    : marker.lane
  return { bounds, node: lane === marker.lane ? marker : { ...marker, lane } }
}

function isSceneNode(node: SceneNode | undefined): node is SceneNode {
  return node !== undefined
}

function repositionFlowMarker(
  graph: SceneGraph,
  nodesById: Map<string, SceneNode>,
  definition: AppScreenFlowDefinition,
  kind: 'entry' | 'exit',
  primaryScreens: SceneNode[]
) {
  const markerDefinition = definition.nodes.find((node) => node.kind === kind)
  const marker = markerDefinition ? nodesById.get(markerDefinition.id) : undefined
  if (!markerDefinition || !marker) return
  graph.updateNode(marker.id, markerBounds(kind, primaryScreens))
  const updated = graph.getNode(marker.id)
  if (updated) nodesById.set(markerDefinition.id, updated)
}

function syncStateLabelPositions(graph: SceneGraph, pageId: string, screens: SceneNode[]) {
  const children = graph.getChildren(pageId)
  for (const screen of screens) {
    const flowNodeId = appScreenFlowPluginValue(screen, 'appFlowNodeId')
    const label = children.find(
      (node) =>
        appScreenFlowPluginValue(node, 'kind') === FLOW_LABEL_KIND &&
        appScreenFlowPluginValue(node, 'appFlowNodeId') === flowNodeId
    )
    if (label) graph.updateNode(label.id, { x: screen.x, y: screen.y - STATE_LABEL_Y_OFFSET })
  }
}

function adjacentPrimaryScreen(node: AppScreenFlowNode, primaryScreens: AppScreenFlowNode[]) {
  if (node.kind === 'entry') return primaryScreens[0]
  if (node.kind === 'exit') return primaryScreens.at(-1)
  return undefined
}

function geometryRouteNodes(
  definition: AppScreenFlowDefinition,
  composition: AppFlowComposition,
  nodesById: ReadonlyMap<string, SceneNode>
) {
  const routeNodesById = new Map<string, AppFlowRouteNode>()
  const primaryScreens = primaryScreenNodes(definition)
  for (const node of definition.nodes) {
    const sceneNode = nodesById.get(node.id)
    if (!sceneNode) continue
    const adjacentScreen = adjacentPrimaryScreen(node, primaryScreens)
    routeNodesById.set(
      node.id,
      adjacentScreen
        ? markerRouteNode(node, sceneNode, adjacentScreen, composition)
        : routeNode(node, sceneNode, composition)
    )
  }
  return routeNodesById
}

function flowPaintRank(node: SceneNode) {
  const kind = appScreenFlowPluginValue(node, 'kind')
  if (kind === SMYLR_BOARD_GUIDE_KIND || kind === FLOW_CHAPTER_KIND || kind === FLOW_LANE_KIND) {
    return 0
  }
  if (kind === CODE_OBJECT_KIND || kind === FLOW_FEEDBACK_KIND) return 1
  if (kind === FLOW_EDGE_KIND) return 2
  return 3
}

function orderGeneratedFlowNodes(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition
) {
  const edgeOrder = new Map(definition.edges.map((edge, index) => [edge.id, index]))
  const nodeOrder = new Map(definition.nodes.map((node, index) => [node.id, index]))
  const generated = graph
    .getChildren(pageId)
    .filter((node) => {
      const kind = appScreenFlowPluginValue(node, 'kind')
      return (
        kind === SMYLR_BOARD_GUIDE_KIND ||
        (appScreenFlowPluginValue(node, 'flowId') === definition.id &&
          [
            FLOW_EDGE_KIND,
            FLOW_FEEDBACK_KIND,
            FLOW_CHAPTER_KIND,
            FLOW_LABEL_KIND,
            FLOW_LANE_KIND,
            FLOW_MARKER_KIND,
            CODE_OBJECT_KIND
          ].includes(kind ?? ''))
      )
    })
    .sort((left, rightNode) => {
      const rank = flowPaintRank(left) - flowPaintRank(rightNode)
      if (rank !== 0) return rank
      const leftEdge = edgeOrder.get(appScreenFlowPluginValue(left, 'appFlowEdgeId') ?? '')
      const rightEdge = edgeOrder.get(appScreenFlowPluginValue(rightNode, 'appFlowEdgeId') ?? '')
      if (leftEdge !== undefined || rightEdge !== undefined) {
        return (leftEdge ?? Number.MAX_SAFE_INTEGER) - (rightEdge ?? Number.MAX_SAFE_INTEGER)
      }
      return (
        (nodeOrder.get(appScreenFlowPluginValue(left, 'appFlowNodeId') ?? '') ??
          Number.MAX_SAFE_INTEGER) -
        (nodeOrder.get(appScreenFlowPluginValue(rightNode, 'appFlowNodeId') ?? '') ??
          Number.MAX_SAFE_INTEGER)
      )
    })
  generated.forEach((node, index) => graph.reorderChild(node.id, pageId, index))
}

export function syncAppScreenFlowScene(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition
): FlowSceneResult {
  const composition = resolveAppFlowComposition(definition)
  if (pageHasCurrentSchema(graph, pageId, definition, composition)) {
    return {
      changed: false,
      screenIds: flowScreenNodes(definition)
        .map((screen) =>
          graph
            .getChildren(pageId)
            .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === screen.id)
        )
        .filter((node): node is SceneNode => node !== undefined)
        .map((node) => node.id)
    }
  }

  removeStaleGeneratedFlowNodes(graph, pageId, definition, composition)
  const screenDefinitions = flowScreenNodes(definition)
  const screens = screenDefinitions.map((node, index) =>
    ensureScreenFrame(graph, pageId, definition, node, index, composition)
  )
  const boundsById = new Map<string, Bounds>()
  const routeNodesById = new Map<string, AppFlowRouteNode>()
  const persistentLabelBounds: Bounds[] = []
  const laneIndexes = new Map<AppScreenFlowLane, number>()
  screenDefinitions.forEach((node, index) => {
    const frame = screens[index]
    const laneIndex = laneIndexes.get(node.lane) ?? 0
    laneIndexes.set(node.lane, laneIndex + 1)
    boundsById.set(node.id, frame)
    routeNodesById.set(node.id, routeNode(node, frame, composition))
    persistentLabelBounds.push(
      createStateLabel(graph, pageId, definition, node, frame, laneIndex, composition)
    )
  })

  flowFeedbackNodes(definition).forEach((node, index) => {
    const feedback = createFeedbackNode(graph, pageId, definition, node, index, composition)
    boundsById.set(node.id, feedback)
    routeNodesById.set(node.id, routeNode(node, feedback, composition))
  })

  const primaryScreens = primaryScreenNodes(definition)
    .map((node) => boundsById.get(node.id))
    .filter((node): node is Bounds => node !== undefined)
  const primaryScreenDefinitions = primaryScreenNodes(definition)
  const entry = definition.nodes.find((node) => node.kind === 'entry')
  const exit = definition.nodes.find((node) => node.kind === 'exit')
  if (entry) {
    const marker = createMarker(
      graph,
      pageId,
      definition,
      entry,
      markerBounds('entry', primaryScreens)
    )
    boundsById.set(entry.id, marker)
    routeNodesById.set(
      entry.id,
      markerRouteNode(entry, marker, primaryScreenDefinitions[0], composition)
    )
  }
  if (exit) {
    const marker = createMarker(
      graph,
      pageId,
      definition,
      exit,
      markerBounds('exit', primaryScreens)
    )
    boundsById.set(exit.id, marker)
    routeNodesById.set(
      exit.id,
      markerRouteNode(exit, marker, primaryScreenDefinitions.at(-1), composition)
    )
  }

  for (const guide of composition.guides) {
    persistentLabelBounds.push(
      createCompositionGuide(graph, pageId, definition, composition, guide)
    )
  }
  persistentLabelBounds.push(
    ensureSmylrBoardGuide(graph, pageId, {
      route: definition.route,
      sourceFile: definition.sourceFile,
      title: definition.label
    })
  )

  const routes = planAppFlowEdgeRoutes(definition, routeNodesById)
  const occupiedBounds = [
    ...[...routeNodesById.values()].map((node) => node.bounds),
    ...persistentLabelBounds
  ]
  for (const edge of definition.edges) {
    const route = routes.get(edge.id)
    if (route) {
      createRoutedEdge(graph, pageId, definition, composition, edge, route, occupiedBounds)
    }
  }
  updatePageSchema(graph, pageId, definition, composition)
  orderGeneratedFlowNodes(graph, pageId, definition)
  return { changed: true, screenIds: screens.map((screen) => screen.id) }
}

export function syncDentalChartAppFlowScene(graph: SceneGraph, pageId: string) {
  return syncAppScreenFlowScene(graph, pageId, DENTAL_CHART_APP_FLOW)
}

export function syncProductMapDentalChartAppFlowScene(graph: SceneGraph, pageId: string) {
  return syncAppScreenFlowScene(graph, pageId, PRODUCT_MAP_DENTAL_CHART_APP_FLOW)
}

export function syncAppScreenFlowGeometry(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition
) {
  const composition = resolveAppFlowComposition(definition)
  const page = graph.getNode(pageId)
  if (appScreenFlowPluginValue(page, 'flowId') !== definition.id) return false
  const nodesById = new Map<string, SceneNode>()
  for (const child of graph.getChildren(pageId)) {
    const nodeId = appScreenFlowPluginValue(child, 'appFlowNodeId')
    const kind = appScreenFlowPluginValue(child, 'kind')
    if (
      nodeId &&
      (kind === CODE_OBJECT_KIND || kind === FLOW_FEEDBACK_KIND || kind === FLOW_MARKER_KIND)
    ) {
      nodesById.set(nodeId, child)
    }
  }
  const screens = flowScreenNodes(definition)
    .map((node) => nodesById.get(node.id))
    .filter(isSceneNode)
  if (screens.length !== flowScreenNodes(definition).length) return false

  const primaryScreens = primaryScreenNodes(definition)
    .map((node) => nodesById.get(node.id))
    .filter(isSceneNode)
  repositionFlowMarker(graph, nodesById, definition, 'entry', primaryScreens)
  repositionFlowMarker(graph, nodesById, definition, 'exit', primaryScreens)
  syncStateLabelPositions(graph, pageId, screens)

  const routeNodesById = geometryRouteNodes(definition, composition, nodesById)
  const routes = planAppFlowEdgeRoutes(definition, routeNodesById)
  const persistentLabelBounds = graph.getChildren(pageId).filter((node) => {
    const kind = appScreenFlowPluginValue(node, 'kind')
    return (
      kind === FLOW_LABEL_KIND ||
      kind === FLOW_CHAPTER_KIND ||
      kind === FLOW_LANE_KIND ||
      kind === SMYLR_BOARD_GUIDE_KIND
    )
  })
  const occupiedBounds = [
    ...[...routeNodesById.values()].map((node) => node.bounds),
    ...persistentLabelBounds
  ]
  for (const edge of definition.edges) {
    const edgeNode = graph
      .getChildren(pageId)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === edge.id)
    const route = routes.get(edge.id)
    if (edgeNode && route) {
      graph.updateNode(edgeNode.id, {
        pluginData: mergePluginData(
          edgeNode,
          ['sourceAnchorSide', 'targetAnchorSide', 'routeChannel'],
          [
            pluginData('sourceAnchorSide', route.sourceSide),
            pluginData('targetAnchorSide', route.targetSide),
            pluginData('routeChannel', route.channel)
          ]
        )
      })
      renderEdgeGeometry(graph, edgeNode, definition, composition, edge, route, occupiedBounds)
    }
  }
  orderGeneratedFlowNodes(graph, pageId, definition)
  return true
}

export function syncDentalChartAppFlowGeometry(graph: SceneGraph, pageId: string) {
  return syncAppScreenFlowGeometry(graph, pageId, DENTAL_CHART_APP_FLOW)
}

export function syncProductMapDentalChartAppFlowGeometry(graph: SceneGraph, pageId: string) {
  return syncAppScreenFlowGeometry(graph, pageId, PRODUCT_MAP_DENTAL_CHART_APP_FLOW)
}

export function syncAppScreenFlowGeometryForNode(
  graph: SceneGraph,
  node: SceneNode | null | undefined
) {
  if (!node?.parentId) return false
  const definition = appScreenFlowDefinitionById(appScreenFlowPluginValue(node, 'flowId'))
  if (!definition || !isAppScreenFlowGeometryNode(node)) return false
  return syncAppScreenFlowGeometry(graph, node.parentId, definition)
}

export function isDentalChartAppFlowScreen(node: SceneNode | null | undefined) {
  return (
    appScreenFlowPluginValue(node, 'flowId') === DENTAL_CHART_APP_FLOW.id &&
    appScreenFlowPluginValue(node, 'appFlowNodeKind') === 'screen'
  )
}

export function isDentalChartAppFlowGeometryNode(node: SceneNode | null | undefined) {
  return (
    appScreenFlowPluginValue(node, 'flowId') === DENTAL_CHART_APP_FLOW.id &&
    isAppScreenFlowGeometryNode(node)
  )
}

export function isAppScreenFlowGeometryNode(node: SceneNode | null | undefined) {
  const kind = appScreenFlowPluginValue(node, 'appFlowNodeKind')
  return (
    Boolean(appScreenFlowDefinitionById(appScreenFlowPluginValue(node, 'flowId'))) &&
    (kind === 'feedback' || kind === 'screen')
  )
}

export { appScreenFlowPluginValue } from './primitives'
