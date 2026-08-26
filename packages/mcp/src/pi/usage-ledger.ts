import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import {
  buildUsageTurnRecord,
  cacheHitPercent,
  emptyUsageTokens,
  parseUsageTokens,
  parseUsageTurnRecord,
  percentage,
  promptTokens,
  type UsageSource,
  type UsageTokens,
  type UsageTurnRecord
} from '#mcp/usage-ledger-schema'

export {
  buildUsageTurnRecord,
  cacheHitPercent,
  emptyUsageTokens,
  parseUsageTokens,
  parseUsageTurnRecord,
  percentage,
  promptTokens
}
export type {
  UsageProbeScenario,
  UsageSource,
  UsageTokens,
  UsageTurnRecord,
  UsageTurnSource
} from '#mcp/usage-ledger-schema'

export type LiveUsageTurnInput = {
  at?: string
  sessionId?: string | null
  tokens: UsageTokens
  usageSource: UsageSource
}

const DEFAULT_LEDGER_FILE = 'turns.jsonl'

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code)
}

export function usageTokensAreZero(tokens: UsageTokens): boolean {
  return (
    tokens.cacheRead === 0 &&
    tokens.cacheWrite === 0 &&
    tokens.input === 0 &&
    tokens.output === 0 &&
    tokens.reasoning === 0
  )
}

export function defaultUsageLedgerPath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir()
): string {
  const override = env.OPENPENCIL_MODEL_METER_LOG?.trim()
  if (override) return path.resolve(override)
  return path.join(home, '.openpencil', 'model-meter', DEFAULT_LEDGER_FILE)
}

export type UsageRollupRow = {
  callHitPercent: number
  estimatedPercent: number
  lastAt: string | null
  model: string
  promptTokens: number
  provider: string
  tokenCachePercent: number
  turns: number
}

export type UsageRollupPoint = {
  at: string
  cachePercent: number
}

export type UsageRollupSnapshot = {
  days: number
  lastAt: string | null
  rows: UsageRollupRow[]
  series: UsageRollupPoint[]
  turns: number
}

const MAX_SERIES_POINTS = 80

function downsampleTurns(turns: UsageTurnRecord[]): UsageTurnRecord[] {
  if (turns.length <= MAX_SERIES_POINTS) return turns
  const fallback = turns.at(-1)
  if (!fallback) return turns
  const step = (turns.length - 1) / (MAX_SERIES_POINTS - 1)
  return Array.from({ length: MAX_SERIES_POINTS }, (_, index) => {
    const turn = turns[Math.round(index * step)]
    return turn ?? fallback
  })
}

function seriesFromTurns(turns: UsageTurnRecord[]): UsageRollupPoint[] {
  const sorted = [...turns].sort((left, right) => left.at.localeCompare(right.at))
  return downsampleTurns(sorted).map((turn) => ({
    at: turn.at,
    cachePercent: turn.promptTokens > 0 ? percentage((turn.cacheRead / turn.promptTokens) * 100) : 0
  }))
}

export function rollupUsageSnapshot(turns: UsageTurnRecord[], days = 7): UsageRollupSnapshot {
  const sinceMs = Date.now() - days * 86_400_000
  const recent = turns.filter((turn) => {
    const at = Date.parse(turn.at)
    return Number.isFinite(at) && at >= sinceMs
  })
  const groups = new Map<string, UsageTurnRecord[]>()
  for (const turn of recent) {
    const key = `${turn.provider}/${turn.model}`
    const group = groups.get(key) ?? []
    group.push(turn)
    groups.set(key, group)
  }
  const rows: UsageRollupRow[] = [...groups.entries()]
    .map(([key, group]) => {
      const prompt = group.reduce((total, turn) => total + turn.promptTokens, 0)
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
        promptTokens: prompt,
        provider: slash !== -1 ? key.slice(0, slash) : key,
        tokenCachePercent: prompt ? percentage((cacheRead / prompt) * 100) : 0,
        turns: group.length
      }
    })
    .sort((left, right) => right.promptTokens - left.promptTokens)
  return {
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

export function usageLedgerThreadId(
  thread: Pick<AgentConversationThread, 'id' | 'sessionId'>
): string {
  return thread.sessionId?.trim() || thread.id
}

export function usageTurnIndex(thread: Pick<AgentConversationThread, 'messages'>): number {
  return thread.messages.filter((message) => message.role === 'user').length
}

export function usageTurnGapMs(thread: Pick<AgentConversationThread, 'messages'>): number | null {
  const users = thread.messages.filter((message) => message.role === 'user')
  const current = users.at(-1)
  const previous = users.at(-2)
  if (!current || !previous) return null
  const currentAt = Date.parse(current.createdAt)
  const previousAt = Date.parse(previous.createdAt)
  if (!Number.isFinite(currentAt) || !Number.isFinite(previousAt)) return null
  return Math.max(0, currentAt - previousAt)
}

export function usageTurnToolsPresent(thread: Pick<AgentConversationThread, 'messages'>): boolean {
  const lastUser = thread.messages.findLastIndex((message) => message.role === 'user')
  if (lastUser === -1) return false
  return thread.messages
    .slice(lastUser + 1)
    .some((message) => (message.parts ?? []).some((part) => part.type === 'tool'))
}

export function usageTurnCompacted(
  thread: Pick<AgentConversationThread, 'contextUsage' | 'messages'>
): boolean {
  const compactedAt = thread.contextUsage?.lastCompactedAt
  if (!compactedAt) return false
  const lastUser = thread.messages.findLast((message) => message.role === 'user')
  if (!lastUser) return true
  return compactedAt >= lastUser.createdAt
}

export function buildLiveUsageTurn(
  thread: AgentConversationThread,
  input: LiveUsageTurnInput
): UsageTurnRecord {
  return buildUsageTurnRecord({
    at: input.at,
    compacted: usageTurnCompacted(thread),
    gapMs: usageTurnGapMs(thread),
    modelId: thread.model,
    source: 'live',
    threadId: input.sessionId?.trim() || usageLedgerThreadId(thread),
    tokens: input.tokens,
    toolsPresent: usageTurnToolsPresent(thread),
    turnIndex: usageTurnIndex(thread),
    usageSource: input.usageSource
  })
}

export async function readUsageTurns(filePath: string): Promise<UsageTurnRecord[]> {
  try {
    const text = await readFile(filePath, 'utf8')
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const record = parseUsageTurnRecord(JSON.parse(line) as unknown)
          return record ? [record] : []
        } catch {
          return []
        }
      })
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return []
    throw error
  }
}

export async function appendUsageTurn(
  record: UsageTurnRecord,
  filePath = defaultUsageLedgerPath()
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8')
}

export async function appendUsageTurnBestEffort(
  record: UsageTurnRecord,
  filePath = defaultUsageLedgerPath()
): Promise<void> {
  try {
    await appendUsageTurn(record, filePath)
  } catch (error) {
    console.warn('[Usage ledger] Could not append metering record:', error)
  }
}
