import type { Fill, Stroke } from '@open-pencil/scene-graph'

import {
  BLACK,
  DEFAULT_FRAME_FILL,
  DEFAULT_SHAPE_FILL,
  SECTION_DEFAULT_FILL,
  SECTION_DEFAULT_STROKE
} from '#core/constants'
import type { FigmaNodeProxy } from '#core/figma-api'
import { defineTool, nodeSummary } from '#core/tools/schema'

const BLACK_FILL: Fill = {
  type: 'SOLID',
  color: BLACK,
  opacity: 1,
  visible: true
}

const DEFAULT_FILLS: Partial<Record<string, Fill>> = {
  ELLIPSE: DEFAULT_SHAPE_FILL,
  FRAME: DEFAULT_FRAME_FILL,
  LINE: BLACK_FILL,
  POLYGON: DEFAULT_SHAPE_FILL,
  RECTANGLE: DEFAULT_SHAPE_FILL,
  SECTION: SECTION_DEFAULT_FILL,
  STAR: DEFAULT_SHAPE_FILL,
  TEXT: BLACK_FILL
}

const DEFAULT_STROKES: Partial<Record<string, Stroke>> = {
  SECTION: SECTION_DEFAULT_STROKE
}

export const createShape = defineTool({
  name: 'create_shape',
  mutates: true,
  description:
    'Create a shape on the canvas. Use FRAME for containers/cards, RECTANGLE for solid blocks, ELLIPSE for circles, TEXT for labels, SECTION for page sections.',
  params: {
    type: {
      type: 'string',
      description: 'Node type',
      required: true,
      enum: ['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'LINE', 'STAR', 'POLYGON', 'SECTION']
    },
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true },
    width: { type: 'number', description: 'Width in pixels', required: true, min: 1 },
    height: { type: 'number', description: 'Height in pixels', required: true, min: 1 },
    name: { type: 'string', description: 'Node name shown in layers panel' },
    parent_id: { type: 'string', description: 'Parent node ID to nest inside' }
  },
  execute: (figma, args) => {
    const parentId = args.parent_id
    const parent = parentId ? figma.getNodeById(parentId) : null
    const createMap: Record<string, () => FigmaNodeProxy> = {
      FRAME: () => figma.createFrame(),
      RECTANGLE: () => figma.createRectangle(),
      ELLIPSE: () => figma.createEllipse(),
      TEXT: () => figma.createText(),
      LINE: () => figma.createLine(),
      STAR: () => figma.createStar(),
      POLYGON: () => figma.createPolygon(),
      SECTION: () => figma.createSection()
    }
    const node = createMap[args.type]()
    node.x = args.x
    node.y = args.y
    node.resize(args.width, args.height)
    const fill = DEFAULT_FILLS[args.type]
    const stroke = DEFAULT_STROKES[args.type]
    if (fill) node.fills = [structuredClone(fill)]
    if (stroke) node.strokes = [structuredClone(stroke)]
    if (args.name) node.name = args.name
    if (parent) parent.appendChild(node)
    return nodeSummary(node)
  }
})

export const createPage = defineTool({
  name: 'create_page',
  mutates: true,
  description: 'Create a new page.',
  params: {
    name: { type: 'string', description: 'Page name', required: true }
  },
  execute: (figma, { name }) => {
    const page = figma.createPage()
    page.name = name
    return { id: page.id, name }
  }
})

export const createSlice = defineTool({
  name: 'create_slice',
  mutates: true,
  description: 'Create a slice (export region) on the canvas.',
  params: {
    x: { type: 'number', description: 'X position', required: true },
    y: { type: 'number', description: 'Y position', required: true },
    width: { type: 'number', description: 'Width', required: true, min: 1 },
    height: { type: 'number', description: 'Height', required: true, min: 1 },
    name: { type: 'string', description: 'Slice name' },
    parent_id: { type: 'string', description: 'Parent node ID' }
  },
  execute: (figma, args) => {
    const node = figma.createFrame()
    node.x = args.x
    node.y = args.y
    node.resize(args.width, args.height)
    node.name = args.name ?? 'Slice'
    node.fills = []
    if (args.parent_id) {
      const parent = figma.getNodeById(args.parent_id)
      if (parent) parent.appendChild(node)
    }
    return nodeSummary(node)
  }
})
