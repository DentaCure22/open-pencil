import type { AgentConversationThread } from '#mcp/agent-router/contracts'

import { antigravityResolvedOutput } from './antigravity/activity'
import {
  antigravityThinkingBlockKey,
  syncAntigravityActivities,
  syncAntigravityThought
} from './antigravity/events'
import { isAntigravityModel } from './antigravity/telemetry'

type ProviderEventAdapter = {
  matches(model: string): boolean
  normalizeToolOutput(name: string, output: string): string
  syncActivities(
    thread: AgentConversationThread,
    value: unknown,
    turnKey: string,
    contentIndex: number,
    now: string,
    streaming: boolean
  ): string | null
  syncThought(
    thread: AgentConversationThread,
    value: unknown,
    turnKey: string,
    contentIndex: number,
    now: string,
    complete: boolean
  ): string | null
  thinkingBlockKey(
    thread: AgentConversationThread,
    turnKey: string,
    contentIndex: number,
    start: boolean
  ): string
}

const EVENT_ADAPTERS: readonly ProviderEventAdapter[] = [
  {
    matches: isAntigravityModel,
    normalizeToolOutput: antigravityResolvedOutput,
    syncActivities: syncAntigravityActivities,
    syncThought: syncAntigravityThought,
    thinkingBlockKey: antigravityThinkingBlockKey
  }
]

function eventAdapter(thread: AgentConversationThread): ProviderEventAdapter | undefined {
  return EVENT_ADAPTERS.find((adapter) => adapter.matches(thread.model))
}

export function providerOwnsThinking(thread: AgentConversationThread): boolean {
  return Boolean(eventAdapter(thread))
}

export function providerThinkingBlockKey(
  thread: AgentConversationThread,
  turnKey: string,
  contentIndex: number,
  start: boolean
): string {
  return eventAdapter(thread)?.thinkingBlockKey(thread, turnKey, contentIndex, start) ?? turnKey
}

export function syncProviderThought(
  thread: AgentConversationThread,
  value: unknown,
  turnKey: string,
  contentIndex: number,
  now: string,
  complete: boolean
): string | null {
  return (
    eventAdapter(thread)?.syncThought(thread, value, turnKey, contentIndex, now, complete) ?? null
  )
}

export function syncProviderActivities(
  thread: AgentConversationThread,
  value: unknown,
  turnKey: string,
  contentIndex: number,
  now: string,
  streaming: boolean
): string | null {
  for (const adapter of EVENT_ADAPTERS) {
    const status = adapter.syncActivities(thread, value, turnKey, contentIndex, now, streaming)
    if (status) return status
  }
  return null
}

export function normalizeProviderToolOutput(name: string, output: string): string {
  return EVENT_ADAPTERS.reduce(
    (current, adapter) => adapter.normalizeToolOutput(name, current),
    output
  )
}
