import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'
import type { MutableGenerationTiming } from '#mcp/pi/telemetry-core'
import type { UsageSource, UsageTokens } from '#mcp/pi/usage-ledger'

import { pendingAntigravityOutput } from './antigravity/activity'
import {
  applyAntigravityCompletedTelemetry,
  applyAntigravityStreamingTelemetry,
  applyMeasuredAntigravityUsage,
  hydrateAntigravityTelemetry,
  isAntigravityModel
} from './antigravity/telemetry'
import {
  captureAntigravityUsageCursor,
  readAntigravityTurnUsage,
  type AntigravityTokenUsage,
  type AntigravityUsageCursor
} from './antigravity/usage'

export type PiProviderTurnCursor = {
  adapterId: string
  value: unknown
}

export type PiProviderTurnUsage = {
  source: UsageSource
  tokens: UsageTokens
}

export interface PiProviderRuntime {
  beginTurn(model: string, sessionIds: readonly string[]): Promise<PiProviderTurnCursor | null>
  hydrateThread(thread: AgentConversationThread): boolean
  settleTurn(
    thread: AgentConversationThread,
    sessionIds: readonly string[],
    cursor: PiProviderTurnCursor,
    generationElapsedMs: number
  ): Promise<PiProviderTurnUsage | null>
}

type AntigravityTurnReader = {
  capture(sessionIds: readonly string[]): Promise<AntigravityUsageCursor | null>
  read(
    sessionIds: readonly string[],
    cursor: AntigravityUsageCursor
  ): Promise<AntigravityTokenUsage | null>
}

export type DefaultPiProviderRuntimeOptions = {
  antigravity?: Partial<AntigravityTurnReader>
}

export class DefaultPiProviderRuntime implements PiProviderRuntime {
  private readonly antigravity: AntigravityTurnReader

  constructor(options: DefaultPiProviderRuntimeOptions = {}) {
    this.antigravity = {
      capture: options.antigravity?.capture ?? captureAntigravityUsageCursor,
      read: options.antigravity?.read ?? readAntigravityTurnUsage
    }
  }

  async beginTurn(
    model: string,
    sessionIds: readonly string[]
  ): Promise<PiProviderTurnCursor | null> {
    if (!isAntigravityModel(model)) return null
    const value = await this.antigravity.capture(sessionIds)
    return value ? { adapterId: 'antigravity', value } : null
  }

  hydrateThread(thread: AgentConversationThread): boolean {
    return hydrateProviderTelemetry(thread)
  }

  async settleTurn(
    thread: AgentConversationThread,
    sessionIds: readonly string[],
    cursor: PiProviderTurnCursor,
    generationElapsedMs: number
  ): Promise<PiProviderTurnUsage | null> {
    if (cursor.adapterId !== 'antigravity' || !isAntigravityModel(thread.model)) return null
    const usage = await this.antigravity.read(sessionIds, cursor.value as AntigravityUsageCursor)
    if (!usage) return null
    applyMeasuredAntigravityUsage(thread, usage, generationElapsedMs)
    return {
      source: 'agy-sqlite',
      tokens: {
        cacheRead: usage.cacheRead,
        cacheWrite: 0,
        input: usage.input,
        output: usage.output,
        reasoning: usage.reasoning
      }
    }
  }
}

type PiProviderTelemetryAdapter = {
  applyCompleted(
    thread: AgentConversationThread,
    timing: MutableGenerationTiming,
    message: Record<string, unknown>,
    now: number
  ): boolean
  applyStreaming(
    thread: AgentConversationThread,
    timing: MutableGenerationTiming,
    now: number
  ): boolean
  hydrate(thread: AgentConversationThread): boolean
  matches(model: string): boolean
}

const TELEMETRY_ADAPTERS: readonly PiProviderTelemetryAdapter[] = [
  {
    applyCompleted: applyAntigravityCompletedTelemetry,
    applyStreaming: applyAntigravityStreamingTelemetry,
    hydrate: hydrateAntigravityTelemetry,
    matches: isAntigravityModel
  }
]

function telemetryAdapter(thread: AgentConversationThread): PiProviderTelemetryAdapter | undefined {
  return TELEMETRY_ADAPTERS.find((adapter) => adapter.matches(thread.model))
}

export function hydrateProviderTelemetry(thread: AgentConversationThread): boolean {
  return telemetryAdapter(thread)?.hydrate(thread) ?? false
}

export function applyProviderCompletedTelemetry(
  thread: AgentConversationThread,
  timing: MutableGenerationTiming,
  message: Record<string, unknown>,
  now: number
): boolean {
  return telemetryAdapter(thread)?.applyCompleted(thread, timing, message, now) ?? false
}

export function applyProviderStreamingTelemetry(
  thread: AgentConversationThread,
  timing: MutableGenerationTiming,
  now: number
): boolean {
  return telemetryAdapter(thread)?.applyStreaming(thread, timing, now) ?? false
}

export function isPendingProviderOutput(value?: string): boolean {
  return [pendingAntigravityOutput].some((predicate) => predicate(value))
}

export function isPendingProviderHeartbeat(message: AgentConversationMessage): boolean {
  return Boolean(
    message.id.startsWith('pi-agy-tool:') &&
    message.parts?.some(
      (part) =>
        part.type === 'tool' &&
        typeof part.output === 'string' &&
        isPendingProviderOutput(part.output)
    )
  )
}
