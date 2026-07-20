import { SceneGraph } from '@open-pencil/scene-graph'

import { computeAllLayouts } from '#core/layout'

import { structuredDataPluginData } from './metadata'
import {
  CONTENT_WIDTH,
  createDataDocumentSurface,
  createDataRow,
  createDataText,
  createTruncationRow,
  MUTED_COLOR,
  TEXT_COLOR
} from './scene'
import { withoutByteOrderMark } from './source'
import type { CSVRow, CSVRowsParser, StructuredDataImportOptions } from './types'

const MAX_COLUMNS = 10
const MAX_CELLS = 1000
const CELL_GAP = 12
const ROW_HORIZONTAL_PADDING = 24

export interface CSVProjection {
  headers: string[]
  rows: string[][]
  totalColumns: number
  totalRows: number
  truncatedColumns: boolean
  truncatedRows: boolean
}

function fileBaseName(fileName: string | undefined): string {
  const base = fileName?.replace(/\.csv$/i, '').trim()
  return base || 'CSV document'
}

export function parseCSVSource(source: string, parseRows: CSVRowsParser): string[][] {
  try {
    return parseRows(withoutByteOrderMark(source)).map((row: CSVRow) => [...row])
  } catch (error) {
    throw new Error(`Invalid CSV source: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function csvProjectionFor(rows: string[][]): CSVProjection {
  const totalColumns = rows.reduce((count, row) => Math.max(count, row.length), 0)
  const visibleColumnCount = Math.min(totalColumns, MAX_COLUMNS)
  const sourceHeaders = rows[0] ?? []
  const headers = Array.from({ length: visibleColumnCount }, (_, index) => {
    const header = sourceHeaders[index]?.trim()
    return header || `Column ${index + 1}`
  })
  const sourceRows = rows.slice(1)
  const rowLimit = visibleColumnCount
    ? Math.max(1, Math.floor(MAX_CELLS / visibleColumnCount))
    : MAX_CELLS
  const visibleRows = sourceRows.slice(0, rowLimit).map((row) => row.slice(0, visibleColumnCount))

  return {
    headers,
    rows: visibleRows,
    totalColumns,
    totalRows: sourceRows.length,
    truncatedColumns: totalColumns > visibleColumnCount,
    truncatedRows: sourceRows.length > visibleRows.length
  }
}

function summaryFor(projection: CSVProjection): string {
  return `CSV · ${projection.totalRows} data ${projection.totalRows === 1 ? 'row' : 'rows'} · ${projection.totalColumns} ${projection.totalColumns === 1 ? 'column' : 'columns'}`
}

function cellWidth(columnCount: number): number {
  if (columnCount <= 0) return CONTENT_WIDTH - ROW_HORIZONTAL_PADDING
  const gaps = CELL_GAP * Math.max(0, columnCount - 1)
  return Math.floor((CONTENT_WIDTH - ROW_HORIZONTAL_PADDING - gaps) / columnCount)
}

function renderTableHeader(
  graph: SceneGraph,
  parentId: string,
  headers: string[],
  width: number
): void {
  const row = createDataRow(graph, parentId, {
    name: 'CSV header',
    width: CONTENT_WIDTH,
    muted: true,
    pluginData: structuredDataPluginData({ kind: 'table-header' })
  })
  for (const [columnIndex, header] of headers.entries()) {
    const pluginData = structuredDataPluginData({
      kind: 'table-cell',
      path: `/columns/${columnIndex}`,
      columnIndex,
      columnName: header,
      field: 'header'
    })
    createDataText(graph, row.id, header, {
      name: `CSV header: ${header}`,
      width,
      fontSize: 12,
      fontWeight: 650,
      color: MUTED_COLOR,
      pluginData
    })
  }
}

function renderTableRow(
  graph: SceneGraph,
  parentId: string,
  headers: string[],
  values: string[],
  rowIndex: number,
  width: number
): void {
  const row = createDataRow(graph, parentId, {
    name: `CSV row ${rowIndex + 1}`,
    width: CONTENT_WIDTH,
    pluginData: structuredDataPluginData({
      kind: 'table-row',
      path: `/rows/${rowIndex}`,
      rowIndex
    })
  })
  for (const [columnIndex, columnName] of headers.entries()) {
    const value = values[columnIndex] ?? ''
    const pluginData = structuredDataPluginData({
      kind: 'table-cell',
      path: `/rows/${rowIndex}/${columnIndex}`,
      rowIndex,
      columnIndex,
      columnName,
      field: 'value'
    })
    createDataText(graph, row.id, value, {
      name: `CSV cell: ${columnName}`,
      width,
      color: value ? TEXT_COLOR : MUTED_COLOR,
      pluginData
    })
  }
}

function truncationMessage(projection: CSVProjection): string {
  const limitations: string[] = []
  if (projection.truncatedRows) limitations.push(`${projection.rows.length} rows`)
  if (projection.truncatedColumns) limitations.push(`${projection.headers.length} columns`)
  return `Showing ${limitations.join(' and ')}. The complete source remains attached.`
}

export function csvToSceneGraph(
  source: string,
  parseRows: CSVRowsParser,
  options: StructuredDataImportOptions = {}
): SceneGraph {
  const projection = csvProjectionFor(parseCSVSource(source, parseRows))
  const graph = new SceneGraph()
  const surface = createDataDocumentSurface(graph, {
    name: fileBaseName(options.fileName),
    format: 'csv',
    mimeType: options.mimeType || 'text/csv',
    fileName: options.fileName ?? null,
    source,
    summary: summaryFor(projection)
  })

  if (projection.headers.length === 0) {
    createTruncationRow(graph, surface.content.id, 'Empty CSV document')
  } else {
    const width = cellWidth(projection.headers.length)
    renderTableHeader(graph, surface.content.id, projection.headers, width)
    for (const [rowIndex, row] of projection.rows.entries()) {
      renderTableRow(graph, surface.content.id, projection.headers, row, rowIndex, width)
    }
  }
  if (projection.truncatedColumns || projection.truncatedRows) {
    createTruncationRow(graph, surface.content.id, truncationMessage(projection))
  }

  computeAllLayouts(graph, surface.root.id)
  return graph
}
