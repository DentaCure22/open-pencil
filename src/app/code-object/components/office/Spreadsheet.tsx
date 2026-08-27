import type { CodeObjectTheme } from '@open-pencil/core/code-object'

import type { CodeObjectState, OfficeSpreadsheetState } from '@/app/code-object/model'

import { UniverSurface } from './UniverSurface'

type SpreadsheetProps = {
  fileName: string
  interactionEnabled: boolean
  onStateChange: (state: CodeObjectState) => void
  state: OfficeSpreadsheetState
  theme: CodeObjectTheme
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
        <section className="flex size-full flex-col overflow-hidden bg-[var(--code-background)] text-[var(--code-text)]">
          <div className="grid h-7 shrink-0 grid-cols-[42px_repeat(8,minmax(110px,1fr))] border-b border-[var(--code-border)] bg-[var(--code-surface)] text-[11px] font-medium text-[var(--code-text-muted)]">
            <span className="border-r border-[var(--code-border)]" />
            {columns.slice(0, 8).map((column) => (
              <span
                key={column}
                className="flex items-center justify-center border-r border-[var(--code-border)]"
              >
                {column}
              </span>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {Array.from({ length: 22 }, (_, rowIndex) => (
              <div
                key={rowIndex}
                className="grid h-7 grid-cols-[42px_repeat(8,minmax(110px,1fr))] border-b border-[var(--code-border)] text-[11px]"
              >
                <span className="flex items-center justify-center border-r border-[var(--code-border)] bg-[var(--code-surface)] text-[var(--code-text-muted)]">
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
                          ? 'bg-[var(--code-surface)] font-semibold text-[var(--code-accent)]'
                          : 'bg-[var(--code-background)] text-[var(--code-text)]'
                      }`}
                    >
                      {value === undefined ? '' : String(value)}
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
          <footer className="flex h-9 shrink-0 items-center gap-3 border-t border-[var(--code-border)] bg-[var(--code-surface)] px-3 text-[11px]">
            <span className="font-semibold text-[var(--code-accent)]">Overview</span>
            <span className="h-4 w-px bg-[var(--code-border)]" />
            <span className="text-[var(--code-text-muted)]">100%</span>
          </footer>
        </section>
      }
    />
  )
}
