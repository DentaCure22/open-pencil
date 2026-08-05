import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  addAppFlowText,
  APP_FLOW_COLOR as COLOR,
  appFlowPluginData as pluginData,
  updateAppFlowText
} from './app-flow/primitives'

export const SMYLR_BOARD_GUIDE_KIND = 'smylr-board-guide'
export const SMYLR_BOARD_GUIDE_VERSION = '8'

const BOARD_GUIDE_X = 224
const BOARD_GUIDE_Y = -248
const BOARD_GUIDE_WIDTH = 1500
const BOARD_GUIDE_HEIGHT = 56

const PLUGIN_ID = 'smylr-production'

function pluginValue(node: SceneNode, key: string) {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

export function findSmylrBoardGuide(graph: SceneGraph, pageId: string) {
  return (
    graph
      .getChildren(pageId)
      .find((node) => pluginValue(node, 'kind') === SMYLR_BOARD_GUIDE_KIND) ?? null
  )
}

export function ensureSmylrBoardGuide(
  graph: SceneGraph,
  pageId: string,
  options: { route?: string; sourceFile?: string; title?: string } = {}
) {
  const title = options.title?.trim() || 'How this board works'
  const guidePluginData = [
    pluginData('kind', SMYLR_BOARD_GUIDE_KIND),
    pluginData('route', options.route ?? ''),
    pluginData('sourceFile', options.sourceFile ?? ''),
    pluginData('guideVersion', SMYLR_BOARD_GUIDE_VERSION)
  ]
  const existing = findSmylrBoardGuide(graph, pageId)
  const props = {
    clipsContent: false,
    cornerRadius: 0,
    fills: [] as SceneNode['fills'],
    height: BOARD_GUIDE_HEIGHT,
    name: title,
    pluginData: [
      ...(existing?.pluginData ?? []).filter(
        (entry) =>
          !(
            entry.pluginId === PLUGIN_ID &&
            ['kind', 'route', 'sourceFile', 'guideVersion'].includes(entry.key)
          )
      ),
      ...guidePluginData
    ],
    strokes: [] as SceneNode['strokes'],
    width: BOARD_GUIDE_WIDTH,
    x: BOARD_GUIDE_X,
    y: BOARD_GUIDE_Y
  }
  let guide: SceneNode
  if (existing?.type === 'FRAME') {
    graph.updateNode(existing.id, props)
    guide = graph.getNode(existing.id) ?? existing
  } else if (existing) {
    const id = existing.id
    graph.deleteNode(id)
    guide = graph.createNodeWithId(id, 'FRAME', pageId, props)
  } else {
    guide = graph.createNode('FRAME', pageId, props)
  }
  for (const child of graph.getChildren(guide.id)) {
    if (child.type !== 'TEXT') graph.deleteNode(child.id)
  }
  const textChildren = graph.getChildren(guide.id).filter((child) => child.type === 'TEXT')
  if (textChildren[0]) {
    updateAppFlowText(graph, textChildren[0].id, title, 0, 4, 32, 600, COLOR.white, 1400)
  } else {
    addAppFlowText(graph, guide.id, title, 0, 4, 32, 600, COLOR.white, 1400)
  }
  for (const child of textChildren.slice(1)) graph.deleteNode(child.id)
  return guide
}
