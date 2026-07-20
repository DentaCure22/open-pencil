import type { CharacterStyleOverride, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { mergeContentSourcePluginData, readContentSource } from '#core/io/content-source'

import type { MarkdownInlineLink, MarkdownSourceMode } from './types'

const PLUGIN_ID = 'open-pencil'
const MARKDOWN_ESCAPE_CHARACTERS = new Set(['\\', '`', '*', '_', '[', ']', '<', '>', '~'])

export interface MarkdownWriteResult {
  source: string
  revision: number
  changed: boolean
  fileName: string | null
  mimeType: string
}

interface InlineStyle {
  code: boolean
  emphasis: boolean
  strike: boolean
  strong: boolean
}

function pluginValue(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value ??
    null
  )
}

function markdownKind(node: SceneNode): string | null {
  return pluginValue(node, 'markdown/block-kind')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readInlineLinks(node: SceneNode): MarkdownInlineLink[] {
  const value = pluginValue(node, 'markdown/inline-links')
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (
        !isRecord(item) ||
        typeof item.start !== 'number' ||
        typeof item.length !== 'number' ||
        !Number.isSafeInteger(item.start) ||
        !Number.isSafeInteger(item.length) ||
        typeof item.href !== 'string'
      ) {
        return []
      }
      const start = Number(item.start)
      const length = Number(item.length)
      if (start < 0 || length < 1 || start + length > node.text.length) return []
      return [
        {
          start,
          length,
          href: item.href,
          ...(typeof item.title === 'string' ? { title: item.title } : {})
        }
      ]
    })
  } catch {
    return []
  }
}

function styleAt(node: SceneNode, index: number): CharacterStyleOverride {
  return (
    node.styleRuns.find((run) => index >= run.start && index < run.start + run.length)?.style ?? {}
  )
}

function inlineStyle(style: CharacterStyleOverride): InlineStyle {
  return {
    code: style.fontFamily?.toLowerCase().includes('mono') === true,
    emphasis: style.italic === true,
    strike: style.textDecoration === 'STRIKETHROUGH',
    strong: (style.fontWeight ?? 400) >= 600
  }
}

function styleKey(style: InlineStyle): string {
  return `${Number(style.code)}${Number(style.emphasis)}${Number(style.strike)}${Number(style.strong)}`
}

function escapeMarkdownText(value: string): string {
  let result = ''
  for (const character of value) {
    result += MARKDOWN_ESCAPE_CHARACTERS.has(character) ? `\\${character}` : character
  }
  return result
}

function wrapCode(value: string): string {
  const fence = value.includes('`') ? '``' : '`'
  return `${fence}${value}${fence}`
}

function applyInlineStyle(value: string, style: InlineStyle): string {
  if (style.code) return wrapCode(value)
  let result = escapeMarkdownText(value)
  if (style.strike) result = `~~${result}~~`
  if (style.emphasis) result = `*${result}*`
  if (style.strong) result = `**${result}**`
  return result
}

function serializeStyledRange(node: SceneNode, start: number, end: number): string {
  let result = ''
  let index = start
  while (index < end) {
    const style = inlineStyle(styleAt(node, index))
    const key = styleKey(style)
    let next = index + 1
    while (next < end && styleKey(inlineStyle(styleAt(node, next))) === key) next++
    result += applyInlineStyle(node.text.slice(index, next), style)
    index = next
  }
  return result
}

function linkDestination(link: MarkdownInlineLink): string {
  const href = link.href.replace(/([\\)])/g, '\\$1')
  const title = link.title ? ` "${link.title.replace(/([\\"])/g, '\\$1')}"` : ''
  return `${href}${title}`
}

function serializeInline(node: SceneNode, plainText: boolean): string {
  if (plainText) return node.text
  const links = readInlineLinks(node).toSorted((left, right) => left.start - right.start)
  let result = ''
  let offset = 0
  for (const link of links) {
    if (link.start < offset) continue
    result += serializeStyledRange(node, offset, link.start)
    const end = link.start + link.length
    result += `[${serializeStyledRange(node, link.start, end)}](${linkDestination(link)})`
    offset = end
  }
  return result + serializeStyledRange(node, offset, node.text.length)
}

function textDescendant(graph: SceneGraph, node: SceneNode, name?: string): SceneNode | null {
  for (const child of graph.getChildren(node.id)) {
    if (child.type === 'TEXT' && (!name || child.name === name)) return child
    const nested = textDescendant(graph, child, name)
    if (nested) return nested
  }
  return null
}

function codeFence(source: string): string {
  return source.includes('```') ? '````' : '```'
}

function serializeCode(graph: SceneGraph, node: SceneNode, language: string): string {
  const source = textDescendant(graph, node, `${language} source`)?.text ?? ''
  const fence = codeFence(source)
  return `${fence}${language === 'plain text' ? '' : language}\n${source}\n${fence}`
}

function serializeMermaid(graph: SceneGraph, node: SceneNode): string {
  const source = pluginValue(node, 'mermaid/source')
  if (source !== null) return `\`\`\`mermaid\n${source}\n\`\`\``
  return serializeCode(graph, node, 'mermaid')
}

function tableCellText(graph: SceneGraph, cell: SceneNode, plainText: boolean): string {
  const text = graph.getChildren(cell.id).find((child) => child.type === 'TEXT')
  return text ? serializeInline(text, plainText).replace(/\|/g, '\\|').replace(/\n/g, '<br>') : ''
}

