import { csvFormatRows, csvParseRows } from 'd3-dsv'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  mergeContentSourcePluginData,
  mergeSourceReconciliationPluginData,
  readContentSource,
  readSourceReconciliation,
  type ContentSourceMetadata,
  type SourceReconciliationResult
} from '#core/io/content-source'

import { csvProjectionFor, parseCSVSource } from './csv'
import { collectJSONRows, parseJSONSource } from './json'
import { readStructuredDataNode } from './metadata'
import { withoutByteOrderMark } from './source'
import type { JSONPrimitive, JSONValue, JSONValueType, StructuredDataNodeField } from './types'

type SourceTextNode = {
  node: SceneNode
  field: StructuredDataNodeField
  path: string
}

function blocked(
  metadata: ContentSourceMetadata,
  status: 'conflict' | 'unsupported',
  message: string
): SourceReconciliationResult {
  return { status, source: metadata.source, revision: metadata.revision, message }
}

function textNodesFor(graph: SceneGraph, sourceNode: SceneNode): SourceTextNode[] {
  return graph
    .flattenTree(sourceNode.id)
    .map(({ node }) => node)
    .flatMap((node) => {
      if (node.type !== 'TEXT') return []
      const data = readStructuredDataNode(node)
      if (!data?.field || data.path === null) return []
      return [{ node, field: data.field, path: data.path }]
    })
}

function oneNode(
  nodes: SourceTextNode[],
  path: string,
  field: StructuredDataNodeField
): SceneNode | null {
  const matches = nodes.filter((item) => item.path === path && item.field === field)
  return matches.length === 1 ? (matches[0]?.node ?? null) : null
}

function decodeJSONPointer(path: string): string[] {
  if (!path) return []
  return path
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
}

function setJSONValue(root: JSONValue, path: string, value: JSONPrimitive): JSONValue {
  const segments = decodeJSONPointer(path)
  if (segments.length === 0) return value

  let current: JSONValue = root
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10)
      if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
        throw new Error('path is missing')
      }
      current = current[index] ?? null
      continue
    }
    if (typeof current !== 'object' || current === null || !(segment in current)) {
      throw new Error('path is missing')
    }
    current = current[segment] ?? null
  }

  const finalSegment = segments.at(-1)
  if (finalSegment === undefined) return value
  if (Array.isArray(current)) {
    const index = Number.parseInt(finalSegment, 10)
    if (!Number.isSafeInteger(index) || index < 0 || index >= current.length) {
      throw new Error('path is missing')
    }
    current[index] = value
    return root
  }
  if (typeof current !== 'object' || current === null || !(finalSegment in current)) {
    throw new Error('path is missing')
  }
  current[finalSegment] = value
  return root
}

type ParsedJSONPrimitive = { valid: true; value: JSONPrimitive } | { valid: false }

function parseEditedJSONPrimitive(text: string, type: JSONValueType): ParsedJSONPrimitive {
  if (type === 'null')
    return text.trim() === 'null' ? { valid: true, value: null } : { valid: false }
  if (type === 'boolean') {
    if (text.trim() === 'true') return { valid: true, value: true }
    if (text.trim() === 'false') return { valid: true, value: false }
    return { valid: false }
  }
  if (type === 'number') {
    try {
      const value: unknown = JSON.parse(text)
      return typeof value === 'number' && Number.isFinite(value)
        ? { valid: true, value }
        : { valid: false }
    } catch {
      return { valid: false }
    }
  }
  if (type === 'string') {
    try {
      const value: unknown = JSON.parse(text)
      return typeof value === 'string' ? { valid: true, value } : { valid: false }
    } catch {
      return { valid: false }
    }
  }
  return { valid: false }
}

function jsonFormatting(source: string): {
  bom: string
  indent: string | number | undefined
  lineEnding: '\n' | '\r\n'
  trailingNewline: boolean
} {
  const clean = withoutByteOrderMark(source)
  const indentation = /\n([\t ]+)\S/.exec(clean)?.[1]
  return {
    bom: source.charCodeAt(0) === 0xfeff ? '\uFEFF' : '',
    indent: indentation?.includes('\t') ? '\t' : indentation?.length,
    lineEnding: clean.includes('\r\n') ? '\r\n' : '\n',
    trailingNewline: /\r?\n$/.test(clean)
  }
}

