import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { solid, thinStroke } from '../demo/colors'
import {
  addAppFlowText as addText,
  APP_FLOW_COLOR as COLOR,
  appFlowPluginData as pluginData
} from './app-flow/primitives'

export const SMYLR_BOARD_GUIDE_KIND = 'smylr-board-guide'

const PLUGIN_ID = 'smylr-production'

function pluginValue(node: SceneNode, key: string) {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function addPill(
  graph: SceneGraph,
  parentId: string,
  label: string,
  x: number,
  y: number,
  width: number,
  background: Color,
  foreground: Color
) {
  const pill = graph.createNode('FRAME', parentId, {
    x,
    y,
    width,
    height: 32,
    name: label,
    fills: [solid(background)],
    cornerRadius: 16
  })
  addText(graph, pill.id, label, 14, 7, 12, 600, foreground, width - 28)
  return pill
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
  options: { title?: string; route?: string } = {}
) {
  const existing = findSmylrBoardGuide(graph, pageId)
  if (existing) return existing

  const title = options.title?.trim() || 'How this board works'
  const guide = graph.createNode('SECTION', pageId, {
    x: 96,
    y: -430,
    width: 1740,
    height: 170,
    name: title,
    fills: [solid(COLOR.canvas)],
    strokes: thinStroke(COLOR.line),
    cornerRadius: 20,
    pluginData: [
      pluginData('kind', SMYLR_BOARD_GUIDE_KIND),
      pluginData('route', options.route ?? ''),
      pluginData('guideVersion', '2')
    ]
  })

  addText(graph, guide.id, title, 28, 22, 28, 700, COLOR.ink, 540)
  addText(
    graph,
    guide.id,
    'Follow the real web screens left to right. Each labeled arrow is a user action.',
    28,
    64,
    15,
    400,
    COLOR.muted,
    760
  )

  addPill(graph, guide.id, 'Real screens', 28, 108, 142, COLOR.blueSoft, COLOR.blue)
  addPill(graph, guide.id, 'Arrows are actions', 182, 108, 174, COLOR.violetSoft, COLOR.violet)
  addPill(graph, guide.id, 'Choices can loop', 368, 108, 166, COLOR.violetSoft, COLOR.violet)
  addText(
    graph,
    guide.id,
    'Ordinary board · screens, labels, and paths stay selectable and editable',
    950,
    70,
    15,
    600,
    COLOR.muted,
    700
  )

  return guide
}
