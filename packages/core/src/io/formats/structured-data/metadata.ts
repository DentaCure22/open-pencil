import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

import type { JSONValueType, StructuredDataNodeKind, StructuredDataNodeMetadata } from './types'

const PLUGIN_ID = 'open-pencil'
const KEY_PREFIX = 'structured-data/'
const KIND_KEY = `${KEY_PREFIX}kind`
const PATH_KEY = `${KEY_PREFIX}path`
const VALUE_TYPE_KEY = `${KEY_PREFIX}value-type`
const ROW_INDEX_KEY = `${KEY_PREFIX}row-index`
const COLUMN_INDEX_KEY = `${KEY_PREFIX}column-index`
const COLUMN_NAME_KEY = `${KEY_PREFIX}column-name`

interface StructuredDataPluginDataInput {
  kind: StructuredDataNodeKind
  path?: string
  valueType?: JSONValueType
  rowIndex?: number
  columnIndex?: number
  columnName?: string
}

function entry(key: string, value: string): PluginDataEntry {
  return { pluginId: PLUGIN_ID, key, value }
}

export function structuredDataPluginData(
  metadata: StructuredDataPluginDataInput
): PluginDataEntry[] {
  const entries = [entry(KIND_KEY, metadata.kind)]
  if (metadata.path !== undefined) entries.push(entry(PATH_KEY, metadata.path))
  if (metadata.valueType !== undefined) entries.push(entry(VALUE_TYPE_KEY, metadata.valueType))
  if (metadata.rowIndex !== undefined) entries.push(entry(ROW_INDEX_KEY, String(metadata.rowIndex)))
  if (metadata.columnIndex !== undefined) {
    entries.push(entry(COLUMN_INDEX_KEY, String(metadata.columnIndex)))
  }
  if (metadata.columnName !== undefined) entries.push(entry(COLUMN_NAME_KEY, metadata.columnName))
  return entries
}

function valueFor(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  return (
    node.pluginData.find((item) => item.pluginId === PLUGIN_ID && item.key === key)?.value ?? null
  )
}

function indexFor(node: Pick<SceneNode, 'pluginData'>, key: string): number | null {
  const value = valueFor(node, key)
  if (value === null) return null
  const index = Number.parseInt(value, 10)
  return Number.isSafeInteger(index) && index >= 0 ? index : null
}

function isNodeKind(value: string): value is StructuredDataNodeKind {
  return [
    'document',
    'tree-header',
    'tree-row',
    'table-header',
    'table-row',
    'table-cell',
    'truncation'
  ].includes(value)
}

function isValueType(value: string | null): value is JSONValueType {
  return (
    value !== null && ['object', 'array', 'string', 'number', 'boolean', 'null'].includes(value)
  )
}

export function readStructuredDataNode(
  node: Pick<SceneNode, 'pluginData'>
): StructuredDataNodeMetadata | null {
  const kind = valueFor(node, KIND_KEY)
  if (!kind || !isNodeKind(kind)) return null

  const valueType = valueFor(node, VALUE_TYPE_KEY)
  return {
    kind,
    path: valueFor(node, PATH_KEY),
    valueType: isValueType(valueType) ? valueType : null,
    rowIndex: indexFor(node, ROW_INDEX_KEY),
    columnIndex: indexFor(node, COLUMN_INDEX_KEY),
    columnName: valueFor(node, COLUMN_NAME_KEY)
  }
}
