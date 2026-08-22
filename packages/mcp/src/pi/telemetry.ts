import type {
  AgentConversationContextUsage,
  AgentConversationThread
} from '#mcp/agent-router/contracts'

type MutableGenerationTiming = {
  firstTokenAt: number | null
  generatedCharacters: number
  generationBaseTokens: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function percentage(value: number): number {
  return Math.round(value * 10) / 10
}

function isAntigravityThread(thread: AgentConversationThread): boolean {
  return thread.model.startsWith('antigravity/')
}

function approximateTokensFromCharacters(characters: number): number {
  return characters > 0 ? Math.max(1, Math.ceil(characters / 4)) : 0
}

function metricText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(metricText).filter(Boolean).join('\n')
  if (!isRecord(value)) return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.thinking === 'string') return value.thinking
  if (Array.isArray(value.content)) return metricText(value.content)
  return ''
}

function messageCharacters(thread: AgentConversationThread): number {
  return thread.messages.reduce((total, message) => {
    let characters = message.text.length
    for (const part of message.parts ?? []) {
      if (part.type === 'tool') {
        characters += part.name.length
        characters += part.input?.length ?? 0
        characters += part.output?.length ?? 0
      } else if (
        part.type === 'reasoning' &&
        !['thinking', 'thought'].includes(part.text.trim().toLowerCase())
      ) {
        characters += part.text.length
      }
    }
    return total + characters
  }, 0)
}

function estimatedConversationTokens(thread: AgentConversationThread): number {
  return approximateTokensFromCharacters(messageCharacters(thread))
}

function resetGenerationTiming(timing: MutableGenerationTiming): void {
  timing.firstTokenAt = null
  timing.generatedCharacters = 0
  timing.generationBaseTokens = null
}

function measuredTokensPerSecond(
  outputTokens: number,
  firstTokenAt: number | null,
  completedAt: number
): number | undefined {
  if (firstTokenAt === null || outputTokens <= 0) return undefined
  const elapsedMs = completedAt - firstTokenAt
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return undefined
  return percentage((outputTokens * 1_000) / elapsedMs)
}

export function hydrateEstimatedAntigravityTelemetry(thread: AgentConversationThread): boolean {
  if (!isAntigravityThread(thread) || !thread.contextUsage) return false
  const estimatedTokens = estimatedConversationTokens(thread)
  const tokens = Math.max(thread.contextUsage.tokens ?? 0, estimatedTokens)
  thread.contextUsage = {
    autoCompactionEnabled: thread.contextUsage.autoCompactionEnabled,
    compacting: thread.contextUsage.compacting,
    contextWindow: thread.contextUsage.contextWindow,
    ...(thread.contextUsage.lastCompactedAt
      ? { lastCompactedAt: thread.contextUsage.lastCompactedAt }
      : {}),
    percent: percentage((tokens / thread.contextUsage.contextWindow) * 100),
    tokens,
    tokensEstimated: true
  }
  return true
}

function usageContext(
  usage: Record<string, unknown>,
  contextWindow: number
): Pick<AgentConversationContextUsage, 'cacheHitPercent' | 'percent' | 'tokens'> & {
  output: number
} {
  const input = Math.max(0, finiteNumber(usage.input) ?? 0)
  const output = Math.max(0, finiteNumber(usage.output) ?? 0)
  const cacheRead = Math.max(0, finiteNumber(usage.cacheRead) ?? 0)
  const cacheWrite = Math.max(0, finiteNumber(usage.cacheWrite) ?? 0)
  const total = Math.max(
    0,
    finiteNumber(usage.totalTokens) ?? input + output + cacheRead + cacheWrite
  )
  const prompt = input + cacheRead + cacheWrite
  return {
    ...(prompt > 0 ? { cacheHitPercent: percentage((cacheRead / prompt) * 100) } : {}),
    output,
    percent: percentage((total / contextWindow) * 100),
    tokens: total
  }
}

function modelContextWindow(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined
  const contextWindow = finiteNumber(value.contextWindow)
  return contextWindow && contextWindow > 0 ? contextWindow : undefined
}

