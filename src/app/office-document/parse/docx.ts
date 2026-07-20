import type { OfficeArchive } from '../archive'
import type { DocxPreview, OfficeTextBlock, OfficeTextBlockKind } from '../types'
import { asRecord, packageOrderedXml, type OrderedXmlNode, visitXmlEntries } from '../xml'

const MAX_BLOCKS = 240

function orderedElements(value: unknown, key: string, limit = 1_000): unknown[][] {
  const result: unknown[][] = []
  visitXmlEntries(value, (name, item) => {
    if (name === key && Array.isArray(item)) result.push(item)
    return result.length < limit
  })
  return result
}

function orderedAttribute(value: unknown[], elementName: string, attributeName: string): string {
  let result = ''
  const visit = (candidate: unknown) => {
    if (result) return
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    const record = asRecord(candidate)
    if (!record) return
    if (elementName in record) {
      const attributes = asRecord(record[':@'])
      const value = attributes?.[attributeName]
      if (typeof value === 'string') result = value
      return
    }
    for (const [name, item] of Object.entries(record)) {
      if (name !== ':@' && name !== '#text') visit(item)
    }
  }
  visit(value)
  return result
}

function hasOrderedElement(value: unknown[], elementName: string): boolean {
  return orderedElements(value, elementName, 1).length > 0
}

function paragraphText(value: unknown): string {
  const parts: string[] = []
  const visit = (candidate: unknown, currentKey = '') => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, currentKey)
      return
    }
    const record = asRecord(candidate)
    if (!record) return
    if (currentKey === 't' && typeof record['#text'] === 'string') {
      parts.push(record['#text'])
      return
    }
    for (const [name, item] of Object.entries(record)) {
      if (name === 'tab') parts.push('\t')
      else if (name === 'br' || name === 'cr') parts.push('\n')
      else if (name !== ':@') visit(item, name)
    }
  }
  visit(value)
  return parts.join('').replaceAll('\u000b', '\n').trim()
}

function blockKind(paragraph: unknown[]): OfficeTextBlockKind {
  const style = orderedAttribute(paragraph, 'pStyle', 'val').toLowerCase()
  if (style === 'title' || style === 'subtitle') return 'title'
  if (style.startsWith('heading')) return 'heading'
  return hasOrderedElement(paragraph, 'numPr') ? 'list-item' : 'paragraph'
}

function blockLevel(paragraph: unknown[], kind: OfficeTextBlockKind): number {
  if (kind === 'heading') {
    const style = orderedAttribute(paragraph, 'pStyle', 'val')
    const level = Number.parseInt(style.match(/(\d+)$/)?.[1] ?? '1', 10)
    return Number.isFinite(level) ? Math.min(6, Math.max(1, level)) : 1
  }
  if (kind === 'list-item') {
    const level = Number.parseInt(orderedAttribute(paragraph, 'ilvl', 'val'), 10)
    return Number.isFinite(level) ? Math.min(5, Math.max(0, level)) : 0
  }
  return 0
}

export function parseDocxPreview(archive: OfficeArchive): DocxPreview {
  const root: OrderedXmlNode[] = packageOrderedXml(archive, 'word/document.xml')
  const paragraphs = orderedElements(root, 'p', MAX_BLOCKS + 1)
  const blocks: OfficeTextBlock[] = []
  for (const paragraph of paragraphs.slice(0, MAX_BLOCKS)) {
    const text = paragraphText(paragraph)
    if (!text) continue
    const kind = blockKind(paragraph)
    blocks.push({ kind, level: blockLevel(paragraph, kind), text })
  }
  const explicitTitle = blocks.find((block) => block.kind === 'title')
  const title = explicitTitle ? explicitTitle.text : (blocks.at(0)?.text ?? 'Untitled document')
  return {
    blocks,
    kind: 'docx',
    title: title.slice(0, 160),
    truncated: paragraphs.length > MAX_BLOCKS
  }
}
