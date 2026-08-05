import type { Token, Tokens, TokensList } from 'marked'

import { generateId, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { colorToFill } from '#core/color'
import { mermaidDiagramOwnerPluginData, type MermaidSceneSpec } from '#core/diagram'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '#core/io/content-source'
import { computeAllLayouts } from '#core/layout'

import { markdownInlineTextProps } from './inline'
import { listItemInlineContent, markdownInlineContent, paragraphImage } from './parse'
import { renderMarkdownImage } from './render-image'
import {
  ACCENT_COLOR,
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
  SUBTLE_SURFACE_COLOR,
  SURFACE_COLOR,
  TEXT_COLOR,
  type TextNodeOptions
} from './scene'
import type { MarkdownImportOptions } from './types'

function headingStyle(
  depth: number
): Pick<TextNodeOptions, 'fontSize' | 'fontWeight' | 'lineHeight'> {
  switch (depth) {
    case 1:
      return { fontSize: 38, fontWeight: 700, lineHeight: 44 }
    case 2:
      return { fontSize: 28, fontWeight: 650, lineHeight: 35 }
    case 3:
      return { fontSize: 22, fontWeight: 650, lineHeight: 29 }
    default:
      return { fontSize: 17, fontWeight: 650, lineHeight: 25 }
  }
}

function renderHeading(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.Heading,
  width: number
): void {
  const content = markdownInlineContent(token.tokens)
  const text = content.text
  createTextNode(context.graph, parentId, text, {
    name: text.slice(0, 80) || `Heading ${token.depth}`,
    width,
    ...headingStyle(token.depth),
    ...markdownInlineTextProps(content, markdownData(`heading-${token.depth}`, token.raw))
  })
}

async function renderParagraph(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.Paragraph,
  width: number
): Promise<void> {
  const image = paragraphImage(token)
  if (image) {
    await renderMarkdownImage(context, parentId, image, token.raw, width)
    return
  }

  const content = markdownInlineContent(token.tokens)
  const text = content.text
  createTextNode(context.graph, parentId, text, {
    name: text.split('\n')[0]?.slice(0, 80) || 'Paragraph',
    width,
    fontSize: 16,
    lineHeight: 25,
    color: TEXT_COLOR,
    ...markdownInlineTextProps(content, markdownData('paragraph', token.raw))
  })
}

function createTaskMarker(
  graph: SceneGraph,
  parentId: string,
  checked: boolean,
  raw: string
): void {
  graph.createNode('RECTANGLE', parentId, {
    name: checked ? 'Completed task' : 'Open task',
    width: 16,
    height: 16,
    cornerRadius: 4,
    fills: checked ? [colorToFill(ACCENT_COLOR)] : [colorToFill(SURFACE_COLOR)],
    strokes: [solidStroke(checked ? ACCENT_COLOR : '#A8A49B')],
    pluginData: markdownData('task-marker', raw)
  })
}

async function renderList(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.List,
  width: number
): Promise<void> {
  const list = createVerticalFrame(
    context.graph,
    parentId,
    token.ordered ? 'Numbered list' : 'List',
    width,
    {
      itemSpacing: 10,
      pluginData: markdownData(token.ordered ? 'ordered-list' : 'list', token.raw)
    }
  )
  const start = typeof token.start === 'number' ? token.start : 1

  for (const [index, item] of token.items.entries()) {
    const itemFrame = createVerticalFrame(context.graph, list.id, `List item ${index + 1}`, width, {
      itemSpacing: 8
    })
    const row = context.graph.createNode('FRAME', itemFrame.id, {
      name: `List item ${index + 1}`,
      width,
      height: 20,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'HUG',
      counterAxisAlign: 'MIN',
      itemSpacing: 10,
      fills: [],
      layoutAlignSelf: 'STRETCH',
      pluginData: markdownData(item.task ? 'task-item' : 'list-item', item.raw)
    })

    if (item.task) {
      createTaskMarker(context.graph, row.id, item.checked === true, item.raw)
    } else {
      createTextNode(context.graph, row.id, token.ordered ? `${start + index}.` : '•', {
        name: 'List marker',
        width: 20,
        fontSize: 15,
        lineHeight: 22,
        color: MUTED_COLOR,
        layoutAlignSelf: 'AUTO'
      })
    }

    const content = listItemInlineContent(item)
    const text = content.text
    createTextNode(context.graph, row.id, text, {
      name: text.split('\n')[0]?.slice(0, 80) || 'List item',
      width: width - 30,
      fontSize: 16,
      lineHeight: 24,
      ...markdownInlineTextProps(content),
      layoutGrow: 1,
      layoutAlignSelf: 'AUTO'
    })

    for (const nested of item.tokens) {
      if (nested.type !== 'list') continue
      const nestedList = nested as Tokens.List
      const nestedFrame = createVerticalFrame(
        context.graph,
        itemFrame.id,
        'Nested list',
        width - 30,
        {
          paddingLeft: 26,
          layoutAlignSelf: 'STRETCH'
        }
      )
      await renderList(context, nestedFrame.id, nestedList, width - 56)
    }
  }
}

async function renderBlockquote(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.Blockquote,
  width: number
): Promise<void> {
  const quote = context.graph.createNode('FRAME', parentId, {
    name: 'Quote',
    width,
    height: 1,
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'HUG',
    counterAxisAlign: 'STRETCH',
    itemSpacing: 18,
    paddingTop: 8,
    paddingBottom: 8,
    fills: [],
    layoutAlignSelf: 'STRETCH',
    pluginData: markdownData('blockquote', token.raw)
  })
  context.graph.createNode('RECTANGLE', quote.id, {
    name: 'Quote accent',
    width: 3,
    height: 32,
    cornerRadius: 2,
    fills: [colorToFill(ACCENT_COLOR)],
    layoutAlignSelf: 'STRETCH'
  })
  const body = createVerticalFrame(context.graph, quote.id, 'Quote content', width - 21, {
    itemSpacing: 10,
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'FILL',
    layoutGrow: 1,
    layoutAlignSelf: 'STRETCH'
  })
  await renderTokens(context, body.id, token.tokens, width - 21)
}

function renderCode(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.Code,
  width: number,
  error?: string
): void {
  const language = token.lang?.trim() || 'plain text'
  const frame = createVerticalFrame(context.graph, parentId, `${language} code`, width, {
    itemSpacing: 10,
    paddingTop: 16,
    paddingRight: 18,
    paddingBottom: 18,
    paddingLeft: 18,
    fills: [colorToFill('#292A27')],
    cornerRadius: 10,
    pluginData: markdownData('code', token.raw, {
      language,
      error
    })
  })
  createTextNode(context.graph, frame.id, language.toUpperCase(), {
    name: 'Code language',
    width: width - 36,
    fontSize: 10,
    fontWeight: 650,
    lineHeight: 14,
    color: '#A9A69E'
  })
  createTextNode(context.graph, frame.id, token.text, {
    name: `${language} source`,
    width: width - 36,
    fontSize: 13,
    lineHeight: 20,
    color: '#F4F2EC'
  })
}

function renderMermaid(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.Code,
  diagram: MermaidSceneSpec,
  width: number
): void {
  const diagramId = generateId()
  const metadata = mermaidDiagramOwnerPluginData(diagramId, diagram)
  context.graph.createNode('FRAME', parentId, {
    name: 'Mermaid diagram',
    width,
    height: Math.max(120, diagram.height + 32),
    clipsContent: false,
    fills: [colorToFill(SURFACE_COLOR)],
    strokes: [solidStroke(BORDER_COLOR)],
    cornerRadius: 10,
    layoutAlignSelf: 'STRETCH',
    pluginData: [...markdownData('mermaid', token.raw, { language: 'mermaid' }), ...metadata]
  })
}

async function renderCodeOrMermaid(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.Code,
  width: number
): Promise<void> {
  if (token.lang?.trim().toLowerCase() !== 'mermaid' || !context.createMermaidScene) {
    renderCode(context, parentId, token, width)
    return
  }

  try {
    renderMermaid(context, parentId, token, await context.createMermaidScene(token.text), width)
  } catch (error) {
    renderCode(
      context,
      parentId,
      token,
      width,
      error instanceof Error ? error.message : 'Mermaid conversion failed'
    )
  }
}

function renderTableCell(
  context: MarkdownRenderContext,
  parentId: string,
  cell: Tokens.TableCell,
  width: number,
  header: boolean
): void {
  const frame = createVerticalFrame(
    context.graph,
    parentId,
    header ? 'Header cell' : 'Table cell',
    width,
    {
      paddingTop: 10,
      paddingRight: 12,
      paddingBottom: 10,
      paddingLeft: 12,
      fills: [colorToFill(header ? SUBTLE_SURFACE_COLOR : SURFACE_COLOR)],
      strokes: [solidStroke(BORDER_COLOR)],
      layoutAlignSelf: 'STRETCH'
    }
  )
  const content = markdownInlineContent(cell.tokens)
  const text = content.text
  createTextNode(context.graph, frame.id, text, {
    name: text.slice(0, 80) || (header ? 'Header' : 'Cell'),
    width: width - 24,
    fontSize: 14,
    fontWeight: header ? 650 : 400,
    lineHeight: 20,
    ...markdownInlineTextProps(content),
    textAlignHorizontal: cell.align?.toUpperCase() as SceneNode['textAlignHorizontal'] | undefined
  })
}

function renderTable(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.Table,
  width: number
): void {
  const table = createVerticalFrame(context.graph, parentId, 'Table', width, {
    itemSpacing: 0,
    cornerRadius: 8,
    clipsContent: true,
    pluginData: markdownData('table', token.raw)
  })
  const columnCount = Math.max(1, token.header.length)
  const cellWidth = width / columnCount
  const rows = [token.header, ...token.rows]
  for (const [rowIndex, cells] of rows.entries()) {
    const row = context.graph.createNode('FRAME', table.id, {
      name: rowIndex === 0 ? 'Table header' : `Table row ${rowIndex}`,
      width,
      height: 1,
      layoutMode: 'HORIZONTAL',
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'HUG',
      counterAxisAlign: 'STRETCH',
      itemSpacing: 0,
      fills: [],
      layoutAlignSelf: 'STRETCH'
    })
    for (const cell of cells) renderTableCell(context, row.id, cell, cellWidth, rowIndex === 0)
  }
}

function renderDivider(
  context: MarkdownRenderContext,
  parentId: string,
  raw: string,
  width: number
): void {
  context.graph.createNode('RECTANGLE', parentId, {
    name: 'Divider',
    width,
    height: 1,
    fills: [colorToFill(BORDER_COLOR)],
    layoutAlignSelf: 'STRETCH',
    pluginData: markdownData('divider', raw)
  })
}

function renderHTML(
  context: MarkdownRenderContext,
  parentId: string,
  token: Tokens.HTML,
  width: number
): void {
  const code: Tokens.Code = {
    type: 'code',
    raw: token.raw,
    lang: 'html',
    text: token.text
  }
  renderCode(context, parentId, code, width)
}

async function renderToken(
  context: MarkdownRenderContext,
  parentId: string,
  token: Token,
  width: number
): Promise<void> {
  switch (token.type) {
    case 'blockquote':
      await renderBlockquote(context, parentId, token as Tokens.Blockquote, width)
      return
    case 'code':
      await renderCodeOrMermaid(context, parentId, token as Tokens.Code, width)
      return
    case 'heading':
      renderHeading(context, parentId, token as Tokens.Heading, width)
      return
    case 'hr':
      renderDivider(context, parentId, token.raw, width)
      return
    case 'html':
      renderHTML(context, parentId, token as Tokens.HTML, width)
      return
    case 'list':
      await renderList(context, parentId, token as Tokens.List, width)
      return
    case 'paragraph':
      await renderParagraph(context, parentId, token as Tokens.Paragraph, width)
      return
    case 'table':
      renderTable(context, parentId, token as Tokens.Table, width)
      return
    case 'space':
    case 'def':
      return
    default:
      if (token.raw.trim()) {
        createTextNode(context.graph, parentId, token.raw.trim(), {
          name: 'Markdown content',
          width,
          pluginData: markdownData('preserved', token.raw)
        })
      }
  }
}

async function renderTokens(
  context: MarkdownRenderContext,
  parentId: string,
  tokens: Token[],
  width: number
): Promise<void> {
  for (const token of tokens) await renderToken(context, parentId, token, width)
}

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
  await renderTokens(context, documentFrame.id, tokens ?? [], CONTENT_WIDTH)

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
