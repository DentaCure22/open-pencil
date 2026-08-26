import type { TokensList } from 'marked'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { colorToFill } from '#core/color'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '#core/io/content-source'
import { computeAllLayouts } from '#core/layout'

import { renderMarkdownTokens } from './render-content'
import {
  BORDER_COLOR,
  CONTENT_WIDTH,
  createTextNode,
  createVerticalFrame,
  DOCUMENT_PADDING,
  DOCUMENT_WIDTH,
  markdownData,
  type MarkdownRenderContext,
  MUTED_COLOR,
  solidStroke,
  SURFACE_COLOR
} from './scene'
import type { MarkdownImportOptions } from './types'

function documentName(fileName: string | undefined): string {
  const base = fileName?.replace(/\.(?:md|markdown|mdx|txt)$/i, '').trim()
  return base || 'Markdown document'
}

export async function renderMarkdownDocument(
  graph: SceneGraph,
  tokens: TokensList | null,
  source: string,
  options: MarkdownImportOptions
): Promise<void> {
  const page = graph.getPages()[0]

  const name = documentName(options.fileName)
  graph.updateNode(page.id, { name })
  const pluginData = [
    ...contentSourcePluginData({
      format: 'markdown',
      mimeType: options.mimeType || 'text/markdown',
      fileName: options.fileName ?? null,
      revision: CONTENT_SOURCE_REVISION,
      source
    }),
    {
      pluginId: 'open-pencil',
      key: 'markdown/source-mode',
      value: options.sourceMode ?? 'markdown'
    }
  ]

  if (options.representation !== 'native') {
    graph.createNode('FRAME', page.id, {
      name,
      x: 0,
      y: 0,
      width: DOCUMENT_WIDTH,
      height: 720,
      clipsContent: true,
      layoutMode: 'NONE',
      fills: [colorToFill(SURFACE_COLOR)],
      strokes: [solidStroke(BORDER_COLOR)],
      cornerRadius: 12,
      pluginData
    })
    return
  }

  const documentFrame = createVerticalFrame(graph, page.id, name, DOCUMENT_WIDTH, {
    x: 0,
    y: 0,
    itemSpacing: 20,
    paddingTop: DOCUMENT_PADDING,
    paddingRight: DOCUMENT_PADDING,
    paddingBottom: DOCUMENT_PADDING,
    paddingLeft: DOCUMENT_PADDING,
    fills: [colorToFill(SURFACE_COLOR)],
    strokes: [solidStroke(BORDER_COLOR)],
    cornerRadius: 12,
    pluginData
  })
  const context: MarkdownRenderContext = {
    graph,
    createMermaidScene: options.createMermaidScene,
    resolveImage: options.resolveImage
  }
  await renderMarkdownTokens(context, documentFrame.id, tokens ?? [], CONTENT_WIDTH)

  if (documentFrame.childIds.length === 0) {
    createTextNode(graph, documentFrame.id, 'Empty Markdown document', {
      name: 'Empty document',
      width: CONTENT_WIDTH,
      fontSize: 16,
      lineHeight: 24,
      color: MUTED_COLOR,
      pluginData: markdownData('empty', '')
    })
  }

  computeAllLayouts(graph, documentFrame.id)
}
