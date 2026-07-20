import type { OfficeArchive } from '../archive'
import type { SpreadsheetCell, SpreadsheetSheet, XlsxPreview } from '../types'
import {
  attribute,
  child,
  children,
  collectText,
  packageXml,
  relationshipPath,
  stringValue
} from '../xml'

const MAX_SHEETS = 8
const MAX_ROWS = 120
const MAX_COLUMNS = 36
const MAX_CELLS = 1_500

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
  let value = 0
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64
  return Math.max(0, value - 1)
}

function sharedStrings(archive: OfficeArchive): string[] {
  const root = packageXml(archive, 'xl/sharedStrings.xml', false)
  return root ? children(child(root, 'sst'), 'si').map((item) => collectText(item)) : []
}

function relationshipTargets(archive: OfficeArchive): Map<string, string> {
  const root = packageXml(archive, 'xl/_rels/workbook.xml.rels')
  const relationships = children(child(root, 'Relationships'), 'Relationship')
  return new Map(
    relationships.flatMap((relationship) => {
      const id = attribute(relationship, 'Id')
      const path = relationshipPath('xl', attribute(relationship, 'Target'))
      return id && path ? [[id, path]] : []
    })
  )
}

function cellValue(cell: Record<string, unknown>, strings: string[]): string {
  const type = attribute(cell, 't')
  if (type === 'inlineStr') return collectText(child(cell, 'is'))
  const raw = stringValue(cell.v)
  if (type === 's') {
    const index = Number.parseInt(raw, 10)
    return Number.isSafeInteger(index) && index >= 0 ? (strings[index] ?? '') : ''
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  return raw
}

function parseSheet(
  archive: OfficeArchive,
  path: string,
  name: string,
  strings: string[]
): SpreadsheetSheet {
  const root = packageXml(archive, path)
  const rows = children(child(child(root, 'worksheet'), 'sheetData'), 'row')
  const cells: SpreadsheetCell[] = []
  let maxColumn = 0
  let maxRow = 0
  let truncated = rows.length > MAX_ROWS
  for (const [rowOffset, row] of rows.slice(0, MAX_ROWS).entries()) {
    const rowNumber = Number.parseInt(attribute(row, 'r'), 10)
    const fallbackRow = rowOffset + 1
    const index = Number.isSafeInteger(rowNumber) && rowNumber > 0 ? rowNumber - 1 : fallbackRow - 1
    if (index >= MAX_ROWS) {
      truncated = true
      continue
    }
    for (const cell of children(row, 'c')) {
      const column = columnIndex(attribute(cell, 'r'))
      if (column >= MAX_COLUMNS || cells.length >= MAX_CELLS) {
        truncated = true
        continue
      }
      const value = cellValue(cell, strings).slice(0, 500)
      if (!value) continue
      cells.push({ column, row: index, value })
      maxColumn = Math.max(maxColumn, column)
      maxRow = Math.max(maxRow, index)
    }
  }
  return {
    cells,
    columnCount: Math.min(MAX_COLUMNS, Math.max(8, maxColumn + 1)),
    name: name || 'Sheet',
    rowCount: Math.min(MAX_ROWS, Math.max(14, maxRow + 1)),
    truncated
  }
}

export function parseXlsxPreview(archive: OfficeArchive): XlsxPreview {
  const workbook = packageXml(archive, 'xl/workbook.xml')
  const sheetRecords = children(child(child(workbook, 'workbook'), 'sheets'), 'sheet')
  const targets = relationshipTargets(archive)
  const strings = sharedStrings(archive)
  const sheets = sheetRecords.slice(0, MAX_SHEETS).flatMap((sheet) => {
    const path = targets.get(attribute(sheet, 'id'))
    if (!path || !archive[path]) return []
    return [parseSheet(archive, path, attribute(sheet, 'name'), strings)]
  })
  return {
    kind: 'xlsx',
    sheets,
    truncated: sheetRecords.length > MAX_SHEETS || sheets.some((sheet) => sheet.truncated)
  }
}
