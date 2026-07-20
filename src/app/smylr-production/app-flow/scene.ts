import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { solid, thinStroke } from '@/app/demo/colors'

import { ensureSmylrBoardGuide, SMYLR_BOARD_GUIDE_KIND } from '../board-guide'
import { DEFAULT_LIVE_FRAME_RADIUS } from '../frame-corners'
import {
  DENTAL_CHART_APP_FLOW,
  type AppScreenFlowDefinition,
  type AppScreenFlowEdge,
  type AppScreenFlowNode
} from './model'
import {
  addAppFlowText as addText,
  APP_FLOW_COLOR as COLOR,
  appFlowPluginData as pluginData,
  appScreenFlowPluginValue,
  mergeAppFlowPluginData as mergePluginData
} from './primitives'

const LIVE_APP_KIND = 'live-app-frame'
const FLOW_EDGE_KIND = 'app-screen-flow-edge'
const FLOW_LABEL_KIND = 'app-screen-flow-state-label'
const FLOW_MARKER_KIND = 'app-screen-flow-marker'
const FLOW_PART_KIND = 'app-screen-flow-part'
const LEGACY_EDGE_KIND = 'flow-connector'

export const APP_FLOW_SCREEN_WIDTH = 1280
export const APP_FLOW_SCREEN_HEIGHT = 900
export const APP_FLOW_SCREEN_GAP = 300

const SCREEN_START_X = 380
const SCREEN_Y = 140
const STATE_LABEL_Y_OFFSET = 300
const MARKER_SIZE = 116
const LOOP_DEPTH = 260

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

function screenX(index: number) {
  return SCREEN_START_X + index * (APP_FLOW_SCREEN_WIDTH + APP_FLOW_SCREEN_GAP)
}

function screenFramePluginData(
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode & { kind: 'screen'; state: string },
  index: number
) {
  return [
    pluginData('kind', LIVE_APP_KIND),
    pluginData('pageId', definition.pageId),
    pluginData('route', definition.route),
    pluginData('state', node.state),
    pluginData('flowId', definition.id),
    pluginData('flowIndex', String(index)),
    pluginData('appFlowNodeId', node.id),
    pluginData('appFlowNodeKind', node.kind),
    pluginData('flowSchemaVersion', definition.schemaVersion)
  ]
}

function ensureScreenFrame(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode & { kind: 'screen'; state: string },
  index: number
) {
  const existing = graph
    .getChildren(pageId)
    .find(
      (candidate) =>
        appScreenFlowPluginValue(candidate, 'kind') === LIVE_APP_KIND &&
        appScreenFlowPluginValue(candidate, 'state') === node.state &&
        !appScreenFlowPluginValue(candidate, 'workspaceItemId')
    )
  const props = {
    clipsContent: true,
    cornerRadius: DEFAULT_LIVE_FRAME_RADIUS,
    fills: [] as SceneNode['fills'],
    height: APP_FLOW_SCREEN_HEIGHT,
    name: `Dental Chart / ${node.label}`,
    strokes: [] as SceneNode['strokes'],
    width: APP_FLOW_SCREEN_WIDTH,
    x: screenX(index),
    y: SCREEN_Y
  }
  if (!existing) {
    return graph.createNode('FRAME', pageId, {
      ...props,
      pluginData: screenFramePluginData(definition, node, index)
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
        'flowId',
        'flowIndex',
        'appFlowNodeId',
        'appFlowNodeKind',
        'flowSchemaVersion'
      ],
      screenFramePluginData(definition, node, index)
    )
  })
  return graph.getNode(existing.id) ?? existing
}