function retainedContextUsage(
  usage: AgentConversationContextUsage | undefined
): Partial<AgentConversationContextUsage> {
  if (!usage) return {}
  const retained: Partial<AgentConversationContextUsage> = {}
  if (usage.cacheHitPercent !== undefined) retained.cacheHitPercent = usage.cacheHitPercent
  if (usage.lastCompactedAt) retained.lastCompactedAt = usage.lastCompactedAt
  if (usage.tokensEstimated !== undefined) retained.tokensEstimated = usage.tokensEstimated
  if (usage.tokensPerSecond !== undefined) retained.tokensPerSecond = usage.tokensPerSecond
  if (usage.tokensPerSecondBasis !== undefined) {
    retained.tokensPerSecondBasis = usage.tokensPerSecondBasis
  }
  if (usage.tokensPerSecondEstimated !== undefined) {
    retained.tokensPerSecondEstimated = usage.tokensPerSecondEstimated
  }
  return retained
}

function baseContextUsage(
  thread: AgentConversationThread,
  contextWindow: number,
  autoCompactionEnabled = thread.contextUsage?.autoCompactionEnabled ?? true
): AgentConversationContextUsage {
  return {
    autoCompactionEnabled,
    compacting: thread.contextUsage?.compacting ?? false,
    contextWindow,
    percent: thread.contextUsage?.percent ?? null,
    tokens: thread.contextUsage?.tokens ?? null,
    ...retainedContextUsage(thread.contextUsage)
  }
}

export function applyPiStateTelemetry(thread: AgentConversationThread, value: unknown): boolean {
  if (!isRecord(value)) return false
  const model = isRecord(value.model) ? value.model : value
  const contextWindow = modelContextWindow(model)
  if (!contextWindow) return false
  const autoCompactionEnabled =
    typeof value.autoCompactionEnabled === 'boolean'
      ? value.autoCompactionEnabled
      : (thread.contextUsage?.autoCompactionEnabled ?? true)
  thread.contextUsage = {
    ...baseContextUsage(thread, contextWindow, autoCompactionEnabled),
    ...(typeof value.isCompacting === 'boolean' ? { compacting: value.isCompacting } : {})
  }
  return true
}

export function applyPiSessionStats(thread: AgentConversationThread, value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.contextUsage)) return false
  const contextWindow = modelContextWindow(value.contextUsage)
  if (!contextWindow) return false
  const context = baseContextUsage(thread, contextWindow)
  const tokens = finiteNumber(value.contextUsage.tokens)
  const percent = finiteNumber(value.contextUsage.percent)
  let cacheHitPercent = context.cacheHitPercent
  if (isRecord(value.tokens)) {
    const input = Math.max(0, finiteNumber(value.tokens.input) ?? 0)
    const cacheRead = Math.max(0, finiteNumber(value.tokens.cacheRead) ?? 0)
    const cacheWrite = Math.max(0, finiteNumber(value.tokens.cacheWrite) ?? 0)
    const prompt = input + cacheRead + cacheWrite
    if (prompt > 0) cacheHitPercent = percentage((cacheRead / prompt) * 100)
  }
  thread.contextUsage = {
    ...context,
    ...(cacheHitPercent !== undefined ? { cacheHitPercent } : {}),
    percent: percent === undefined ? null : percentage(percent),
    tokens: tokens ?? null
  }
  delete thread.contextUsage.tokensEstimated
  if (isAntigravityThread(thread) && (tokens ?? 0) === 0) {
    hydrateEstimatedAntigravityTelemetry(thread)
  }
  return true
}

function applyCompactionTelemetry(
  thread: AgentConversationThread,
  timing: MutableGenerationTiming,
  event: Record<string, unknown>,
  now: number
): boolean {
  if (event.type === 'compaction_start') {
    resetGenerationTiming(timing)
    if (!thread.contextUsage) return false
    thread.contextUsage = { ...thread.contextUsage, compacting: true }
    return true
  }
  if (event.type === 'compaction_end') {
    resetGenerationTiming(timing)
    if (!thread.contextUsage) return false
    const completed = event.aborted !== true && isRecord(event.result)
    thread.contextUsage = {
      ...thread.contextUsage,
      compacting: false,
      percent: completed ? null : thread.contextUsage.percent,
      tokens: completed ? null : thread.contextUsage.tokens,
      ...(completed ? { lastCompactedAt: new Date(now).toISOString() } : {})
    }
    return true
  }
  return false
}

