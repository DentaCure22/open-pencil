import type {
  AgentConversationContextUsage,
  AgentConversationThread
} from '#mcp/agent-router/contracts'

import { applyCompactionStall } from './compaction-stall'
import {
  applyProviderCompletedTelemetry,
  applyProviderStreamingTelemetry,
  hydrateProviderTelemetry
} from './providers'
import {
  baseContextUsage,
  estimatedConversationTokens,
  measuredTokensPerSecond,
  percentage,
  type MutableGenerationTiming
} from './telemetry-core'
import { compactAgentThreadMemory } from './thread-memory'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function resetActiveGenerationTiming(timing: MutableGenerationTiming): void {
  timing.firstTokenAt = null
  timing.generatedCharacters = 0
  timing.generationBaseTokens = null
}

function resetGenerationTiming(timing: MutableGenerationTiming): void {
  resetActiveGenerationTiming(timing)
  timing.generationElapsedMs = 0
}

function finishGenerationTiming(timing: MutableGenerationTiming, completedAt: number): void {
  if (timing.firstTokenAt === null) return
  const elapsedMs = completedAt - timing.firstTokenAt
  if (Number.isFinite(elapsedMs) && elapsedMs > 0) timing.generationElapsedMs += elapsedMs
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
  if ((tokens ?? 0) === 0) hydrateProviderTelemetry(thread)
  applyCompactionStall(thread)
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
    if (completed) compactAgentThreadMemory(thread)
    if (completed) {
      applyCompactionStall(thread, {
        estimatedTokensAfter: isRecord(event.result)
          ? finiteNumber(event.result.estimatedTokensAfter)
          : undefined
      })
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
  if (message.role !== 'assistant') {
    resetActiveGenerationTiming(timing)
    return false
  }
  finishGenerationTiming(timing, now)
  if (!isRecord(message.usage) || !thread.contextUsage) {
    resetActiveGenerationTiming(timing)
    return false
  }
  const { output, ...context } = usageContext(message.usage, thread.contextUsage.contextWindow)
  if (output === 0 && context.tokens === 0) {
    const applied = applyProviderCompletedTelemetry(thread, timing, message, now)
    if (!applied) return false
    resetActiveGenerationTiming(timing)
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
  resetActiveGenerationTiming(timing)
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
  if (applyProviderStreamingTelemetry(thread, timing, now)) return true
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
    const applied = applyAssistantEndTelemetry(thread, timing, event, now)
    if (applied) applyCompactionStall(thread)
    return applied
  }
  return applyCompactionTelemetry(thread, timing, event, now)
}