function createStateLabel(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  node: AppScreenFlowNode,
  frame: SceneNode,
  index: number
) {
  const label = graph.createNode('FRAME', pageId, {
    cornerRadius: 18,
    fills: [solid(COLOR.white, 0.96)],
    height: 100,
    name: `${node.label} state label`,
    pluginData: [
      pluginData('kind', FLOW_LABEL_KIND),
      pluginData('flowId', definition.id),
      pluginData('appFlowNodeId', node.id),
      pluginData('flowSchemaVersion', definition.schemaVersion)
    ],
    strokes: thinStroke(COLOR.line),
    width: 520,
    x: frame.x,
    y: frame.y - STATE_LABEL_Y_OFFSET
  })
  const number = String(index + 1).padStart(2, '0')
  const badge = graph.createNode('ELLIPSE', label.id, {
    fills: [solid(COLOR.violetSoft)],
    height: 64,
    name: `Step ${number}`,
    width: 64,
    x: 18,
    y: 18
  })
  addText(graph, badge.id, number, 13, 14, 26, 700, COLOR.violet, 40)
  addText(graph, label.id, node.label, 108, 17, 38, 700, COLOR.ink, 386)
  addText(graph, label.id, 'REAL WEB SCREEN', 108, 65, 15, 700, COLOR.muted, 240)
  return label
}

