import { IS_BROWSER } from '@open-pencil/core/constants'

import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'
import { isTauri } from '@/app/tauri/env'

import { emptyModelMeterSnapshot, parseModelMeterTurns, rollupModelMeterTurns } from './rollup'
import type { ModelMeterRow, ModelMeterSeriesPoint, ModelMeterSnapshot } from './types'

const DEFAULT_DAYS = 7
const LEDGER_SEGMENTS = ['.openpencil', 'model-meter', 'turns.jsonl'] as const

export async function defaultModelMeterPath(): Promise<string | null> {
  if (!isTauri()) return null
  const { homeDir, join } = await import('@tauri-apps/api/path')
  return join(await homeDir(), ...LEDGER_SEGMENTS)
}

async function readLedgerText(filePath: string): Promise<string> {
  const { readFile } = await import('@tauri-apps/plugin-fs')
  return new TextDecoder().decode(await readFile(filePath))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseMeterRow(value: unknown): ModelMeterRow | null {
  if (!isRecord(value)) return null
  if (typeof value.model !== 'string' || typeof value.provider !== 'string') return null
  const callHitPercent = finiteNumber(value.callHitPercent)
  const estimatedPercent = finiteNumber(value.estimatedPercent)
  const promptTokens = finiteNumber(value.promptTokens)
  const tokenCachePercent = finiteNumber(value.tokenCachePercent)
  const turns = finiteNumber(value.turns)
  if (
    callHitPercent === null ||
    estimatedPercent === null ||
    promptTokens === null ||
    tokenCachePercent === null ||
    turns === null
  ) {
    return null
  }
  return {
    callHitPercent,
    estimatedPercent,
    lastAt: typeof value.lastAt === 'string' ? value.lastAt : null,
    model: value.model,
    promptTokens,
    provider: value.provider,
    tokenCachePercent,
    turns
  }
}

function parseSeriesPoint(value: unknown): ModelMeterSeriesPoint | null {
  if (!isRecord(value) || typeof value.at !== 'string') return null
  const cachePercent = finiteNumber(value.cachePercent)
  if (cachePercent === null) return null
  return { at: value.at, cachePercent }
}

export function parseModelMeterSnapshot(value: unknown, days = DEFAULT_DAYS): ModelMeterSnapshot | null {
  if (!isRecord(value) || value.available !== true || !Array.isArray(value.rows)) return null
  const rows = value.rows.map(parseMeterRow).filter((row): row is ModelMeterRow => row !== null)
  if (rows.length !== value.rows.length) return null
  const series = Array.isArray(value.series)
    ? value.series.map(parseSeriesPoint).filter((point): point is ModelMeterSeriesPoint => point !== null)
    : []
  return {
    available: true,
    days: finiteNumber(value.days) ?? days,
    lastAt: typeof value.lastAt === 'string' ? value.lastAt : null,
    rows,
    series,
    turns: finiteNumber(value.turns) ?? rows.reduce((total, row) => total + row.turns, 0)
  }
}

async function loadModelMeterFromVite(days: number): Promise<ModelMeterSnapshot | null> {
  if (!import.meta.env.DEV || !IS_BROWSER) return null
  try {
    const response = await fetch(`/__openpencil/model-meter?days=${String(days)}`, {
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return null
    const payload = (await response.json()) as unknown
    if (isRecord(payload) && payload.available === false) return null
    return parseModelMeterSnapshot(
      isRecord(payload) && payload.available === undefined ? { ...payload, available: true } : payload,
      days
    )
  } catch {
    return null
  }
}

async function loadModelMeterFromHttp(days: number): Promise<ModelMeterSnapshot | null> {
  try {
    const response = await localWorkspaceAuthorityFetch(
      `/agent-router/v1/pi/model-meter?days=${String(days)}`
    )
    if (!response.ok) return null
    return parseModelMeterSnapshot(await response.json(), days)
  } catch {
    return null
  }
}

async function loadModelMeterFromDisk(days: number): Promise<ModelMeterSnapshot | null> {
  if (!isTauri()) return null
  try {
    const filePath = await defaultModelMeterPath()
    if (!filePath) return null
    return rollupModelMeterTurns(parseModelMeterTurns(await readLedgerText(filePath)), days)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return emptyModelMeterSnapshot(days)
    return null
  }
}

export async function loadModelMeter(days = DEFAULT_DAYS): Promise<ModelMeterSnapshot> {
  return (
    (await loadModelMeterFromVite(days)) ??
    (await loadModelMeterFromHttp(days)) ??
    (await loadModelMeterFromDisk(days)) ??
    emptyModelMeterSnapshot(days, false)
  )
}