function applyAssistantEndTelemetry(
  thread: AgentConversationThread,
  timing: MutableGenerationTiming,
  event: Record<string, unknown>,
  now: number
): boolean {
  if (!isRecord(event.message)) return false
  const message = event.message
  if (message.role !== 'assistant' || !isRecord(message.usage) || !thread.contextUsage) {
    resetGenerationTiming(timing)
    return false
  }
  const { output, ...context } = usageContext(message.usage, thread.contextUsage.contextWindow)
  const antigravityFallback = isAntigravityThread(thread) && output === 0 && context.tokens === 0
  if (antigravityFallback) {
    const estimatedOutput = Math.max(
      approximateTokensFromCharacters(timing.generatedCharacters),
      approximateTokensFromCharacters(metricText(message).length)
    )
    const visibleTokens = estimatedConversationTokens(thread)
    const tokens = Math.max(
      visibleTokens,
      (timing.generationBaseTokens ?? visibleTokens) + estimatedOutput
    )
    thread.contextUsage = {
      autoCompactionEnabled: thread.contextUsage.autoCompactionEnabled,
      compacting: thread.contextUsage.compacting,
      contextWindow: thread.contextUsage.contextWindow,
      ...(thread.contextUsage.lastCompactedAt
        ? { lastCompactedAt: thread.contextUsage.lastCompactedAt }
        : {}),
      percent: percentage((tokens / thread.contextUsage.contextWindow) * 100),
      tokens,
      tokensEstimated: true
    }
    resetGenerationTiming(timing)
    return true
  }
  const tokensPerSecond = measuredTokensPerSecond(output, timing.firstTokenAt, now)
  thread.contextUsage = {
    ...thread.contextUsage,
    ...context,
    ...(tokensPerSecond !== undefined
      ? { tokensPerSecond, tokensPerSecondBasis: 'streamed-output' as const }
      : {})
  }
  delete thread.contextUsage.tokensEstimated
  delete thread.contextUsage.tokensPerSecondEstimated
  if (tokensPerSecond === undefined) {
    delete thread.contextUsage.tokensPerSecond
    delete thread.contextUsage.tokensPerSecondBasis
  }
  resetGenerationTiming(timing)
  return true
}

function applyMessageUpdateTelemetry(
  thread: AgentConversationThread,
  timing: MutableGenerationTiming,
  event: Record<string, unknown>,
  now: number
): boolean {
  const update = isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : null
  const delta = update && typeof update.delta === 'string' ? update.delta : ''
  if (!delta || !thread.contextUsage) return false
  timing.firstTokenAt ??= now
  timing.generatedCharacters += delta.length
  if (isAntigravityThread(thread)) {
    const output = approximateTokensFromCharacters(timing.generatedCharacters)
    const baseTokens = timing.generationBaseTokens ?? estimatedConversationTokens(thread)
    const tokens = Math.max(baseTokens + output, estimatedConversationTokens(thread))
    thread.contextUsage = {
      ...thread.contextUsage,
      percent: percentage((tokens / thread.contextUsage.contextWindow) * 100),
      tokens,
      tokensEstimated: true
    }
    return true
  }
  const usage = isRecord(event.usage) ? event.usage : null
  const output = usage ? Math.max(0, finiteNumber(usage.output) ?? 0) : 0
  const tokensPerSecond = measuredTokensPerSecond(output, timing.firstTokenAt, now)
  if (tokensPerSecond === undefined) return false
  thread.contextUsage = {
    ...thread.contextUsage,
    tokensPerSecond,
    tokensPerSecondBasis: 'streamed-output'
  }
  delete thread.contextUsage.tokensPerSecondEstimated
  return true
}

export function applyPiEventTelemetry(
  thread: AgentConversationThread,
  timing: MutableGenerationTiming,
  event: Record<string, unknown>,
  now = Date.now()
): boolean {
  if (event.type === 'message_start') {
    if (isRecord(event.message) && event.message.role === 'assistant') {
      timing.firstTokenAt = null
      timing.generatedCharacters = 0
      timing.generationBaseTokens = Math.max(
        thread.contextUsage?.tokens ?? 0,
        estimatedConversationTokens(thread)
      )
      if (thread.contextUsage) {
        const context = { ...thread.contextUsage }
        delete context.tokensPerSecond
        delete context.tokensPerSecondBasis
        delete context.tokensPerSecondEstimated
        thread.contextUsage = context
        return true
      }
    }
    return false
  }
  if (event.type === 'message_update') {
    return applyMessageUpdateTelemetry(thread, timing, event, now)
  }
  if (event.type === 'message_end') {
    return applyAssistantEndTelemetry(thread, timing, event, now)
  }
  return applyCompactionTelemetry(thread, timing, event, now)
}
