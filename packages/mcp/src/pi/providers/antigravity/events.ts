import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'
import { latestUserTurnStart, safeActivityText, upsertMessage } from '#mcp/pi/event-core'
import { normalizedThreadText } from '#mcp/pi/thread-memory'

import {
  antigravityActivities,
  antigravityThoughtText,
  antigravityToolImages,
  pendingAntigravityOutput,
  type AntigravityActivity
} from './activity'
import { isAntigravityModel } from './telemetry'

const thinkingBlocks = new WeakMap<AgentConversationThread, Map<string, number>>()

function toolPrefix(turnKey: string, contentIndex: number): string {
  return `pi-agy-tool:${turnKey}:${String(contentIndex)}:`
}

function thoughtId(turnKey: string, contentIndex: number): string {
  return `pi-agy-thought:${turnKey}:${String(contentIndex)}`
}

function thinkingBlockOrdinals(
  thread: AgentConversationThread,
  turnKey: string,
  contentIndex: number
): number[] {
  const ordinals: number[] = []
  const firstThoughtId = thoughtId(turnKey, contentIndex)
  const firstToolPrefix = toolPrefix(turnKey, contentIndex)
  const thoughtPrefix = `pi-agy-thought:${turnKey}:block-`
  const activityPrefix = `pi-agy-tool:${turnKey}:block-`
  for (const message of thread.messages.slice(latestUserTurnStart(thread))) {
    if (message.id === firstThoughtId || message.id.startsWith(firstToolPrefix)) {
      ordinals.push(0)
      continue
    }
    let suffix = ''
    if (message.id.startsWith(thoughtPrefix)) suffix = message.id.slice(thoughtPrefix.length)
    else if (message.id.startsWith(activityPrefix)) suffix = message.id.slice(activityPrefix.length)
    if (!suffix) continue
    const [ordinal, index] = suffix.split(':')
    if (index === String(contentIndex) && /^\d+$/.test(ordinal)) {
      ordinals.push(Number(ordinal))
    }
  }
  return ordinals
}

export function antigravityThinkingBlockKey(
  thread: AgentConversationThread,
  turnKey: string,
  contentIndex: number,
  start: boolean
): string {
  let blocks = thinkingBlocks.get(thread)
  if (!blocks) {
    blocks = new Map()
    thinkingBlocks.set(thread, blocks)
  }
  const stateKey = `${turnKey}:${String(contentIndex)}`
  const existing = thinkingBlockOrdinals(thread, turnKey, contentIndex)
  let ordinal = blocks.get(stateKey) ?? Math.max(0, ...existing)
  if (start && existing.includes(ordinal)) ordinal = Math.max(...existing) + 1
  blocks.set(stateKey, ordinal)
  return ordinal === 0 ? turnKey : `${turnKey}:block-${String(ordinal)}`
}

function activityIdentity(activity: AntigravityActivity): { input?: string; name: string } {
  const input = activity.input ?? (activity.type === 'edit' ? activity.description : undefined)
  return {
    ...(input ? { input } : {}),
    name: activity.type === 'edit' ? 'edit' : activity.name
  }
}

function activityStatus(activity: AntigravityActivity): string {
  return activity.type === 'edit'
    ? `Editing ${activity.description}…`
    : `${activity.name.replaceAll('_', ' ')}…`
}

function activityIsPending(activity: AntigravityActivity): boolean {
  return typeof activity.output === 'string' && pendingAntigravityOutput(activity.output)
}

function activityPart(activity: AntigravityActivity, running: boolean) {
  const { input, name } = activityIdentity(activity)
  const images =
    activity.type === 'tool' ? antigravityToolImages(activity.name, activity.output ?? '') : []
  const isRunning = running || activityIsPending(activity)
  return {
    ...(input ? { input } : {}),
    ...(images.length ? { images } : {}),
    name,
    ...(activity.output ? { output: activity.output } : {}),
    state: isRunning ? ('running' as const) : ('success' as const),
    type: 'tool' as const
  }
}

function toolGroupPrefix(id: string): string | null {
  if (!id.startsWith('pi-agy-tool:')) return null
  const separator = id.lastIndexOf(':')
  if (separator === -1 || !/^\d+$/.test(id.slice(separator + 1))) return null
  return id.slice(0, separator + 1)
}

