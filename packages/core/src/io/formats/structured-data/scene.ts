import type { PluginDataEntry, SceneGraph, SceneNode, Stroke } from '@open-pencil/scene-graph'

import { colorToFill, parseColor } from '#core/color'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '#core/io/content-source'

import { structuredDataPluginData } from './metadata'

const DOCUMENT_WIDTH = 1040
const DOCUMENT_PADDING = 32
const CONTENT_WIDTH = DOCUMENT_WIDTH - DOCUMENT_PADDING * 2
const ROW_HEIGHT = 36

const TEXT_COLOR = '#252521'
const MUTED_COLOR = '#6D6B64'
const ACCENT_COLOR = '#6954C5'
const BORDER_COLOR = '#D9D6CE'
const SURFACE_COLOR = '#FCFBF7'
const SUBTLE_SURFACE_COLOR = '#F3F1EA'

export interface DataDocumentSurfaceOptions {
  name: string
  format: 'json' | 'json-schema' | 'csv'
  mimeType: string
  fileName: string | null
  source: string
  summary: string
}

export interface DataDocumentSurface {
  root: SceneNode
  content: SceneNode
}

export interface DataTextOptions {
  name: string
  width: number
  fontSize?: number
  fontWeight?: number
  color?: string
  pluginData?: PluginDataEntry[]
  layoutGrow?: number
}

export interface DataRowOptions {
  name: string
  width: number
  pluginData: PluginDataEntry[]
  muted?: boolean
}

function solidStroke(color: string, weight = 1): Stroke {
  const parsed = parseColor(color)
  return {
    color: parsed,
    weight,
    opacity: parsed.a,
    visible: parsed.a > 0,
    align: 'INSIDE',
    cap: 'NONE',
    join: 'MITER',
    dashPattern: []
  }
}

function estimatedTextHeight(text: string, fontSize: number, width: number): number {
  const lineHeight = fontSize * 1.4
  const charactersPerLine = Math.max(1, Math.floor(width / (fontSize * 0.56)))
  const lineCount = text
    .split('\n')
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0)
  return Math.max(lineHeight, Math.ceil(lineCount * lineHeight))
}

export function createDataText(
  graph: SceneGraph,
  parentId: string,
  text: string,
  options: DataTextOptions
): SceneNode {
  const fontSize = options.fontSize ?? 14
  return graph.createNode('TEXT', parentId, {
    name: options.name,
    width: options.width,
    height: estimatedTextHeight(text, fontSize, options.width),
    text,
    fontSize,
    fontWeight: options.fontWeight ?? 400,
    lineHeight: fontSize * 1.4,
    textAutoResize: 'HEIGHT',
    fills: [colorToFill(options.color ?? TEXT_COLOR)],
    pluginData: options.pluginData ?? [],
    layoutGrow: options.layoutGrow ?? 0,
    layoutAlignSelf: 'STRETCH'
  })
}

export function createDataRow(
  graph: SceneGraph,
  parentId: string,
  options: DataRowOptions
): SceneNode {
  return graph.createNode('FRAME', parentId, {
    name: options.name,
    width: options.width,
    height: ROW_HEIGHT,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'CENTER',
    itemSpacing: 12,
    paddingTop: 8,
    paddingRight: 12,
    paddingBottom: 8,
    paddingLeft: 12,
    fills: [colorToFill(options.muted ? SUBTLE_SURFACE_COLOR : SURFACE_COLOR)],
    strokes: [solidStroke(BORDER_COLOR)],
    pluginData: options.pluginData,
    layoutAlignSelf: 'STRETCH'
  })
}

export function createDataDocumentSurface(
  graph: SceneGraph,
  options: DataDocumentSurfaceOptions
): DataDocumentSurface {
  const page = graph.getPages()[0]
  graph.updateNode(page.id, { name: options.name })

  const root = graph.createNode('FRAME', page.id, {
    name: options.name,
    x: 0,
    y: 0,
    width: DOCUMENT_WIDTH,
    height: 1,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'MIN',
    itemSpacing: 20,
    paddingTop: DOCUMENT_PADDING,
    paddingRight: DOCUMENT_PADDING,
    paddingBottom: DOCUMENT_PADDING,
    paddingLeft: DOCUMENT_PADDING,
    fills: [colorToFill(SURFACE_COLOR)],
    strokes: [solidStroke(BORDER_COLOR)],
    cornerRadius: 12,
    pluginData: [
      ...contentSourcePluginData({
        format: options.format,
        mimeType: options.mimeType,
        fileName: options.fileName,
        revision: CONTENT_SOURCE_REVISION,
        source: options.source
      }),
      ...structuredDataPluginData({ kind: 'document', path: '' })
    ]
  })

  const heading = graph.createNode('FRAME', root.id, {
    name: 'Document heading',
    width: CONTENT_WIDTH,
    height: 1,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'MIN',
    itemSpacing: 4,
    fills: [],
    layoutAlignSelf: 'STRETCH'
  })
  createDataText(graph, heading.id, options.name, {
    name: 'Document title',
    width: CONTENT_WIDTH,
    fontSize: 24,
    fontWeight: 650
  })
  createDataText(graph, heading.id, options.summary, {
    name: 'Document summary',
    width: CONTENT_WIDTH,
    fontSize: 13,
    color: MUTED_COLOR
  })

  const content = graph.createNode('FRAME', root.id, {
    name: 'Structured data',
    width: CONTENT_WIDTH,
    height: 1,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'MIN',
    itemSpacing: 0,
    fills: [],
    layoutAlignSelf: 'STRETCH'
  })

  return { root, content }
}

export function createTruncationRow(
  graph: SceneGraph,
  parentId: string,
  message: string,
  width = CONTENT_WIDTH
): SceneNode {
  const row = createDataRow(graph, parentId, {
    name: 'Truncated data',
    width,
    muted: true,
    pluginData: structuredDataPluginData({ kind: 'truncation' })
  })
  createDataText(graph, row.id, message, {
    name: 'Truncation notice',
    width: width - 24,
    fontSize: 13,
    color: ACCENT_COLOR
  })
  return row
}

export { ACCENT_COLOR, CONTENT_WIDTH, MUTED_COLOR, ROW_HEIGHT, TEXT_COLOR }
