import type {
  AgentConversationContextUsage,
  AgentConversationThread
} from '#mcp/agent-router/contracts'

export type MutableGenerationTiming = {
  firstTokenAt: number | null
  generatedCharacters: number
  generationBaseTokens: number | null
  generationElapsedMs: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function percentage(value: number): number {
  return Math.round(value * 10) / 10
}

export function approximateTokensFromCharacters(characters: number): number {
  return characters > 0 ? Math.max(1, Math.ceil(characters / 4)) : 0
}

export function metricText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(metricText).filter(Boolean).join('\n')
  if (!isRecord(value)) return ''
  if (typeof value.text === 'string') return value.text
  if (typeof value.thinking === 'string') return value.thinking
  if (Array.isArray(value.content)) return metricText(value.content)
  return ''
}

export function estimatedConversationTokens(thread: AgentConversationThread): number {
  const characters = thread.messages.reduce((total, message) => {
    let next = message.text.length
    for (const part of message.parts ?? []) {
      if (part.type === 'tool') {
        next += part.name.length
        next += part.input?.length ?? 0
        next += part.output?.length ?? 0
      } else if (
        part.type === 'reasoning' &&
        !['thinking', 'thought'].includes(part.text.trim().toLowerCase())
      ) {
        next += part.text.length
      }
    }
    return total + next
  }, 0)
  return approximateTokensFromCharacters(characters)
}

export function measuredTokensPerSecond(
  outputTokens: number,
  firstTokenAt: number | null,
  completedAt: number
): number | undefined {
  if (firstTokenAt === null || outputTokens <= 0) return undefined
  const elapsedMs = completedAt - firstTokenAt
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return undefined
  return percentage((outputTokens * 1_000) / elapsedMs)
}

export function retainedContextUsage(
  usage: AgentConversationContextUsage | undefined
): Partial<AgentConversationContextUsage> {
  if (!usage) return {}
  const retained: Partial<AgentConversationContextUsage> = {}
  if (usage.cacheHitPercent !== undefined) retained.cacheHitPercent = usage.cacheHitPercent
  if (usage.compactionStalled) retained.compactionStalled = true
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

export function baseContextUsage(
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