function serializeTable(graph: SceneGraph, node: SceneNode, plainText: boolean): string {
  const rows = graph.getChildren(node.id)
  const header = rows[0]
  const headerCells = graph.getChildren(header.id)
  const result = [
    `| ${headerCells.map((cell) => tableCellText(graph, cell, plainText)).join(' | ')} |`,
    `| ${headerCells.map(() => '---').join(' | ')} |`
  ]
  for (const row of rows.slice(1)) {
    result.push(
      `| ${graph
        .getChildren(row.id)
        .map((cell) => tableCellText(graph, cell, plainText))
        .join(' | ')} |`
    )
  }
  return result.join('\n')
}

function listItemRow(graph: SceneGraph, item: SceneNode): SceneNode | null {
  return (
    graph
      .getChildren(item.id)
      .find((child) => ['list-item', 'task-item'].includes(markdownKind(child) ?? '')) ?? null
  )
}

function serializeList(graph: SceneGraph, node: SceneNode, plainText: boolean, depth = 0): string {
  const ordered = markdownKind(node) === 'ordered-list'
  const lines: string[] = []
  for (const [index, item] of graph.getChildren(node.id).entries()) {
    const row = listItemRow(graph, item)
    if (!row) continue
    const textNode = graph
      .getChildren(row.id)
      .find((child) => child.type === 'TEXT' && child.name !== 'List marker')
    const task = markdownKind(row) === 'task-item'
    const checked = graph.getChildren(row.id).some((child) => child.name === 'Completed task')
    let marker = ordered ? `${index + 1}.` : '-'
    if (task) marker = `- [${checked ? 'x' : ' '}]`
    const text = textNode ? serializeInline(textNode, plainText) : ''
    lines.push(`${'  '.repeat(depth)}${marker} ${text}`.trimEnd())
    for (const child of graph.getChildren(item.id)) {
      const nested = graph
        .getChildren(child.id)
        .find((candidate) => ['list', 'ordered-list'].includes(markdownKind(candidate) ?? ''))
      if (nested) lines.push(serializeList(graph, nested, plainText, depth + 1))
    }
  }
  return lines.join('\n')
}

function serializeBlockquote(graph: SceneGraph, node: SceneNode, plainText: boolean): string {
  const body = graph.getChildren(node.id).find((child) => child.name === 'Quote content')
  if (!body) return '>'
  return serializeChildren(graph, body, plainText)
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n')
}

function serializeImage(graph: SceneGraph, node: SceneNode): string {
  const href = pluginValue(node, 'markdown/href') ?? ''
  const title = pluginValue(node, 'markdown/title')
  const description = textDescendant(graph, node, 'Image description')?.text ?? node.name
  const titleSource = title ? ` "${title.replace(/([\\"])/g, '\\$1')}"` : ''
  return `![${description.replace(/([\\\]])/g, '\\$1')}](${href.replace(/([\\)])/g, '\\$1')}${titleSource})`
}

function serializeNode(graph: SceneGraph, node: SceneNode, plainText: boolean): string {
  const kind = markdownKind(node)
  if (kind?.startsWith('heading-')) {
    const depth = Number.parseInt(kind.slice('heading-'.length), 10)
    return `${'#'.repeat(Math.min(6, Math.max(1, depth)))} ${serializeInline(node, plainText)}`
  }
  switch (kind) {
    case 'paragraph':
      return serializeInline(node, plainText)
    case 'list':
    case 'ordered-list':
      return serializeList(graph, node, plainText)
    case 'blockquote':
      return serializeBlockquote(graph, node, plainText)
    case 'table':
      return serializeTable(graph, node, plainText)
    case 'divider':
      return '---'
    case 'image':
      return serializeImage(graph, node)
    case 'code':
      return serializeCode(graph, node, pluginValue(node, 'markdown/language') ?? 'plain text')
    case 'mermaid':
      return serializeMermaid(graph, node)
    case 'empty':
      return ''
    case 'preserved':
      return pluginValue(node, 'markdown/raw') ?? (node.type === 'TEXT' ? node.text : '')
    default:
      if (node.type === 'TEXT') return serializeInline(node, plainText)
      return serializeChildren(graph, node, plainText)
  }
}

function serializeChildren(graph: SceneGraph, parent: SceneNode, plainText: boolean): string {
  return graph
    .getChildren(parent.id)
    .map((child) => serializeNode(graph, child, plainText))
    .filter((source, index, all) => source || all.length === 1 || index < all.length - 1)
    .join('\n\n')
}

function sourceMode(node: SceneNode): MarkdownSourceMode {
  const value = pluginValue(node, 'markdown/source-mode')
  return value === 'plain-text' || value === 'mdx' ? value : 'markdown'
}

function markdownDocumentFrame(graph: SceneGraph): SceneNode {
  const sourceFrame = [...graph.getAllNodes()].find(
    (node) => readContentSource(node)?.format === 'markdown'
  )
  if (!sourceFrame) {
    throw new Error('Scene graph does not contain a source-backed Markdown document')
  }
  return sourceFrame
}

export function markdownFromSceneGraph(graph: SceneGraph): string {
  const sourceFrame = markdownDocumentFrame(graph)
  const source = serializeChildren(graph, sourceFrame, sourceMode(sourceFrame) === 'plain-text')
  return source ? `${source.replace(/\n+$/g, '')}\n` : ''
}

export function writeMarkdownDocument(graph: SceneGraph): MarkdownWriteResult {
  const sourceFrame = markdownDocumentFrame(graph)
  const metadata = readContentSource(sourceFrame)
  if (!metadata) throw new Error('Markdown document source metadata is missing')

  const source = markdownFromSceneGraph(graph)
  const changed = source !== metadata.source
  const revision = changed ? metadata.revision + 1 : metadata.revision
  if (changed) {
    graph.updateNode(sourceFrame.id, {
      pluginData: mergeContentSourcePluginData(sourceFrame.pluginData, {
        ...metadata,
        revision,
        source
      })
    })
  }
  return {
    source,
    revision,
    changed,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType
  }
}
