export type JSONPrimitive = string | number | boolean | null

export type JSONValue = JSONPrimitive | JSONValue[] | { [key: string]: JSONValue }

export type JSONValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export type StructuredDataNodeKind =
  | 'document'
  | 'source-status'
  | 'tree-header'
  | 'tree-row'
  | 'table-header'
  | 'table-row'
  | 'table-cell'
  | 'truncation'

export type StructuredDataNodeField = 'header' | 'label' | 'type' | 'value'

export interface StructuredDataNodeMetadata {
  kind: StructuredDataNodeKind
  path: string | null
  valueType: JSONValueType | null
  rowIndex: number | null
  columnIndex: number | null
  columnName: string | null
  field: StructuredDataNodeField | null
}

export interface StructuredDataImportOptions {
  fileName?: string
  mimeType?: string
}

export type CSVRow = readonly string[]
export type CSVRowsParser = (source: string) => readonly CSVRow[]
