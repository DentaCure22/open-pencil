import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import {
  approximateTokensFromCharacters,
  baseContextUsage,
  estimatedConversationTokens,
  measuredTokensPerSecond,
  metricText,
  percentage,
  retainedContextUsage,
  type MutableGenerationTiming
} from '#mcp/pi/telemetry-core'

const DEFAULT_CONTEXT_WINDOW = 1_000_000

export function isAntigravityModel(model: string): boolean {
  return model.startsWith('antigravity/')
}

export function hydrateAntigravityTelemetry(thread: AgentConversationThread): boolean {
  if (!isAntigravityModel(thread.model) || !thread.contextUsage) return false
  const estimatedTokens = estimatedConversationTokens(thread)
  const tokens = Math.max(thread.contextUsage.tokens ?? 0, estimatedTokens)
  const retained = retainedContextUsage(thread.contextUsage)
  thread.contextUsage = {
    autoCompactionEnabled: thread.contextUsage.autoCompactionEnabled,
    compacting: thread.contextUsage.compacting,
    contextWindow: thread.contextUsage.contextWindow,
    ...retained,
    percent: percentage((tokens / thread.contextUsage.contextWindow) * 100),
    tokens,
    tokensEstimated: true
  }
  return true
}

export function applyMeasuredAntigravityThroughput(
  thread: AgentConversationThread,
  outputTokens: number,
  generationElapsedMs: number
): boolean {
  if (!isAntigravityModel(thread.model) || !thread.contextUsage) return false
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return false
  if (!Number.isFinite(generationElapsedMs) || generationElapsedMs <= 0) return false
  thread.contextUsage = {
    ...thread.contextUsage,
    tokensPerSecond: percentage((outputTokens * 1_000) / generationElapsedMs),
    tokensPerSecondBasis: 'streamed-output'
  }
  delete thread.contextUsage.tokensPerSecondEstimated
  return true
}

export function applyMeasuredAntigravityUsage(
  thread: AgentConversationThread,
  usage: { cacheRead: number; input: number; output: number; reasoning?: number },
  generationElapsedMs: number
): boolean {
  if (!isAntigravityModel(thread.model)) return false
  const input = Math.max(0, usage.input)
  const cacheRead = Math.max(0, usage.cacheRead)
  const output = Math.max(0, usage.output)
  const prompt = input + cacheRead
  const tokens = prompt + output
  if (tokens <= 0) return false
  const contextWindow = thread.contextUsage?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const tokensPerSecond =
    Number.isFinite(generationElapsedMs) && generationElapsedMs > 0 && output > 0
      ? percentage((output * 1_000) / generationElapsedMs)
      : undefined
  thread.contextUsage = {
    ...baseContextUsage(thread, contextWindow),
    ...(prompt > 0 ? { cacheHitPercent: percentage((cacheRead / prompt) * 100) } : {}),
    percent: percentage((tokens / contextWindow) * 100),
    tokens,
    ...(tokensPerSecond !== undefined
      ? { tokensPerSecond, tokensPerSecondBasis: 'streamed-output' as const }
      : {})
  }
  delete thread.contextUsage.tokensEstimated
  delete thread.contextUsage.tokensPerSecondEstimated
  return true
}

export function applyAntigravityCompletedTelemetry(
  thread: AgentConversationThread,
  timing: MutableGenerationTiming,
  message: Record<string, unknown>,
  now: number
): boolean {
  if (!isAntigravityModel(thread.model) || !thread.contextUsage) return false
  const estimatedOutput = Math.max(
    approximateTokensFromCharacters(timing.generatedCharacters),
    approximateTokensFromCharacters(metricText(message).length)
  )
  const tokensPerSecond = measuredTokensPerSecond(estimatedOutput, timing.firstTokenAt, now)
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
    tokensEstimated: true,
    ...(tokensPerSecond !== undefined
      ? {
          tokensPerSecond,
          tokensPerSecondBasis: 'streamed-output' as const,
          tokensPerSecondEstimated: true
        }
      : {})
  }
  return true
}

export function applyAntigravityStreamingTelemetry(
  thread: AgentConversationThread,
  timing: MutableGenerationTiming,
  now: number
): boolean {
  if (!isAntigravityModel(thread.model) || !thread.contextUsage) return false
  const output = approximateTokensFromCharacters(timing.generatedCharacters)
  const baseTokens = timing.generationBaseTokens ?? estimatedConversationTokens(thread)
  const tokens = Math.max(baseTokens + output, estimatedConversationTokens(thread))
  const tokensPerSecond = measuredTokensPerSecond(output, timing.firstTokenAt, now)
  thread.contextUsage = {
    ...thread.contextUsage,
    percent: percentage((tokens / thread.contextUsage.contextWindow) * 100),
    tokens,
    tokensEstimated: true,
    ...(tokensPerSecond !== undefined
      ? {
          tokensPerSecond,
          tokensPerSecondBasis: 'streamed-output' as const,
          tokensPerSecondEstimated: true
        }
      : {})
  }
  return true
}