function formatJSONSource(source: string, value: JSONValue): string {
  const formatting = jsonFormatting(source)
  let generated = JSON.stringify(value, null, formatting.indent)
  if (formatting.lineEnding === '\r\n') generated = generated.replaceAll('\n', '\r\n')
  if (formatting.trailingNewline) generated += formatting.lineEnding
  return formatting.bom + generated
}

function reconcileJSON(
  graph: SceneGraph,
  sourceNode: SceneNode,
  metadata: ContentSourceMetadata
): SourceReconciliationResult {
  const value = parseJSONSource(metadata.source)
  const projection = collectJSONRows(value)
  const nodes = textNodesFor(graph, sourceNode)
  const expected = new Set<string>()
  let nextValue = structuredClone(value)
  let editCount = 0

  for (const row of projection.rows) {
    const label = oneNode(nodes, row.path, 'label')
    const type = oneNode(nodes, row.path, 'type')
    const displayed = oneNode(nodes, row.path, 'value')
    expected.add(`${row.path}:label`)
    expected.add(`${row.path}:type`)
    expected.add(`${row.path}:value`)
    if (!label || !type || !displayed) {
      return blocked(
        metadata,
        'conflict',
        'JSON source was preserved because a mapped native row is missing or duplicated.'
      )
    }
    if (label.text !== `${'  '.repeat(row.depth)}${row.label}` || type.text !== row.type) {
      return blocked(
        metadata,
        'unsupported',
        'JSON source was preserved because key and structure edits are not supported yet.'
      )
    }
    if (displayed.text === row.value) continue
    if (row.type === 'object' || row.type === 'array') {
      return blocked(
        metadata,
        'unsupported',
        'JSON source was preserved because container structure edits are not supported yet.'
      )
    }
    const edited = parseEditedJSONPrimitive(displayed.text, row.type)
    if (!edited.valid) {
      return blocked(
        metadata,
        'conflict',
        `JSON source was preserved because ${row.path || '$'} is not a valid ${row.type} value.`
      )
    }
    try {
      nextValue = setJSONValue(nextValue, row.path, edited.value)
    } catch {
      return blocked(
        metadata,
        'conflict',
        `JSON source was preserved because ${row.path || '$'} no longer maps to the original source.`
      )
    }
    editCount += 1
  }

  if (nodes.some((item) => !expected.has(`${item.path}:${item.field}`))) {
    return blocked(
      metadata,
      'unsupported',
      'JSON source was preserved because added native rows cannot be reconciled yet.'
    )
  }
  if (editCount === 0) {
    return {
      status: 'current',
      source: metadata.source,
      revision: metadata.revision,
      message: 'Source matches the native JSON document.'
    }
  }
  return {
    status: 'regenerated',
    source: formatJSONSource(metadata.source, nextValue),
    revision: metadata.revision + 1,
    message: `Regenerated JSON source from ${editCount} native ${editCount === 1 ? 'edit' : 'edits'}.`
  }
}

function csvFormatting(source: string): {
  bom: string
  lineEnding: '\n' | '\r\n'
  trailingNewline: boolean
} {
  const clean = withoutByteOrderMark(source)
  return {
    bom: source.charCodeAt(0) === 0xfeff ? '\uFEFF' : '',
    lineEnding: clean.includes('\r\n') ? '\r\n' : '\n',
    trailingNewline: /\r?\n$/.test(clean)
  }
}

function formatCSVSource(source: string, rows: string[][]): string {
  const formatting = csvFormatting(source)
  let generated = csvFormatRows(rows)
  if (formatting.lineEnding === '\r\n') generated = generated.replaceAll('\n', '\r\n')
  if (formatting.trailingNewline) generated += formatting.lineEnding
  return formatting.bom + generated
}

