import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { DEFAULT_CODE_OBJECT_RADIUS } from '@/app/code-object/transform'
import { solid } from '@/app/demo/colors'

import {
  appFlowNodePlacement,
  type AppFlowComposition,
  type AppFlowCompositionGuide,
  type AppFlowNodePlacement,
  type AppFlowTone
} from './layout'
import type { AppScreenFlowDefinition, AppScreenFlowLane, AppScreenFlowNode } from './model'
import {
  addAppFlowText as addText,
  APP_FLOW_COLOR as COLOR,
  APP_FLOW_CODE_OBJECT_MEDIUM,
  appFlowPluginData as pluginData,
  appScreenFlowPluginValue,
  mergeAppFlowPluginData as mergePluginData,
  updateAppFlowText
} from './primitives'

const CODE_OBJECT_KIND = 'smylr-code-object-frame'
const FLOW_FEEDBACK_KIND = 'app-screen-flow-feedback'
const FLOW_CHAPTER_KIND = 'app-screen-flow-chapter'
const FLOW_LABEL_KIND = 'app-screen-flow-state-label'
const FLOW_LANE_KIND = 'app-screen-flow-lane'
const FLOW_MARKER_KIND = 'app-screen-flow-marker'

export const APP_FLOW_GENERATED_KIND = {
  chapter: FLOW_CHAPTER_KIND,
  codeObject: CODE_OBJECT_KIND,
  feedback: FLOW_FEEDBACK_KIND,
  label: FLOW_LABEL_KIND,
  lane: FLOW_LANE_KIND,
  marker: FLOW_MARKER_KIND
} as const

const STATE_LABEL_HEIGHT = 56
const STATE_LABEL_Y_OFFSET = 128
const MARKER_SIZE = 20
const MARKER_GAP = 128

export type AppFlowSceneBounds = Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>

type Bounds = AppFlowSceneBounds

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

export function ensureScreenFrame(
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

export function createStateLabel(
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

export function syncStateLabelPositions(graph: SceneGraph, pageId: string, screens: SceneNode[]) {
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

export function createFeedbackNode(
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

export function markerBounds(kind: 'entry' | 'exit', screens: Bounds[]): Bounds {
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

export function createMarker(
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

export function createCompositionGuide(
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