function markerBounds(kind: 'entry' | 'exit', screens: SceneNode[]): Bounds {
  const anchor = kind === 'entry' ? screens[0] : screens.at(-1)
  if (!anchor) return { height: MARKER_SIZE, width: MARKER_SIZE, x: 0, y: 0 }
  return {
    height: MARKER_SIZE,
    width: MARKER_SIZE,
    x: kind === 'entry' ? anchor.x - 250 : anchor.x + anchor.width + 190,
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
  const marker = graph.createNode('FRAME', pageId, {
    fills: [],
    ...bounds,
    name: node.label,
    pluginData: [
      pluginData('kind', FLOW_MARKER_KIND),
      pluginData('flowId', definition.id),
      pluginData('appFlowNodeId', node.id),
      pluginData('appFlowNodeKind', node.kind),
      pluginData('flowSchemaVersion', definition.schemaVersion)
    ],
    strokes: []
  })
  graph.createNode('ELLIPSE', marker.id, {
    fills: [solid(node.kind === 'exit' ? COLOR.green : COLOR.violet)],
    height: MARKER_SIZE,
    name: `${node.label} marker`,
    width: MARKER_SIZE,
    x: 0,
    y: 0
  })
  addText(
    graph,
    marker.id,
    node.label.toUpperCase(),
    node.kind === 'exit' ? 27 : 22,
    39,
    22,
    700,
    COLOR.white,
    90
  )
  return marker
}

function createEdgeLabel(
  graph: SceneGraph,
  parentId: string,
  edge: AppScreenFlowEdge,
  x: number,
  y: number,
  width: number
) {
  const label = graph.createNode('FRAME', parentId, {
    cornerRadius: 24,
    fills: [solid(COLOR.white, 0.98)],
    height: 56,
    name: `${edge.label} label`,
    pluginData: [pluginData('kind', FLOW_PART_KIND), pluginData('part', 'label')],
    strokes: thinStroke(COLOR.line),
    width,
    x,
    y
  })
  addText(graph, label.id, edge.label, 20, 13, 24, 700, COLOR.ink, width - 40)
}

function edgePluginData(
  definition: AppScreenFlowDefinition,
  edge: AppScreenFlowEdge
): SceneNode['pluginData'] {
  return [
    pluginData('kind', FLOW_EDGE_KIND),
    pluginData('flowId', definition.id),
    pluginData('appFlowEdgeId', edge.id),
    pluginData('sourceFlowNodeId', edge.sourceId),
    pluginData('targetFlowNodeId', edge.targetId),
    pluginData('transitionLabel', edge.label),
    pluginData('edgeKind', edge.kind),
    pluginData('flowSchemaVersion', definition.schemaVersion)
  ]
}

function createEdgeArrow(
  graph: SceneGraph,
  parentId: string,
  edge: AppScreenFlowEdge,
  geometry: Bounds & { rotation?: number }
) {
  graph.createNode('POLYGON', parentId, {
    fills: [solid(COLOR.violet)],
    ...geometry,
    name: `${edge.label} arrow`,
    pluginData: [pluginData('kind', FLOW_PART_KIND), pluginData('part', 'arrow')],
    pointCount: 3
  })
}

function createStraightEdge(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  edge: AppScreenFlowEdge,
  source: Bounds,
  target: Bounds
) {
  const startX = source.x + source.width
  const endX = target.x
  const width = Math.max(40, endX - startX)
  const centerY = source.y + source.height / 2
  const edgeNode = graph.createNode('FRAME', pageId, {
    fills: [],
    height: 120,
    name: `${edge.label}: ${edge.sourceId} to ${edge.targetId}`,
    pluginData: edgePluginData(definition, edge),
    strokes: [],
    width,
    x: startX,
    y: centerY - 60
  })
  graph.createNode('RECTANGLE', edgeNode.id, {
    cornerRadius: 6,
    fills: [solid(COLOR.violet)],
    height: 12,
    name: `${edge.label} line`,
    pluginData: [pluginData('kind', FLOW_PART_KIND), pluginData('part', 'line')],
    width: Math.max(12, width - 42),
    x: 0,
    y: 76
  })
  createEdgeArrow(graph, edgeNode.id, edge, {
    height: 44,
    rotation: 90,
    width: 44,
    x: width - 40,
    y: 60
  })
  const labelWidth = Math.min(260, Math.max(174, edge.label.length * 14 + 48))
  createEdgeLabel(graph, edgeNode.id, edge, Math.max(0, width / 2 - labelWidth / 2), 0, labelWidth)
  graph.reorderChild(edgeNode.id, pageId, 0)
  return edgeNode
}

function createLoopEdge(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition,
  edge: AppScreenFlowEdge,
  source: Bounds,
  target: Bounds
) {
  const targetCenterX = target.x + target.width / 2
  const sourceCenterX = source.x + source.width / 2
  const x = Math.min(targetCenterX, sourceCenterX)
  const width = Math.max(80, Math.abs(sourceCenterX - targetCenterX))
  const edgeNode = graph.createNode('FRAME', pageId, {
    fills: [],
    height: LOOP_DEPTH,
    name: `${edge.label}: ${edge.sourceId} back to ${edge.targetId}`,
    pluginData: edgePluginData(definition, edge),
    strokes: [],
    width,
    x,
    y: Math.max(source.y + source.height, target.y + target.height)
  })
  const segments = [
    { height: 178, part: 'source-leg', width: 12, x: width - 12, y: 0 },
    { height: 12, part: 'return-line', width, x: 0, y: 166 },
    { height: 130, part: 'target-leg', width: 12, x: 0, y: 48 }
  ]
  for (const segment of segments) {
    graph.createNode('RECTANGLE', edgeNode.id, {
      cornerRadius: 6,
      fills: [solid(COLOR.violet)],
      ...segment,
      name: `${edge.label} ${segment.part}`,
      pluginData: [pluginData('kind', FLOW_PART_KIND), pluginData('part', segment.part)]
    })
  }
  createEdgeArrow(graph, edgeNode.id, edge, {
    height: 44,
    width: 44,
    x: -16,
    y: 0
  })
  createEdgeLabel(graph, edgeNode.id, edge, width / 2 - 94, 196, 188)
  graph.reorderChild(edgeNode.id, pageId, 0)
  return edgeNode
}

function removeGeneratedFlowNodes(graph: SceneGraph, pageId: string) {
  for (const child of [...graph.getChildren(pageId)]) {
    const kind = appScreenFlowPluginValue(child, 'kind')
    const isSoftwareWorkflowProjection =
      kind === LIVE_APP_KIND && Boolean(appScreenFlowPluginValue(child, 'workspaceItemId'))
    if (
      isSoftwareWorkflowProjection ||
      kind === LEGACY_EDGE_KIND ||
      kind === FLOW_EDGE_KIND ||
      kind === FLOW_LABEL_KIND ||
      kind === FLOW_MARKER_KIND ||
      kind === SMYLR_BOARD_GUIDE_KIND
    ) {
      graph.deleteNode(child.id)
    }
  }
}

function pageHasCurrentSchema(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition
) {
  const page = graph.getNode(pageId)
  const screens = flowScreenNodes(definition)
  return (
    appScreenFlowPluginValue(page, 'flowSchemaVersion') === definition.schemaVersion &&
    screens.every((screen) =>
      graph
        .getChildren(pageId)
        .some(
          (node) =>
            appScreenFlowPluginValue(node, 'appFlowNodeId') === screen.id &&
            appScreenFlowPluginValue(node, 'kind') === LIVE_APP_KIND
        )
    ) &&
    definition.edges.every((edge) =>
      graph
        .getChildren(pageId)
        .some((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === edge.id)
    )
  )
}

function updatePageSchema(graph: SceneGraph, pageId: string, definition: AppScreenFlowDefinition) {
  const page = graph.getNode(pageId)
  if (!page) return
  graph.updateNode(page.id, {
    pluginData: mergePluginData(
      page,
      ['flowId', 'flowSchemaVersion'],
      [
        pluginData('flowId', definition.id),
        pluginData('flowSchemaVersion', definition.schemaVersion)
      ]
    )
  })
}

export function syncAppScreenFlowScene(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition
): FlowSceneResult {
  if (pageHasCurrentSchema(graph, pageId, definition)) {
    return {
      changed: false,
      screenIds: flowScreenNodes(definition)
        .map((screen) =>
          graph
            .getChildren(pageId)
            .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === screen.id)
        )
        .filter((node): node is SceneNode => Boolean(node))
        .map((node) => node.id)
    }
  }

  removeGeneratedFlowNodes(graph, pageId)
  const screenDefinitions = flowScreenNodes(definition)
  const screens = screenDefinitions.map((node, index) =>
    ensureScreenFrame(graph, pageId, definition, node, index)
  )
  const boundsById = new Map<string, Bounds>()
  screenDefinitions.forEach((node, index) => {
    const frame = screens[index]
    if (!frame) return
    boundsById.set(node.id, frame)
    createStateLabel(graph, pageId, definition, node, frame, index)
  })

  const entry = definition.nodes.find((node) => node.kind === 'entry')
  const exit = definition.nodes.find((node) => node.kind === 'exit')
  if (entry) {
    const marker = createMarker(graph, pageId, definition, entry, markerBounds('entry', screens))
    boundsById.set(entry.id, marker)
  }
  if (exit) {
    const marker = createMarker(graph, pageId, definition, exit, markerBounds('exit', screens))
    boundsById.set(exit.id, marker)
  }

  for (const edge of definition.edges) {
    const source = boundsById.get(edge.sourceId)
    const target = boundsById.get(edge.targetId)
    if (!source || !target) continue
    if (edge.kind === 'loop') {
      createLoopEdge(graph, pageId, definition, edge, source, target)
    } else {
      createStraightEdge(graph, pageId, definition, edge, source, target)
    }
  }

  ensureSmylrBoardGuide(graph, pageId, {
    route: definition.route,
    title: definition.label
  })
  updatePageSchema(graph, pageId, definition)
  return { changed: true, screenIds: screens.map((screen) => screen.id) }
}

export function syncDentalChartAppFlowScene(graph: SceneGraph, pageId: string) {
  return syncAppScreenFlowScene(graph, pageId, DENTAL_CHART_APP_FLOW)
}

function childPart(graph: SceneGraph, parentId: string, part: string) {
  return graph.getChildren(parentId).find((node) => appScreenFlowPluginValue(node, 'part') === part)
}

function updateStraightEdgeGeometry(
  graph: SceneGraph,
  edgeNode: SceneNode,
  source: Bounds,
  target: Bounds
) {
  const startX = source.x + source.width
  const width = Math.max(40, target.x - startX)
  graph.updateNode(edgeNode.id, {
    height: 120,
    width,
    x: startX,
    y: source.y + source.height / 2 - 60
  })
  const line = childPart(graph, edgeNode.id, 'line')
  const arrow = childPart(graph, edgeNode.id, 'arrow')
  const label = childPart(graph, edgeNode.id, 'label')
  if (line) graph.updateNode(line.id, { width: Math.max(12, width - 42) })
  if (arrow) graph.updateNode(arrow.id, { x: width - 40 })
  if (label) graph.updateNode(label.id, { x: Math.max(0, width / 2 - label.width / 2) })
}

function updateLoopEdgeGeometry(
  graph: SceneGraph,
  edgeNode: SceneNode,
  source: Bounds,
  target: Bounds
) {
  const targetCenterX = target.x + target.width / 2
  const sourceCenterX = source.x + source.width / 2
  const width = Math.max(80, Math.abs(sourceCenterX - targetCenterX))
  graph.updateNode(edgeNode.id, {
    height: LOOP_DEPTH,
    width,
    x: Math.min(targetCenterX, sourceCenterX),
    y: Math.max(source.y + source.height, target.y + target.height)
  })
  const sourceLeg = childPart(graph, edgeNode.id, 'source-leg')
  const returnLine = childPart(graph, edgeNode.id, 'return-line')
  const label = childPart(graph, edgeNode.id, 'label')
  if (sourceLeg) graph.updateNode(sourceLeg.id, { x: width - sourceLeg.width })
  if (returnLine) graph.updateNode(returnLine.id, { width })
  if (label) graph.updateNode(label.id, { x: width / 2 - label.width / 2 })
}

export function syncDentalChartAppFlowGeometry(graph: SceneGraph, pageId: string) {
  const page = graph.getNode(pageId)
  if (appScreenFlowPluginValue(page, 'flowId') !== DENTAL_CHART_APP_FLOW.id) return false
  const nodesById = new Map<string, SceneNode>()
  for (const child of graph.getChildren(pageId)) {
    const nodeId = appScreenFlowPluginValue(child, 'appFlowNodeId')
    const kind = appScreenFlowPluginValue(child, 'kind')
    if (nodeId && (kind === LIVE_APP_KIND || kind === FLOW_MARKER_KIND)) {
      nodesById.set(nodeId, child)
    }
  }
  const screens = flowScreenNodes(DENTAL_CHART_APP_FLOW)
    .map((node) => nodesById.get(node.id))
    .filter((node): node is SceneNode => Boolean(node))
  if (screens.length !== flowScreenNodes(DENTAL_CHART_APP_FLOW).length) return false

  const entryMarker = nodesById.get('entry')
  const exitMarker = nodesById.get('exit')
  if (entryMarker) graph.updateNode(entryMarker.id, markerBounds('entry', screens))
  if (exitMarker) graph.updateNode(exitMarker.id, markerBounds('exit', screens))

  for (const screen of screens) {
    const flowNodeId = appScreenFlowPluginValue(screen, 'appFlowNodeId')
    const label = graph
      .getChildren(pageId)
      .find(
        (node) =>
          appScreenFlowPluginValue(node, 'kind') === FLOW_LABEL_KIND &&
          appScreenFlowPluginValue(node, 'appFlowNodeId') === flowNodeId
      )
    if (label) graph.updateNode(label.id, { x: screen.x, y: screen.y - STATE_LABEL_Y_OFFSET })
  }

  const refreshedBounds = new Map<string, Bounds>()
  for (const child of graph.getChildren(pageId)) {
    const nodeId = appScreenFlowPluginValue(child, 'appFlowNodeId')
    const kind = appScreenFlowPluginValue(child, 'kind')
    if (nodeId && (kind === LIVE_APP_KIND || kind === FLOW_MARKER_KIND)) {
      refreshedBounds.set(nodeId, child)
    }
  }
  for (const edge of DENTAL_CHART_APP_FLOW.edges) {
    const edgeNode = graph
      .getChildren(pageId)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === edge.id)
    const source = refreshedBounds.get(edge.sourceId)
    const target = refreshedBounds.get(edge.targetId)
    if (!edgeNode || !source || !target) continue
    if (edge.kind === 'loop') updateLoopEdgeGeometry(graph, edgeNode, source, target)
    else updateStraightEdgeGeometry(graph, edgeNode, source, target)
  }
  return true
}

export function isDentalChartAppFlowScreen(node: SceneNode | null | undefined) {
  return (
    appScreenFlowPluginValue(node, 'flowId') === DENTAL_CHART_APP_FLOW.id &&
    appScreenFlowPluginValue(node, 'appFlowNodeKind') === 'screen'
  )
}

export { appScreenFlowPluginValue } from './primitives'
