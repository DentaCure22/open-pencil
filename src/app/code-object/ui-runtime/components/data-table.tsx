import { createColumnHelper, metaHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { useMemo } from 'react'

import { cn } from '../classnames'
import type {
  FinancialDashboardTableColumn,
  FinancialDashboardTable as FinancialDashboardTableModel
} from '../types'

type JsonTableRow = Record<string, number | string>
type TableColumnMeta = { align?: 'left' | 'right' }

const TABLE_FEATURES = tableFeatures({ columnMeta: metaHelper<TableColumnMeta>() })
const COLUMN_HELPER = createColumnHelper<typeof TABLE_FEATURES, JsonTableRow>()

function columnsFor(definitions: FinancialDashboardTableColumn[]) {
  return COLUMN_HELPER.columns(
    definitions.map((definition) =>
      COLUMN_HELPER.accessor((row) => row[definition.key] ?? '', {
        cell: (context) => String(context.getValue()),
        header: definition.label,
        id: definition.key,
        meta: { align: definition.align ?? 'left' }
      })
    )
  )
}

export function DataTable({ model }: { model: FinancialDashboardTableModel }) {
  const columns = useMemo(() => columnsFor(model.columns), [model.columns])
  const table = useTable({ columns, data: model.rows, features: TABLE_FEATURES })

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr className="border-b border-border" key={group.id}>
              {group.headers.map((header) => {
                const align = header.column.columnDef.meta?.align
                return (
                  <th
                    className={cn(
                      'px-3 py-2 font-medium text-muted-foreground',
                      align === 'right' && 'text-right'
                    )}
                    key={header.id}
                  >
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr className="border-b border-border/60 last:border-0" key={row.id}>
              {row.getAllCells().map((cell) => {
                const align = cell.column.columnDef.meta?.align
                return (
                  <td
                    className={cn(
                      'px-3 py-2.5 text-card-foreground',
                      align === 'right' && 'text-right tabular-nums'
                    )}
                    key={cell.id}
                  >
                    <table.FlexRender cell={cell} />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
