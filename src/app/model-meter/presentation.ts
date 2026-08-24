import type { ModelMeterRow, ModelMeterSnapshot } from './types'

export type ModelMeterTotals = {
  callHitPercent: number
  cacheTokens: number
  estimatedPercent: number
  models: number
  promptTokens: number
  tokenCachePercent: number
  turns: number
}

export const MODEL_METER_WINDOWS = [1, 7, 30] as const

export function percentage(value: number): number {
  return Math.round(value * 10) / 10
}

export function formatMeterPercent(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')}%`
}

export function formatMeterTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(Math.round(value))
}

export function formatMeterWhen(value: string | null): string {
  if (!value) return 'No turns yet'
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return 'Recently'
  const deltaMs = Date.now() - at
  if (deltaMs < 45_000) return 'Just now'
  if (deltaMs < 3_600_000) return `${String(Math.max(1, Math.round(deltaMs / 60_000)))}m ago`
  if (deltaMs < 86_400_000) return `${String(Math.max(1, Math.round(deltaMs / 3_600_000)))}h ago`
  return new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short'
  })
}

export function modelMeterProviderLabel(provider: string): string {
  if (provider.startsWith('xai')) return 'xAI'
  if (provider.startsWith('antigravity')) return 'Antigravity'
  if (provider.startsWith('openai')) return 'OpenAI'
  if (provider.startsWith('cursor')) return 'Cursor'
  return provider
}

export function modelMeterName(model: string): string {
  const titled = model
    .replace(/^cursor-/, 'Cursor-')
    .replace(/^gemini-/, 'Gemini ')
    .replace(/^grok-/, 'Grok ')
    .replace(/^gpt-/, 'GPT ')
  return titled
    .split('-')
    .map((part, index) => {
      if (index === 0 || /^\d/.test(part)) return part
      return `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    })
    .join(' ')
    .replace(/(\d) (\d)/g, '$1.$2')
}

export function modelMeterShortName(model: string): string {
  return modelMeterName(model)
    .replace(/ Flash$/, '')
    .replace(/ Fast$/, '')
    .replace(/^Cursor Grok /, 'Cursor ')
}

export const MODEL_METER_SWATCHES = ['bg-accent', 'bg-component', 'bg-amber-400'] as const

export function modelMeterSwatch(index: number): string {
  return MODEL_METER_SWATCHES[index % MODEL_METER_SWATCHES.length] ?? 'bg-accent'
}

export function modelMeterTotals(snapshot: Pick<ModelMeterSnapshot, 'rows' | 'turns'>): ModelMeterTotals {
  const promptTokens = snapshot.rows.reduce((total, row) => total + row.promptTokens, 0)
  const cacheRead = snapshot.rows.reduce(
    (total, row) => total + (row.tokenCachePercent / 100) * row.promptTokens,
    0
  )
  const hits = snapshot.rows.reduce((total, row) => total + (row.callHitPercent / 100) * row.turns, 0)
  const estimated = snapshot.rows.reduce(
    (total, row) => total + (row.estimatedPercent / 100) * row.turns,
    0
  )
  return {
    callHitPercent: snapshot.turns ? percentage((hits / snapshot.turns) * 100) : 0,
    cacheTokens: Math.round(cacheRead),
    estimatedPercent: snapshot.turns ? percentage((estimated / snapshot.turns) * 100) : 0,
    models: snapshot.rows.length,
    promptTokens,
    tokenCachePercent: promptTokens ? percentage((cacheRead / promptTokens) * 100) : 0,
    turns: snapshot.turns
  }
}

export function modelMeterBarWidth(value: number): string {
  return `${String(Math.min(100, Math.max(0, value)))}%`
}

export function modelMeterTone(value: number): 'empty' | 'low' | 'mid' | 'high' {
  if (value <= 0) return 'empty'
  if (value < 25) return 'low'
  if (value < 70) return 'mid'
  return 'high'
}

export function modelSharePercent(row: ModelMeterRow, promptTokens: number): number {
  if (promptTokens <= 0) return 0
  return percentage((row.promptTokens / promptTokens) * 100)
}

export const MODEL_METER_RING_RADIUS = 46
export const MODEL_METER_RING_CIRCUMFERENCE = 2 * Math.PI * MODEL_METER_RING_RADIUS

export function modelMeterRingDash(percent: number): { dash: number; gap: number } {
  const dash = (Math.min(100, Math.max(0, percent)) / 100) * MODEL_METER_RING_CIRCUMFERENCE
  return { dash, gap: MODEL_METER_RING_CIRCUMFERENCE - dash }
}

export type ModelMeterChartRow = {
  cachePercent: number
  cacheShare: number
  callHitPercent: number
  freshShare: number
  key: string
  label: string
  lastAt: string | null
  promptTokens: number
  provider: string
  share: number
  shortLabel: string
  turns: number
}

export function modelMeterLinePath(
  points: { cachePercent: number }[],
  width = 100,
  height = 40
): string {
  if (points.length === 0) return ''
  const yFor = (percent: number) =>
    height - (Math.min(100, Math.max(0, percent)) / 100) * height
  if (points.length === 1) {
    const y = yFor(points[0]?.cachePercent ?? 0)
    return `M 0 ${y.toFixed(2)} L ${String(width)} ${y.toFixed(2)}`
  }
  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width
      const y = yFor(point.cachePercent)
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

export function modelMeterAreaPath(
  points: { cachePercent: number }[],
  width = 100,
  height = 40
): string {
  const line = modelMeterLinePath(points, width, height)
  if (!line) return ''
  return `${line} L ${String(width)} ${String(height)} L 0 ${String(height)} Z`
}

export function modelMeterChartRows(rows: ModelMeterRow[]): ModelMeterChartRow[] {
  const maxPrompt = Math.max(...rows.map((row) => row.promptTokens), 1)
  const promptTokens = rows.reduce((total, row) => total + row.promptTokens, 0)
  return rows.map((row) => {
    const share = (row.promptTokens / maxPrompt) * 100
    const cacheShare = share * (Math.min(100, Math.max(0, row.tokenCachePercent)) / 100)
    return {
      cachePercent: row.tokenCachePercent,
      cacheShare,
      callHitPercent: row.callHitPercent,
      freshShare: Math.max(0, share - cacheShare),
      key: `${row.provider}/${row.model}`,
      label: modelMeterName(row.model),
      lastAt: row.lastAt,
      promptTokens: row.promptTokens,
      provider: modelMeterProviderLabel(row.provider),
      share: modelSharePercent(row, promptTokens),
      shortLabel: modelMeterShortName(row.model),
      turns: row.turns
    }
  })
}