function reconcileCSV(
  graph: SceneGraph,
  sourceNode: SceneNode,
  metadata: ContentSourceMetadata
): SourceReconciliationResult {
  const rows = parseCSVSource(metadata.source, csvParseRows)
  const projection = csvProjectionFor(rows)
  const nodes = textNodesFor(graph, sourceNode)
  const expected = new Set<string>()
  const nextRows = structuredClone(rows)
  let editCount = 0

  for (const [columnIndex, header] of projection.headers.entries()) {
    const path = `/columns/${columnIndex}`
    const node = oneNode(nodes, path, 'header')
    expected.add(`${path}:header`)
    if (!node) {
      return blocked(
        metadata,
        'conflict',
        'CSV source was preserved because a mapped native header is missing or duplicated.'
      )
    }
    if (node.text === header) continue
    const target = nextRows[0] ?? []
    if (!nextRows[0]) nextRows[0] = target
    while (target.length <= columnIndex) target.push('')
    target[columnIndex] = node.text
    editCount += 1
  }

  for (const [rowIndex, values] of projection.rows.entries()) {
    for (const [columnIndex] of projection.headers.entries()) {
      const path = `/rows/${rowIndex}/${columnIndex}`
      const node = oneNode(nodes, path, 'value')
      expected.add(`${path}:value`)
      if (!node) {
        return blocked(
          metadata,
          'conflict',
          'CSV source was preserved because a mapped native cell is missing or duplicated.'
        )
      }
      const original = values[columnIndex] ?? ''
      if (node.text === original) continue
      const target = nextRows[rowIndex + 1] ?? []
      if (!nextRows[rowIndex + 1]) nextRows[rowIndex + 1] = target
      while (target.length <= columnIndex) target.push('')
      target[columnIndex] = node.text
      editCount += 1
    }
  }

  if (nodes.some((item) => !expected.has(`${item.path}:${item.field}`))) {
    return blocked(
      metadata,
      'unsupported',
      'CSV source was preserved because added native rows or columns cannot be reconciled yet.'
    )
  }
  if (editCount === 0) {
    return {
      status: 'current',
      source: metadata.source,
      revision: metadata.revision,
      message: 'Source matches the native CSV document.'
    }
  }
  return {
    status: 'regenerated',
    source: formatCSVSource(metadata.source, nextRows),
    revision: metadata.revision + 1,
    message: `Regenerated CSV source from ${editCount} native ${editCount === 1 ? 'edit' : 'edits'}.`
  }
}

export function reconcileStructuredDataSource(
  graph: SceneGraph,
  sourceNode: SceneNode
): SourceReconciliationResult {
  const metadata = readContentSource(sourceNode)
  if (!metadata || !['json', 'json-schema', 'csv'].includes(metadata.format)) {
    return {
      status: 'unsupported',
      source: metadata?.source ?? '',
      revision: metadata?.revision ?? 1,
      message: 'This node is not a source-backed JSON or CSV document.'
    }
  }
  return metadata.format === 'csv'
    ? reconcileCSV(graph, sourceNode, metadata)
    : reconcileJSON(graph, sourceNode, metadata)
}

function statusLabel(result: SourceReconciliationResult): string {
  const suffix =
    result.status === 'conflict' || result.status === 'unsupported' ? ' · ORIGINAL PRESERVED' : ''
  return `SOURCE · ${result.status.toUpperCase()} · REVISION ${result.revision}${suffix}`
}

export function applyStructuredDataReconciliation(
  graph: SceneGraph,
  sourceNode: SceneNode,
  result: SourceReconciliationResult
): void {
  const current = readContentSource(sourceNode)
  if (!current) return
  const previousReconciliation = readSourceReconciliation(sourceNode)
  const pluginData = mergeSourceReconciliationPluginData(
    result.status === 'regenerated'
      ? mergeContentSourcePluginData(sourceNode.pluginData, {
          ...current,
          revision: result.revision,
          source: result.source
        })
      : sourceNode.pluginData,
    {
      status: result.status,
      message: result.message,
      baseline: previousReconciliation?.baseline ?? null,
      revision: result.revision
    }
  )
  graph.updateNode(sourceNode.id, { pluginData })

  const status = graph
    .flattenTree(sourceNode.id)
    .map(({ node }) => node)
    .find((node) => readStructuredDataNode(node)?.kind === 'source-status')
  if (status?.type === 'TEXT') graph.updateNode(status.id, { text: statusLabel(result) })
}
