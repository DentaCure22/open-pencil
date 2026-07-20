import type {
  PluginDataEntry,
  SceneGraph,
  SceneNode,
  Stroke,
  StyleRun
} from '@open-pencil/scene-graph'

import { colorToFill, parseColor } from '#core/color'
import type { MermaidSceneSpec } from '#core/diagram'

import type { MarkdownImportOptions, MarkdownInlineLink } from './types'

export const DOCUMENT_WIDTH = 820
export const DOCUMENT_PADDING = 56
export const CONTENT_WIDTH = DOCUMENT_WIDTH - DOCUMENT_PADDING * 2
export const TEXT_COLOR = '#242521'
export const MUTED_COLOR = '#6D6B64'
export const ACCENT_COLOR = '#6954C5'
export const BORDER_COLOR = '#D9D6CE'
export const SURFACE_COLOR = '#FCFBF7'
export const SUBTLE_SURFACE_COLOR = '#F3F1EA'

export interface MarkdownRenderContext {
  graph: SceneGraph
  createMermaidScene?: (source: string) => Promise<MermaidSceneSpec>
  resolveImage?: MarkdownImportOptions['resolveImage']
}

export interface TextNodeOptions {
  name: string
  width: number
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  color?: string
  textAlignHorizontal?: SceneNode['textAlignHorizontal']
  pluginData?: PluginDataEntry[]
  styleRuns?: StyleRun[]
  layoutGrow?: number
  layoutAlignSelf?: SceneNode['layoutAlignSelf']
}

interface MarkdownMetadataFields {
  language?: string
  href?: string
  title?: string
  error?: string
  mimeType?: string
}

export function markdownInlinePluginData(links: MarkdownInlineLink[]): PluginDataEntry[] {
  if (links.length === 0) return []
  return [
    {
      pluginId: 'open-pencil',
      key: 'markdown/inline-links',
      value: JSON.stringify(links)
    }
  ]
}

export function markdownData(
  kind: string,
  raw: string,
  fields: MarkdownMetadataFields = {}
): PluginDataEntry[] {
  const entries: PluginDataEntry[] = [
    { pluginId: 'open-pencil', key: 'markdown/block-kind', value: kind },
    { pluginId: 'open-pencil', key: 'markdown/raw', value: raw }
  ]
  for (const [key, value] of Object.entries(fields)) {
    if (value) entries.push({ pluginId: 'open-pencil', key: `markdown/${key}`, value })
  }
  return entries
}

export function solidStroke(color: string, weight = 1): Stroke {
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

function estimatedTextHeight(
  text: string,
  fontSize: number,
  width: number,
  lineHeight: number
): number {
  const averageCharacterWidth = fontSize * 0.56
  const charactersPerLine = Math.max(1, Math.floor(width / averageCharacterWidth))
  const lineCount = text
    .split('\n')
    .reduce((count, line) => count + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0)
  return Math.max(lineHeight, Math.ceil(lineCount * lineHeight))
}

export function createTextNode(
  graph: SceneGraph,
  parentId: string,
  text: string,
  options: TextNodeOptions
): SceneNode {
  const fontSize = options.fontSize ?? 16
  const lineHeight = options.lineHeight ?? fontSize * 1.5
  return graph.createNode('TEXT', parentId, {
    name: options.name,
    width: options.width,
    height: estimatedTextHeight(text, fontSize, options.width, lineHeight),
    text,
    fontSize,
    fontWeight: options.fontWeight ?? 400,
    lineHeight,
    textAutoResize: 'HEIGHT',
    textAlignHorizontal: options.textAlignHorizontal ?? 'LEFT',
    fills: [colorToFill(options.color ?? TEXT_COLOR)],
    pluginData: options.pluginData ?? [],
    styleRuns: options.styleRuns ?? [],
    layoutGrow: options.layoutGrow ?? 0,
    layoutAlignSelf: options.layoutAlignSelf ?? 'STRETCH'
  })
}

export function createVerticalFrame(
  graph: SceneGraph,
  parentId: string,
  name: string,
  width: number,
  overrides: Partial<SceneNode> = {}
): SceneNode {
  return graph.createNode('FRAME', parentId, {
    name,
    width,
    height: 1,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FIXED',
    counterAxisAlign: 'STRETCH',
    fills: [],
    layoutAlignSelf: 'STRETCH',
    ...overrides
  })
}
