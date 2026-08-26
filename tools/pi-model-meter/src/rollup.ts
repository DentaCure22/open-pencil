import type { UsageTurnRecord } from './schema'
import { percentage } from './schema'

export type UsageRollupRow = {
  callHitPercent: number
  estimatedPercent: number
  medianGapMs: number | null
  model: string
  promptTokens: number
  provider: string
  tokenCachePercent: number
  turns: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return Math.round(value)
}

function modelKey(record: UsageTurnRecord): string {
  return `${record.provider}/${record.model}`
}

export function rollupUsageTurns(turns: UsageTurnRecord[], sinceMs?: number): UsageRollupRow[] {
  const groups = new Map<string, UsageTurnRecord[]>()
  for (const record of turns) {
    if (sinceMs !== undefined && Date.parse(record.at) < sinceMs) continue
    const key = modelKey(record)
    const group = groups.get(key) ?? []
    group.push(record)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const promptTokens = group.reduce((total, record) => total + record.promptTokens, 0)
      const cacheRead = group.reduce((total, record) => total + record.cacheRead, 0)
      const hits = group.filter((record) => record.cacheRead > 0).length
      const estimated = group.filter((record) => record.usageSource === 'estimated').length
      const gaps = group
        .map((record) => record.gapMs)
        .filter((value): value is number => value !== null)
      const slash = key.indexOf('/')
      return {
        callHitPercent: group.length ? percentage((hits / group.length) * 100) : 0,
        estimatedPercent: group.length ? percentage((estimated / group.length) * 100) : 0,
        medianGapMs: median(gaps),
        model: slash !== -1 ? key.slice(slash + 1) : key,
        promptTokens,
        provider: slash !== -1 ? key.slice(0, slash) : key,
        tokenCachePercent: promptTokens ? percentage((cacheRead / promptTokens) * 100) : 0,
        turns: group.length
      }
    })
    .sort((left, right) => right.promptTokens - left.promptTokens)
}

export function formatUsageRollup(rows: UsageRollupRow[]): string {
  if (rows.length === 0) return 'No usage turns in the selected window.\n'
  const lines = [
    [
      'provider/model'.padEnd(36),
      'turns'.padStart(6),
      'token cache'.padStart(12),
      'call hit'.padStart(10),
      'estimated'.padStart(10),
      'median gap'.padStart(12)
    ].join(' '),
    [
      '-'.repeat(36),
      '-'.repeat(6),
      '-'.repeat(12),
      '-'.repeat(10),
      '-'.repeat(10),
      '-'.repeat(12)
    ].join(' ')
  ]
  for (const row of rows) {
    const id = `${row.provider}/${row.model}`
    lines.push(
      [
        id.slice(0, 36).padEnd(36),
        String(row.turns).padStart(6),
        `${row.tokenCachePercent.toFixed(1)}%`.padStart(12),
        `${row.callHitPercent.toFixed(1)}%`.padStart(10),
        `${row.estimatedPercent.toFixed(1)}%`.padStart(10),
        (row.medianGapMs === null ? '—' : `${String(row.medianGapMs)}ms`).padStart(12)
      ].join(' ')
    )
  }
  return `${lines.join('\n')}\n`
}
