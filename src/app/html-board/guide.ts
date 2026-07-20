import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { solid, thinStroke } from '../demo/colors'

const PLUGIN_ID = 'openpencil-html-board'
const GUIDE_KIND = 'html-board-guide'
const FONT = 'Inter'
const COLOR = {
  blue: { r: 0.2, g: 0.39, b: 0.91, a: 1 } satisfies Color,
  blueSoft: { r: 0.9, g: 0.94, b: 1, a: 1 } satisfies Color,
  canvas: { r: 0.97, g: 0.975, b: 0.985, a: 1 } satisfies Color,
  green: { r: 0.08, g: 0.52, b: 0.3, a: 1 } satisfies Color,
  greenSoft: { r: 0.9, g: 0.98, b: 0.93, a: 1 } satisfies Color,
  ink: { r: 0.08, g: 0.1, b: 0.16, a: 1 } satisfies Color,
  line: { r: 0.85, g: 0.87, b: 0.91, a: 1 } satisfies Color,
  muted: { r: 0.38, g: 0.42, b: 0.5, a: 1 } satisfies Color,
  violet: { r: 0.45, g: 0.31, b: 0.91, a: 1 } satisfies Color,
  violetSoft: { r: 0.94, g: 0.92, b: 1, a: 1 } satisfies Color,
  white: { r: 1, g: 1, b: 1, a: 1 } satisfies Color
}

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function pluginValue(node: SceneNode, key: string) {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function addText(
  graph: SceneGraph,
  parentId: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  fontWeight: 400 | 600 | 700,
  color: Color,
  maxWidth = 680
) {
  return graph.createNode('TEXT', parentId, {
    fills: [solid(color)],
    fontFamily: FONT,
    fontSize,
    fontWeight,
    height: Math.ceil(fontSize * 1.4),
    name: text.slice(0, 64),
    text,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    width: Math.min(maxWidth, Math.max(32, Math.ceil(text.length * fontSize * 0.56))),
    x,
    y
  })
}

function addChip(
  graph: SceneGraph,
  parentId: string,
  label: string,
  x: number,
  y: number,
  width: number,
  background: Color,
  foreground: Color
) {
  const chip = graph.createNode('FRAME', parentId, {
    cornerRadius: 14,
    fills: [solid(background)],
    height: 28,
    name: label,
    width,
    x,
    y
  })
  addText(graph, chip.id, label, 13, 6, 11, 600, foreground, width - 26)
}

function addMiniBoard(
  graph: SceneGraph,
  parentId: string,
  label: string,
  x: number,
  y: number,
  accent: Color
) {
  const board = graph.createNode('FRAME', parentId, {
    cornerRadius: 10,
    fills: [solid(COLOR.white)],
    height: 58,
    name: label,
    strokes: thinStroke(COLOR.line),
    width: 132,
    x,
    y
  })
  graph.createNode('RECTANGLE', board.id, {
    cornerRadius: 2,
    fills: [solid(accent)],
    height: 58,
    name: `${label} accent`,
    width: 4,
    x: 0,
    y: 0
  })
  addText(graph, board.id, label, 15, 12, 12, 700, COLOR.ink, 100)
  addText(graph, board.id, 'Live HTML', 15, 32, 10, 400, COLOR.muted, 100)
}

export function ensureHtmlBoardGuide(
  graph: SceneGraph,
  pageId: string,
  anchor: Vector
) {
  const existing = graph
    .getChildren(pageId)
    .find((node) => pluginValue(node, 'kind') === GUIDE_KIND)
  if (existing) return existing

  const guide = graph.createNode('SECTION', pageId, {
    cornerRadius: 18,
    fills: [solid(COLOR.canvas)],
    height: 174,
    name: 'HTML-first workflow',
    pluginData: [pluginData('kind', GUIDE_KIND), pluginData('guideVersion', '1')],
    strokes: thinStroke(COLOR.line),
    width: 1100,
    x: anchor.x,
    y: anchor.y - 232
  })

  addText(graph, guide.id, 'HTML-first workflow', 24, 20, 22, 700, COLOR.ink, 320)
  addText(
    graph,
    guide.id,
    'The rendered page is the design. Organize decisions around it.',
    24,
    52,
    12,
    400,
    COLOR.muted,
    480
  )
  addChip(graph, guide.id, 'Flow goes right', 24, 90, 132, COLOR.blueSoft, COLOR.blue)
  addChip(graph, guide.id, 'Edits branch down', 166, 90, 146, COLOR.violetSoft, COLOR.violet)
  addChip(graph, guide.id, 'Source stays safe', 322, 90, 144, COLOR.greenSoft, COLOR.green)
  addText(graph, guide.id, 'Review before handoff.', 24, 132, 11, 600, COLOR.green, 240)

  addMiniBoard(graph, guide.id, 'Current', 610, 26, COLOR.green)
  addMiniBoard(graph, guide.id, 'Next state', 818, 26, COLOR.blue)
  addMiniBoard(graph, guide.id, 'Edit draft', 610, 105, COLOR.violet)
  graph.createNode('RECTANGLE', guide.id, {
    cornerRadius: 2,
    fills: [solid(COLOR.blue)],
    height: 3,
    name: 'Flow direction',
    width: 52,
    x: 750,
    y: 54
  })
  graph.createNode('RECTANGLE', guide.id, {
    cornerRadius: 2,
    fills: [solid(COLOR.violet)],
    height: 28,
    name: 'Edit branch direction',
    width: 3,
    x: 674,
    y: 71
  })
  return guide
}
