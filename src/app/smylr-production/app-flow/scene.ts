import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  ensureSmylrBoardGuide,
  SMYLR_BOARD_GUIDE_KIND,
  SMYLR_BOARD_GUIDE_VERSION
} from '../board-guide'
import {
  APP_FLOW_LAYOUT_VERSION,
  type AppFlowComposition,
  appFlowNodePlacement,
  resolveAppFlowComposition
} from './layout'
import {
  appScreenFlowDefinitionById,
  DENTAL_CHART_APP_FLOW,
  PRODUCT_MAP_DENTAL_CHART_APP_FLOW,
  type AppScreenFlowDefinition,
  type AppScreenFlowLane,
  type AppScreenFlowNode
} from './model'
import {
  APP_FLOW_CODE_OBJECT_MEDIUM,
  appFlowPluginData as pluginData,
  appScreenFlowPluginValue,
  mergeAppFlowPluginData as mergePluginData
} from './primitives'
import { type AppFlowRouteNode, planAppFlowEdgeRoutes } from './routing'
import {
  APP_FLOW_CONNECTOR_VERSION,
  syncRoutedAppFlowEdge,
  syncRoutedAppFlowEdgeGeometry
} from './scene-edges'
import {
  APP_FLOW_GENERATED_KIND,
  createCompositionGuide,
  createFeedbackNode,
  createMarker,
  createStateLabel,
  ensureScreenFrame,
  markerBounds,
  syncStateLabelPositions
} from './scene-elements'

const {
  chapter: FLOW_CHAPTER_KIND,
  codeObject: CODE_OBJECT_KIND,
  feedback: FLOW_FEEDBACK_KIND,
  label: FLOW_LABEL_KIND,
  lane: FLOW_LANE_KIND,
  marker: FLOW_MARKER_KIND
} = APP_FLOW_GENERATED_KIND
const FLOW_EDGE_KIND = 'app-screen-flow-edge'
const LEGACY_EDGE_KIND = 'flow-connector'

export { APP_FLOW_SCREEN_GAP, APP_FLOW_SCREEN_HEIGHT, APP_FLOW_SCREEN_WIDTH } from './layout'

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
          appScreenFlowPluginValue(node, 'connectorVersion') === APP_FLOW_CONNECTOR_VERSION
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
      syncRoutedAppFlowEdge(graph, pageId, definition, composition, edge, route, occupiedBounds)
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
      syncRoutedAppFlowEdgeGeometry(
        graph,
        edgeNode,
        definition,
        composition,
        edge,
        route,
        occupiedBounds
      )
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
