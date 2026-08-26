import type {
  CodeObjectUiAction,
  CodeObjectUiTone,
  FinancialDashboardFinding,
  FinancialDashboardMetric,
  FinancialDashboardModel,
  FinancialDashboardTable,
  FinancialDashboardTableColumn
} from '@/app/code-object/ui-runtime/types'

import { isRecord, optionalString, stringValue } from '../model'

function stringUnion<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}

function action(value: unknown): CodeObjectUiAction | undefined {
  if (!isRecord(value)) return undefined
  const label = optionalString(value.label)
  const prompt = optionalString(value.prompt)
  return label && prompt ? { label, prompt } : undefined
}

function actions(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((candidate) => action(candidate) ?? []).slice(0, 6)
    : []
}

function metric(value: unknown, index: number): FinancialDashboardMetric | null {
  if (!isRecord(value)) return null
  const series = Array.isArray(value.series)
    ? value.series
        .filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
        .slice(0, 32)
    : undefined
  return {
    label: stringValue(value.label, `Metric ${index + 1}`),
    reportLabel: optionalString(value.reportLabel),
    series: series && series.length > 1 ? series : undefined,
    trend: stringUnion(value.trend, ['negative', 'no_change', 'positive'] as const, 'no_change'),
    value: stringValue(value.value, 'Not available'),
    whatChanged: optionalString(value.whatChanged)
  }
}

function finding(value: unknown, index: number): FinancialDashboardFinding | null {
  if (!isRecord(value)) return null
  return {
    action: action(value.action),
    description: optionalString(value.description),
    severity: optionalString(value.severity)
      ? stringUnion(value.severity, ['Cleanup', 'High', 'Medium'] as const, 'Medium')
      : undefined,
    text: stringValue(value.text, 'No supporting detail was provided.'),
    title: stringValue(value.title, `Finding ${index + 1}`),
    tone: stringUnion<CodeObjectUiTone>(
      value.tone,
      ['accent', 'danger', 'neutral', 'success', 'warning'] as const,
      'neutral'
    )
  }
}

function findings(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((candidate, index) => finding(candidate, index) ?? []).slice(0, 8)
    : []
}

function tableColumn(value: unknown): FinancialDashboardTableColumn | null {
  if (!isRecord(value)) return null
  const key = optionalString(value.key)
  if (!key) return null
  return {
    align: stringUnion(value.align, ['left', 'right'] as const, 'left'),
    key,
    label: stringValue(value.label, key)
  }
}

function table(value: unknown): FinancialDashboardTable | undefined {
  if (!isRecord(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows))
    return undefined
  const columns = value.columns.flatMap((candidate) => tableColumn(candidate) ?? []).slice(0, 12)
  if (columns.length === 0) return undefined
  const allowedKeys = new Set(columns.map((column) => column.key))
  const rows = value.rows
    .flatMap((candidate) => {
      if (!isRecord(candidate)) return []
      const row: Record<string, number | string> = {}
      for (const [key, cell] of Object.entries(candidate)) {
        if (allowedKeys.has(key) && (typeof cell === 'number' || typeof cell === 'string'))
          row[key] = cell
      }
      return [row]
    })
    .slice(0, 50)
  return { columns, rows, title: stringValue(value.title, 'Details') }
}

export function normalizeFinancialDashboardModel(value: unknown): FinancialDashboardModel {
  const record = isRecord(value) ? value : {}
  const keyNumbers = Array.isArray(record.keyNumbers)
    ? record.keyNumbers.flatMap((candidate, index) => metric(candidate, index) ?? []).slice(0, 8)
    : []

  return {
    accountingMethod: optionalString(record.accountingMethod),
    actions: actions(record.actions),
    companyName: stringValue(record.companyName, 'Connected business'),
    comparisonPeriod: optionalString(record.comparisonPeriod),
    goingWell: findings(record.goingWell),
    keyNumbers,
    needsAttention: findings(record.needsAttention),
    overallRead: stringUnion(
      record.overallRead,
      ['mixed', 'needs_attention', 'stable', 'strong'] as const,
      'mixed'
    ),
    overallReadText: stringValue(
      record.overallReadText,
      'Add connected financial data to generate a grounded business read.'
    ),
    period: stringValue(record.period, 'Current period'),
    table: table(record.table),
    title: stringValue(record.title, 'Business health')
  }
}
