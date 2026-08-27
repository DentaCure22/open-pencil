import type { ModelMeterRow, ModelMeterSeriesPoint, ModelMeterSnapshot } from './types'

type UsageTurn = {
  at: string
  cacheRead: number
  model: string
  promptTokens: number
  provider: string
  usageSource: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

const MAX_SERIES_POINTS = 80

function percentage(value: number): number {
  return Math.round(value * 10) / 10
}

function turnCachePercent(turn: UsageTurn): number {
  if (turn.promptTokens <= 0) return 0
  return percentage((turn.cacheRead / turn.promptTokens) * 100)
}

function downsampleTurns(turns: UsageTurn[]): UsageTurn[] {
  if (turns.length <= MAX_SERIES_POINTS) return turns
  const step = (turns.length - 1) / (MAX_SERIES_POINTS - 1)
  return Array.from(
    { length: MAX_SERIES_POINTS },
    (_, index) => turns[Math.round(index * step)]
  )
}

function seriesFromTurns(turns: UsageTurn[]): ModelMeterSeriesPoint[] {
  const sorted = [...turns].sort((left, right) => left.at.localeCompare(right.at))
  return downsampleTurns(sorted).map((turn) => ({
    at: turn.at,
    cachePercent: turnCachePercent(turn)
  }))
}

export function parseModelMeterTurns(text: string): UsageTurn[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as unknown
        if (!isRecord(value) || typeof value.at !== 'string') return []
        if (typeof value.model !== 'string' || typeof value.provider !== 'string') return []
        const cacheRead = Math.max(0, finiteNumber(value.cacheRead))
        const input = Math.max(0, finiteNumber(value.input))
        const cacheWrite = Math.max(0, finiteNumber(value.cacheWrite))
        const promptTokens =
          typeof value.promptTokens === 'number' && Number.isFinite(value.promptTokens)
            ? Math.max(0, value.promptTokens)
            : input + cacheRead + cacheWrite
        return [
          {
            at: value.at,
            cacheRead,
            model: value.model,
            promptTokens,
            provider: value.provider,
            usageSource: typeof value.usageSource === 'string' ? value.usageSource : 'pi-event'
          }
        ]
      } catch {
        return []
      }
    })
}

export function rollupModelMeterTurns(turns: UsageTurn[], days = 7): ModelMeterSnapshot {
  const sinceMs = Date.now() - days * 86_400_000
  const recent = turns.filter((turn) => {
    const at = Date.parse(turn.at)
    return Number.isFinite(at) && at >= sinceMs
  })
  const groups = new Map<string, UsageTurn[]>()
  for (const turn of recent) {
    const key = `${turn.provider}/${turn.model}`
    const group = groups.get(key) ?? []
    group.push(turn)
    groups.set(key, group)
  }
  const rows: ModelMeterRow[] = [...groups.entries()]
    .map(([key, group]) => {
      const promptTokens = group.reduce((total, turn) => total + turn.promptTokens, 0)
      const cacheRead = group.reduce((total, turn) => total + turn.cacheRead, 0)
      const hits = group.filter((turn) => turn.cacheRead > 0).length
      const estimated = group.filter((turn) => turn.usageSource === 'estimated').length
      const lastAt = group.reduce<string | null>((latest, turn) => {
        if (!latest || turn.at > latest) return turn.at
        return latest
      }, null)
      const slash = key.indexOf('/')
      return {
        callHitPercent: group.length ? percentage((hits / group.length) * 100) : 0,
        estimatedPercent: group.length ? percentage((estimated / group.length) * 100) : 0,
        lastAt,
        model: slash !== -1 ? key.slice(slash + 1) : key,
        promptTokens,
        provider: slash !== -1 ? key.slice(0, slash) : key,
        tokenCachePercent: promptTokens ? percentage((cacheRead / promptTokens) * 100) : 0,
        turns: group.length
      }
    })
    .sort((left, right) => right.promptTokens - left.promptTokens)
  return {
    available: true,
    days,
    lastAt: rows.reduce<string | null>((latest, row) => {
      if (!row.lastAt) return latest
      if (!latest || row.lastAt > latest) return row.lastAt
      return latest
    }, null),
    rows,
    series: seriesFromTurns(recent),
    turns: recent.length
  }
}

export function emptyModelMeterSnapshot(days = 7, available = true): ModelMeterSnapshot {
  return { available, days, lastAt: null, rows: [], series: [], turns: 0 }
}
