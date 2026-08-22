import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

import { pluginDataEntry, pluginDataValues } from '#core/io/plugin-data'

import type {
  JSONValueType,
  StructuredDataNodeField,
  StructuredDataNodeKind,
  StructuredDataNodeMetadata
} from './types'

const PLUGIN_ID = 'open-pencil'
const KEY_PREFIX = 'structured-data/'
const KIND_KEY = `${KEY_PREFIX}kind`
const PATH_KEY = `${KEY_PREFIX}path`
const VALUE_TYPE_KEY = `${KEY_PREFIX}value-type`
const ROW_INDEX_KEY = `${KEY_PREFIX}row-index`
const COLUMN_INDEX_KEY = `${KEY_PREFIX}column-index`
const COLUMN_NAME_KEY = `${KEY_PREFIX}column-name`
const FIELD_KEY = `${KEY_PREFIX}field`

interface StructuredDataPluginDataInput {
  kind: StructuredDataNodeKind
  path?: string
  valueType?: JSONValueType
  rowIndex?: number
  columnIndex?: number
  columnName?: string
  field?: StructuredDataNodeField
}

export function structuredDataPluginData(
  metadata: StructuredDataPluginDataInput
): PluginDataEntry[] {
  const entries = [pluginDataEntry(PLUGIN_ID, KIND_KEY, metadata.kind)]
  if (metadata.path !== undefined) {
    entries.push(pluginDataEntry(PLUGIN_ID, PATH_KEY, metadata.path))
  }
  if (metadata.valueType !== undefined) {
    entries.push(pluginDataEntry(PLUGIN_ID, VALUE_TYPE_KEY, metadata.valueType))
  }
  if (metadata.rowIndex !== undefined) {
    entries.push(pluginDataEntry(PLUGIN_ID, ROW_INDEX_KEY, String(metadata.rowIndex)))
  }
  if (metadata.columnIndex !== undefined) {
    entries.push(pluginDataEntry(PLUGIN_ID, COLUMN_INDEX_KEY, String(metadata.columnIndex)))
  }
  if (metadata.columnName !== undefined) {
    entries.push(pluginDataEntry(PLUGIN_ID, COLUMN_NAME_KEY, metadata.columnName))
  }
  if (metadata.field !== undefined) {
    entries.push(pluginDataEntry(PLUGIN_ID, FIELD_KEY, metadata.field))
  }
  return entries
}

function indexFor(values: ReadonlyMap<string, string>, key: string): number | null {
  const value = values.get(key)
  if (value === undefined) return null
  const index = Number.parseInt(value, 10)
  return Number.isSafeInteger(index) && index >= 0 ? index : null
}

function isNodeKind(value: string): value is StructuredDataNodeKind {
  return [
    'document',
    'source-status',
    'tree-header',
    'tree-row',
    'table-header',
    'table-row',
    'table-cell',
    'truncation'
  ].includes(value)
}

function isNodeField(value: string | null): value is StructuredDataNodeField {
  return value !== null && ['header', 'label', 'type', 'value'].includes(value)
}

function isValueType(value: string | null): value is JSONValueType {
  return (
    value !== null && ['object', 'array', 'string', 'number', 'boolean', 'null'].includes(value)
  )
}

export function readStructuredDataNode(
  node: Pick<SceneNode, 'pluginData'>
): StructuredDataNodeMetadata | null {
  const values = pluginDataValues(node, PLUGIN_ID)
  const kind = values.get(KIND_KEY)
  if (!kind || !isNodeKind(kind)) return null

  const valueType = values.get(VALUE_TYPE_KEY) ?? null
  const field = values.get(FIELD_KEY) ?? null
  return {
    kind,
    path: values.get(PATH_KEY) ?? null,
    valueType: isValueType(valueType) ? valueType : null,
    rowIndex: indexFor(values, ROW_INDEX_KEY),
    columnIndex: indexFor(values, COLUMN_INDEX_KEY),
    columnName: values.get(COLUMN_NAME_KEY) ?? null,
    field: isNodeField(field) ? field : null
  }
}
