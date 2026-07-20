import { SceneGraph } from '@open-pencil/scene-graph'

import { computeAllLayouts } from '#core/layout'

import { structuredDataPluginData } from './metadata'
import {
  ACCENT_COLOR,
  CONTENT_WIDTH,
  createDataDocumentSurface,
  createDataRow,
  createDataText,
  createTruncationRow,
  MUTED_COLOR,
  TEXT_COLOR
} from './scene'
import { withoutByteOrderMark } from './source'
import type { JSONValue, JSONValueType, StructuredDataImportOptions } from './types'

const MAX_TREE_ROWS = 500
const LABEL_WIDTH = 340
const TYPE_WIDTH = 100
const VALUE_WIDTH = CONTENT_WIDTH - LABEL_WIDTH - TYPE_WIDTH - 48
const MAX_VALUE_LENGTH = 180

interface JSONTreeRow {
  depth: number
  label: string
  path: string
  type: JSONValueType
  value: string
}

interface JSONTreeProjection {
  rows: JSONTreeRow[]
  truncated: boolean
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJSONValue(value: unknown): value is JSONValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (Array.isArray(value)) return value.every(isJSONValue)
  return isRecord(value) && Object.values(value).every(isJSONValue)
}

function jsonValueType(value: JSONValue): JSONValueType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'object'
}

function escapeJSONPointerSegment(segment: string): string {
  return segment.replaceAll('~', '~0').replaceAll('/', '~1')
}

function childPath(parentPath: string, segment: string): string {
  return `${parentPath}/${escapeJSONPointerSegment(segment)}`
}

function shortened(value: string): string {
  if (value.length <= MAX_VALUE_LENGTH) return value
  return `${value.slice(0, MAX_VALUE_LENGTH - 1)}…`
}

function displayValue(value: JSONValue): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (isRecord(value)) {
    const count = Object.keys(value).length
    return `${count} propert${count === 1 ? 'y' : 'ies'}`
  }
  if (typeof value === 'string') return shortened(JSON.stringify(value))
  return String(value)
}

function collectJSONRows(value: JSONValue): JSONTreeProjection {
  const rows: JSONTreeRow[] = []
  let truncated = false

  function visit(current: JSONValue, label: string, path: string, depth: number): void {
    if (rows.length >= MAX_TREE_ROWS) {
      truncated = true
      return
    }

    rows.push({
      depth,
      label,
      path,
      type: jsonValueType(current),
      value: displayValue(current)
    })
    if (Array.isArray(current)) {
      for (const [index, child] of current.entries()) {
        visit(child, String(index), childPath(path, String(index)), depth + 1)
        if (truncated) return
      }
      return
    }
    if (!isRecord(current)) return
    for (const [key, child] of Object.entries(current)) {
      if (!isJSONValue(child)) continue
      visit(child, key, childPath(path, key), depth + 1)
      if (truncated) return
    }
  }

  visit(value, '$', '', 0)
  return { rows, truncated }
}

function fileBaseName(fileName: string | undefined, fallback: string): string {
  const base = fileName?.replace(/(?:\.schema)?\.json$/i, '').trim()
  return base || fallback
}

function looksLikeJSONSchema(value: JSONValue, fileName?: string): boolean {
  if (/\.schema\.json$/i.test(fileName ?? '')) return true
  if (!isRecord(value)) return false
  if (typeof value.$schema === 'string') return true
  return (
    isRecord(value.properties) &&
    (typeof value.type === 'string' || isRecord(value.$defs) || Array.isArray(value.required))
  )
}

function parseJSONSource(source: string): JSONValue {
  let parsed: unknown
  try {
    parsed = JSON.parse(withoutByteOrderMark(source))
  } catch (error) {
    throw new Error(
      `Invalid JSON source: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (!isJSONValue(parsed)) throw new Error('Invalid JSON source: values must be valid JSON data')
  return parsed
}

function summaryFor(value: JSONValue, schema: boolean, rowCount: number): string {
  const rootType = jsonValueType(value)
  const prefix = schema ? 'JSON Schema' : 'JSON'
  return `${prefix} · ${rootType} root · ${rowCount} visible ${rowCount === 1 ? 'entry' : 'entries'}`
}

function renderTreeHeader(graph: SceneGraph, parentId: string): void {
  const row = createDataRow(graph, parentId, {
    name: 'JSON tree columns',
    width: CONTENT_WIDTH,
    muted: true,
    pluginData: structuredDataPluginData({ kind: 'tree-header' })
  })
  createDataText(graph, row.id, 'Key', {
    name: 'Key column',
    width: LABEL_WIDTH,
    fontSize: 12,
    fontWeight: 650,
    color: MUTED_COLOR
  })
  createDataText(graph, row.id, 'Type', {
    name: 'Type column',
    width: TYPE_WIDTH,
    fontSize: 12,
    fontWeight: 650,
    color: MUTED_COLOR
  })
  createDataText(graph, row.id, 'Value', {
    name: 'Value column',
    width: VALUE_WIDTH,
    fontSize: 12,
    fontWeight: 650,
    color: MUTED_COLOR
  })
}

function renderTreeRow(graph: SceneGraph, parentId: string, row: JSONTreeRow): void {
  const pluginData = structuredDataPluginData({
    kind: 'tree-row',
    path: row.path,
    valueType: row.type
  })
  const node = createDataRow(graph, parentId, {
    name: row.path || 'JSON root',
    width: CONTENT_WIDTH,
    pluginData
  })
  createDataText(graph, node.id, `${'  '.repeat(row.depth)}${row.label}`, {
    name: 'JSON key',
    width: LABEL_WIDTH,
    fontWeight: row.depth === 0 ? 650 : 500,
    color: row.depth === 0 ? ACCENT_COLOR : TEXT_COLOR,
    pluginData
  })
  createDataText(graph, node.id, row.type, {
    name: 'JSON value type',
    width: TYPE_WIDTH,
    fontSize: 12,
    color: MUTED_COLOR,
    pluginData
  })
  createDataText(graph, node.id, row.value, {
    name: 'JSON value',
    width: VALUE_WIDTH,
    color: row.type === 'object' || row.type === 'array' ? MUTED_COLOR : TEXT_COLOR,
    pluginData
  })
}

export function jsonToSceneGraph(
  source: string,
  options: StructuredDataImportOptions = {}
): SceneGraph {
  const value = parseJSONSource(source)
  const isSchema = looksLikeJSONSchema(value, options.fileName)
  const format = isSchema ? 'json-schema' : 'json'
  const name = fileBaseName(options.fileName, isSchema ? 'JSON Schema' : 'JSON document')
  const projection = collectJSONRows(value)
  const graph = new SceneGraph()
  const surface = createDataDocumentSurface(graph, {
    name,
    format,
    mimeType: options.mimeType || (isSchema ? 'application/schema+json' : 'application/json'),
    fileName: options.fileName ?? null,
    source,
    summary: summaryFor(value, isSchema, projection.rows.length)
  })

  renderTreeHeader(graph, surface.content.id)
  for (const row of projection.rows) renderTreeRow(graph, surface.content.id, row)
  if (projection.truncated) {
    createTruncationRow(
      graph,
      surface.content.id,
      `Showing the first ${MAX_TREE_ROWS} entries. The complete source remains attached.`
    )
  }

  computeAllLayouts(graph, surface.root.id)
  return graph
}

export { looksLikeJSONSchema }
