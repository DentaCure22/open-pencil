import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { MermaidSceneSpec } from '#core/diagram'
import { createTextSceneNode, type TextSceneNodeOptions } from '#core/io/formats/scene'

import type { MarkdownImportOptions, MarkdownInlineLink } from './types'

export const DOCUMENT_WIDTH = 820
export const DOCUMENT_PADDING = 56
export const CONTENT_WIDTH = DOCUMENT_WIDTH - DOCUMENT_PADDING * 2
export const TEXT_COLOR = '#242521'
export const MUTED_COLOR = '#6D6B64'
export const ACCENT_COLOR = '#6954C5'
export const BORDER_COLOR = '#D9D6CE'
export const SURFACE_COLOR = '#FFFFFF'
export const SUBTLE_SURFACE_COLOR = '#F3F1EA'

export interface MarkdownRenderContext {
  graph: SceneGraph
  createMermaidScene?: (source: string) => Promise<MermaidSceneSpec>
  resolveImage?: MarkdownImportOptions['resolveImage']
}

export type TextNodeOptions = TextSceneNodeOptions

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

export { solidStroke } from '#core/io/formats/scene'

export function createTextNode(
  graph: SceneGraph,
  parentId: string,
  text: string,
  options: TextNodeOptions
): SceneNode {
  return createTextSceneNode(graph, parentId, text, options, {
    color: TEXT_COLOR,
    fontSize: 16,
    lineHeightMultiplier: 1.5
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
