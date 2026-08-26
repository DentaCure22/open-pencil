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

export type UsageTurnRecordInput = {
  at?: string
  compacted?: boolean
  gapMs?: number | null
  modelId: string
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

type UnknownRecord = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function usageSource(value: unknown): UsageSource | null {
  return value === 'agy-sqlite' || value === 'estimated' || value === 'pi-event' ? value : null
}

function turnSource(value: unknown): UsageTurnSource | null {
  return value === 'live' || value === 'probe' ? value : null
}

function probeScenario(value: unknown): UsageProbeScenario | undefined {
  return value === 'delay' || value === 'size' || value === 'warmup' ? value : undefined
}

export function percentage(value: number): number {
  return Math.round(value * 10) / 10
}

export function promptTokens(
  tokens: Pick<UsageTokens, 'cacheRead' | 'cacheWrite' | 'input'>
): number {
  return Math.max(0, tokens.input) + Math.max(0, tokens.cacheRead) + Math.max(0, tokens.cacheWrite)
}

export function cacheHitPercent(
  tokens: Pick<UsageTokens, 'cacheRead' | 'cacheWrite' | 'input'>
): number {
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

export function splitModelId(modelId: string): { model: string; provider: string } {
  const slash = modelId.indexOf('/')
  if (slash <= 0) return { model: modelId, provider: 'xai-auth' }
  const provider = modelId.slice(0, slash)
  return {
    model: modelId.slice(slash + 1),
    provider: provider === 'xai' ? 'xai-auth' : provider
  }
}

export function buildUsageTurnRecord(input: UsageTurnRecordInput): UsageTurnRecord {
  const { model, provider } = splitModelId(input.modelId)
  const tokens = parseUsageTokens(input.tokens)
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

export function parseUsageTurnRecord(value: unknown): UsageTurnRecord | null {
  if (!isRecord(value) || typeof value.at !== 'string') return null
  if (typeof value.model !== 'string' || typeof value.provider !== 'string') return null
  if (typeof value.threadId !== 'string') return null
  const source = turnSource(value.source)
  const parsedUsageSource = usageSource(value.usageSource)
  if (!source || !parsedUsageSource) return null
  if (typeof value.turnIndex !== 'number' || !Number.isFinite(value.turnIndex)) return null
  const scenario = probeScenario(value.scenario)
  const targetPromptTokens = optionalFiniteNumber(value.targetPromptTokens)
  const waitMs = optionalFiniteNumber(value.waitMs)
  return buildUsageTurnRecord({
    at: value.at,
    compacted: value.compacted === true,
    gapMs: optionalFiniteNumber(value.gapMs) ?? null,
    modelId: `${value.provider}/${value.model}`,
    source,
    threadId: value.threadId,
    tokens: parseUsageTokens(value),
    toolsPresent: value.toolsPresent === true,
    turnIndex: value.turnIndex,
    usageSource: parsedUsageSource,
    ...(scenario ? { scenario } : {}),
    ...(targetPromptTokens !== undefined ? { targetPromptTokens } : {}),
    ...(waitMs !== undefined ? { waitMs } : {})
  })
}
