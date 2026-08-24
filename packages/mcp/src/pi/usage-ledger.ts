import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'

import { parsePiModelId } from './arguments'

export type UsageSource = 'agy-sqlite' | 'estimated' | 'pi-event'
export type UsageTurnSource = 'live' | 'probe'
export type UsageProbeScenario = 'delay' | 'size' | 'warmup'

export type UsageTokens = {
  cacheRead: number
  cacheWrite: number
  input: number
  output: number
  reasoning: number
}

export type UsageTurnRecord = {
  at: string
  cacheHitPercent: number
  cacheRead: number
  cacheWrite: number
  compacted: boolean
  gapMs: number | null
  input: number
  model: string
  output: number
  promptTokens: number
  provider: string
  reasoning: number
  source: UsageTurnSource
  threadId: string
  toolsPresent: boolean
  turnIndex: number
  usageSource: UsageSource
  scenario?: UsageProbeScenario
  targetPromptTokens?: number
  waitMs?: number
}

export type LiveUsageTurnInput = {
  at?: string
  sessionId?: string | null
  tokens: UsageTokens
  usageSource: UsageSource
}

const DEFAULT_LEDGER_FILE = 'turns.jsonl'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function percentage(value: number): number {
  return Math.round(value * 10) / 10
}

export function promptTokens(tokens: Pick<UsageTokens, 'cacheRead' | 'cacheWrite' | 'input'>): number {
  return Math.max(0, tokens.input) + Math.max(0, tokens.cacheRead) + Math.max(0, tokens.cacheWrite)
}

export function cacheHitPercent(tokens: Pick<UsageTokens, 'cacheRead' | 'cacheWrite' | 'input'>): number {
  const prompt = promptTokens(tokens)
  if (prompt <= 0) return 0
  return percentage((Math.max(0, tokens.cacheRead) / prompt) * 100)
}

export function emptyUsageTokens(): UsageTokens {
  return { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, reasoning: 0 }
}

export function parseUsageTokens(value: unknown): UsageTokens {
  if (!isRecord(value)) return emptyUsageTokens()
  return {
    cacheRead: Math.max(0, finiteNumber(value.cacheRead)),
    cacheWrite: Math.max(0, finiteNumber(value.cacheWrite)),
    input: Math.max(0, finiteNumber(value.input)),
    output: Math.max(0, finiteNumber(value.output)),
    reasoning: Math.max(0, finiteNumber(value.reasoning))
  }
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
  const step = (turns.length - 1) / (MAX_SERIES_POINTS - 1)
  return Array.from({ length: MAX_SERIES_POINTS }, (_, index) => {
    const turn = turns[Math.round(index * step)]
    return turn ?? turns[turns.length - 1]!
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
        model: slash >= 0 ? key.slice(slash + 1) : key,
        promptTokens: prompt,
        provider: slash >= 0 ? key.slice(0, slash) : key,
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

export function usageLedgerThreadId(thread: Pick<AgentConversationThread, 'id' | 'sessionId'>): string {
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
  if (lastUser < 0) return false
  return thread.messages.slice(lastUser + 1).some((message) =>
    (message.parts ?? []).some((part) => part.type === 'tool')
  )
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

export function buildUsageTurnRecord(
  input: {
    at?: string
    compacted?: boolean
    gapMs?: number | null
    model: string
    scenario?: UsageProbeScenario
    source: UsageTurnSource
    targetPromptTokens?: number
    threadId: string
    tokens: UsageTokens
    toolsPresent?: boolean
    turnIndex: number
    usageSource: UsageSource
    waitMs?: number
  }
): UsageTurnRecord {
  const { model, provider } = parsePiModelId(input.model)
  const tokens = {
    cacheRead: Math.max(0, input.tokens.cacheRead),
    cacheWrite: Math.max(0, input.tokens.cacheWrite),
    input: Math.max(0, input.tokens.input),
    output: Math.max(0, input.tokens.output),
    reasoning: Math.max(0, input.tokens.reasoning)
  }
  return {
    at: input.at ?? new Date().toISOString(),
    cacheHitPercent: cacheHitPercent(tokens),
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cacheWrite,
    compacted: input.compacted === true,
    gapMs: input.gapMs ?? null,
    input: tokens.input,
    model,
    output: tokens.output,
    promptTokens: promptTokens(tokens),
    provider,
    reasoning: tokens.reasoning,
    source: input.source,
    threadId: input.threadId,
    toolsPresent: input.toolsPresent === true,
    turnIndex: input.turnIndex,
    usageSource: input.usageSource,
    ...(input.scenario ? { scenario: input.scenario } : {}),
    ...(input.targetPromptTokens !== undefined
      ? { targetPromptTokens: input.targetPromptTokens }
      : {}),
    ...(input.waitMs !== undefined ? { waitMs: input.waitMs } : {})
  }
}

export function buildLiveUsageTurn(
  thread: AgentConversationThread,
  input: LiveUsageTurnInput
): UsageTurnRecord {
  return buildUsageTurnRecord({
    at: input.at,
    compacted: usageTurnCompacted(thread),
    gapMs: usageTurnGapMs(thread),
    model: thread.model,
    source: 'live',
    threadId: input.sessionId?.trim() || usageLedgerThreadId(thread),
    tokens: input.tokens,
    toolsPresent: usageTurnToolsPresent(thread),
    turnIndex: usageTurnIndex(thread),
    usageSource: input.usageSource
  })
}

export function parseUsageTurnRecord(value: unknown): UsageTurnRecord | null {
  if (!isRecord(value) || typeof value.at !== 'string') return null
  if (typeof value.model !== 'string' || typeof value.provider !== 'string') return null
  if (typeof value.threadId !== 'string') return null
  if (value.source !== 'live' && value.source !== 'probe') return null
  if (
    value.usageSource !== 'agy-sqlite' &&
    value.usageSource !== 'estimated' &&
    value.usageSource !== 'pi-event'
  ) {
    return null
  }
  if (typeof value.turnIndex !== 'number' || !Number.isFinite(value.turnIndex)) return null
  const tokens = parseUsageTokens(value)
  return buildUsageTurnRecord({
    at: value.at,
    compacted: value.compacted === true,
    gapMs: typeof value.gapMs === 'number' && Number.isFinite(value.gapMs) ? value.gapMs : null,
    model: `${value.provider}/${value.model}`,
    source: value.source,
    threadId: value.threadId,
    tokens,
    toolsPresent: value.toolsPresent === true,
    turnIndex: value.turnIndex,
    usageSource: value.usageSource,
    ...(value.scenario === 'delay' || value.scenario === 'size' || value.scenario === 'warmup'
      ? { scenario: value.scenario }
      : {}),
    ...(typeof value.targetPromptTokens === 'number' && Number.isFinite(value.targetPromptTokens)
      ? { targetPromptTokens: value.targetPromptTokens }
      : {}),
    ...(typeof value.waitMs === 'number' && Number.isFinite(value.waitMs)
      ? { waitMs: value.waitMs }
      : {})
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
    if (isRecord(error) && error.code === 'ENOENT') return []
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
  } catch {
    // Metering must never fail a chat turn.
  }
}
