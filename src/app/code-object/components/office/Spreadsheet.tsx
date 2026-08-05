import type { CodeObjectState, OfficeSpreadsheetState } from '@/app/code-object/model'

import { UniverSurface } from './UniverSurface'

type SpreadsheetProps = {
  fileName: string
  interactionEnabled: boolean
  onStateChange: (state: CodeObjectState) => void
  state: OfficeSpreadsheetState
}

type SavedSpreadsheetCell = {
  f?: unknown
  v?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function snapshotRows(state: OfficeSpreadsheetState) {
  const snapshot = state.snapshot
  if (!snapshot || !Array.isArray(snapshot.sheetOrder) || !isRecord(snapshot.sheets)) {
    return state.seedCells
  }
  const sheetId = snapshot.sheetOrder.find((id): id is string => typeof id === 'string')
  const sheet = sheetId ? snapshot.sheets[sheetId] : undefined
  if (!isRecord(sheet) || !isRecord(sheet.cellData)) return state.seedCells
  const rows = Object.entries(sheet.cellData).flatMap(([rowIndex, row]) => {
    if (!isRecord(row)) return []
    const values = Object.entries(row).flatMap(([columnIndex, cell]) => {
      if (!isRecord(cell)) return []
      const savedCell = cell as SavedSpreadsheetCell
      return [[Number(columnIndex), savedCell.f ?? savedCell.v ?? ''] as const]
    })
    return [[Number(rowIndex), values] as const]
  })
  if (!rows.length) return state.seedCells
  const previewRows: OfficeSpreadsheetState['seedCells'] = []
  for (const [rowIndex, values] of rows) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0) continue
    const row = (previewRows[rowIndex] ??= [])
    for (const [columnIndex, value] of values) {
      if (!Number.isInteger(columnIndex) || columnIndex < 0) continue
      if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        row[columnIndex] = value
      }
    }
  }
  return previewRows.length ? previewRows : state.seedCells
}

export function Spreadsheet(props: SpreadsheetProps) {
  const rows = snapshotRows(props.state)
  const columnCount = Math.max(8, ...rows.map((row) => row.length))
  const columns = Array.from({ length: columnCount }, (_, index) =>
    String.fromCharCode('A'.charCodeAt(0) + index)
  )

  return (
    <UniverSurface
      {...props}
      kind="spreadsheet"
      preview={
        <section className="flex size-full flex-col overflow-hidden bg-white text-[#263238]">
          <div className="grid h-7 shrink-0 grid-cols-[42px_repeat(8,minmax(110px,1fr))] border-b border-[#d9dee7] bg-[#f5f7fa] text-[11px] font-medium text-[#667085]">
            <span className="border-r border-[#d9dee7]" />
            {columns.slice(0, 8).map((column) => (
              <span
                key={column}
                className="flex items-center justify-center border-r border-[#d9dee7]"
              >
                {column}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {Array.from({ length: 22 }, (_, rowIndex) => (
              <div
                key={rowIndex}
                className="grid h-7 grid-cols-[42px_repeat(8,minmax(110px,1fr))] border-b border-[#e6e9ef] text-[11px]"
              >
                <span className="flex items-center justify-center border-r border-[#d9dee7] bg-[#f8fafc] text-[#7a8496]">
                  {rowIndex + 1}
                </span>
                {columns.slice(0, 8).map((column, columnIndex) => {
                  const value = rows.at(rowIndex)?.at(columnIndex)
                  const header = rowIndex === 0 && value !== undefined
                  return (
                    <span
                      key={column}
                      className={`flex items-center border-r border-[#e6e9ef] px-2 ${
                        header
                          ? 'bg-[#eef4ff] font-semibold text-[#24406f]'
                          : 'bg-white text-[#344054]'
                      }`}
                    >
                      {value === undefined ? '' : String(value)}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
          <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-[#d9dee7] bg-[#f8fafc] px-3 text-[11px]">
            <span className="font-semibold text-[#2f65d9]">Overview</span>
            <span className="h-4 w-px bg-[#d9dee7]" />
            <span className="text-[#7a8496]">100%</span>
          </footer>
        </section>
      }
    />
  )
}