function reconcileCompletedActivities(
  thread: AgentConversationThread,
  activities: AntigravityActivity[],
  now: string
): boolean {
  const groups = new Map<string, AgentConversationMessage[]>()
  for (const message of thread.messages.slice(latestUserTurnStart(thread))) {
    const prefix = toolGroupPrefix(message.id)
    if (!prefix) continue
    const group = groups.get(prefix) ?? []
    group.push(message)
    groups.set(prefix, group)
  }
  const match = [...groups.values()].reverse().find(
    (messages) =>
      messages.length === activities.length &&
      messages.every((message, index) => {
        const part = message.parts?.find((candidate) => candidate.type === 'tool')
        const activity = activities[index]
        if (part?.type !== 'tool') return false
        const identity = activityIdentity(activity)
        return part.name === identity.name && (part.input ?? '') === (identity.input ?? '')
      })
  )
  if (!match) return false
  for (const [index, message] of match.entries()) {
    const messageIndex = thread.messages.indexOf(message)
    const activity = activities[index]
    if (messageIndex === -1) continue
    const pending = activityIsPending(activity)
    thread.messages[messageIndex] = {
      ...message,
      ...(pending ? {} : { completedAt: now }),
      parts: [activityPart(activity, false)],
      text: ''
    }
    if (pending) delete thread.messages[messageIndex].completedAt
  }
  return true
}

function appendActivities(
  thread: AgentConversationThread,
  activities: AntigravityActivity[],
  prefix: string,
  now: string,
  streaming: boolean
): void {
  for (const [index, activity] of activities.entries()) {
    const running = activityIsPending(activity) || (streaming && index === activities.length - 1)
    upsertMessage(thread, {
      ...(running ? {} : { completedAt: now }),
      createdAt: now,
      id: `${prefix}${String(index)}`,
      parts: [activityPart(activity, running)],
      role: 'assistant',
      text: ''
    })
  }
}

export function syncAntigravityActivities(
  thread: AgentConversationThread,
  value: unknown,
  turnKey: string,
  contentIndex: number,
  now: string,
  streaming: boolean
): string | null {
  const activities = antigravityActivities(value, safeActivityText)
  const prefix = toolPrefix(turnKey, contentIndex)
  if (
    activities.length &&
    !streaming &&
    !thread.messages.some((message) => message.id.startsWith(prefix)) &&
    reconcileCompletedActivities(thread, activities, now)
  ) {
    const latest = activities.at(-1)
    return latest ? activityStatus(latest) : null
  }
  const keep = new Set(activities.map((_, index) => `${prefix}${String(index)}`))
  thread.messages = thread.messages.filter(
    (message) => !message.id.startsWith(prefix) || keep.has(message.id)
  )
  if (!activities.length) return null
  appendActivities(thread, activities, prefix, now, streaming)
  const latest = activities.at(-1)
  return latest ? activityStatus(latest) : null
}

export function syncAntigravityThought(
  thread: AgentConversationThread,
  value: unknown,
  turnKey: string,
  contentIndex: number,
  now: string,
  complete: boolean
): string | null {
  const id = thoughtId(turnKey, contentIndex)
  if (!isAntigravityModel(thread.model)) return null
  const text = antigravityThoughtText(value)
  if (!text) {
    const index = thread.messages.findIndex((message) => message.id === id)
    if (index !== -1) thread.messages.splice(index, 1)
    return null
  }
  if (complete && !thread.messages.some((message) => message.id === id)) {
    const existing = thread.messages
      .slice(latestUserTurnStart(thread))
      .findLast(
        (message) =>
          message.id.startsWith('pi-agy-thought:') &&
          message.parts?.some(
            (part) =>
              part.type === 'reasoning' &&
              normalizedThreadText(part.text) === normalizedThreadText(text)
          )
      )
    if (existing) {
      existing.completedAt = now
      existing.parts = [{ state: 'complete', text, type: 'reasoning' }]
      return text
    }
  }
  upsertMessage(thread, {
    ...(complete ? { completedAt: now } : {}),
    createdAt: now,
    id,
    parts: [
      {
        state: complete ? 'complete' : 'streaming',
        text,
        type: 'reasoning'
      }
    ],
    role: 'assistant',
    text: ''
  })
  return text
}
