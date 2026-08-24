import { computed } from 'vue'

import type { AgentConversationThread } from './client'
import { useAgentConversationHistory } from './history-store'
import { agentConversationTitle } from './presentation'

const ACTIVE_CONVERSATION_STATES = ['running'] as const
const HEARTBEAT_ELAPSED_SUFFIX = / · (\d+)s$/
const ELLIPSIS_ELAPSED_SUFFIX = /^(.*?(?:…|\.\.\.)) (\d+)s$/

type LiveWorkingLabelInput = {
  lastMessageAt?: string
  now: number
  recentUpdate?: string
  state?: string
  updatedAt?: string
}

function isActiveConversationState(
  state?: string
): state is (typeof ACTIVE_CONVERSATION_STATES)[number] {
  return (ACTIVE_CONVERSATION_STATES as readonly string[]).includes(state ?? '')
}

function conversationStateLabel(state?: string): string {
  return state?.replace('_', ' ') ?? 'unavailable'
}

function activityOriginMs(input: LiveWorkingLabelInput): number | undefined {
  const recent = input.recentUpdate ?? ''
  const hasElapsedSuffix = Boolean(
    HEARTBEAT_ELAPSED_SUFFIX.exec(recent) || ELLIPSIS_ELAPSED_SUFFIX.exec(recent)
  )
  if (hasElapsedSuffix) {
    const updated = Date.parse(input.updatedAt ?? '')
    if (Number.isFinite(updated)) return updated
  }
  const message = Date.parse(input.lastMessageAt ?? '')
  if (Number.isFinite(message)) return message
  const updated = Date.parse(input.updatedAt ?? '')
  return Number.isFinite(updated) ? updated : undefined
}

function shortWorkingActivity(activity: string): string {
  const first = activity.split('\n')[0]?.trim() ?? activity
  return first.length > 72 ? 'Working' : first
}

function splitElapsedActivity(recentUpdate: string): { activity: string; seconds: number } {
  const dotted = HEARTBEAT_ELAPSED_SUFFIX.exec(recentUpdate)
  if (dotted) {
    return {
      activity: recentUpdate.slice(0, dotted.index).trimEnd(),
      seconds: Number(dotted[1])
    }
  }
  const ellipsis = ELLIPSIS_ELAPSED_SUFFIX.exec(recentUpdate)
  if (ellipsis) {
    return {
      activity: ellipsis[1]?.trimEnd() || recentUpdate,
      seconds: Number(ellipsis[2])
    }
  }
  return { activity: recentUpdate, seconds: 0 }
}

export function liveWorkingLabel(input: LiveWorkingLabelInput): string | undefined {
  if (!isActiveConversationState(input.state)) return undefined
  const recent = input.recentUpdate?.trim() ?? ''
  const split = splitElapsedActivity(recent)
  const activity = shortWorkingActivity(split.activity || conversationStateLabel(input.state))
  const origin = activityOriginMs(input)
  const sinceUpdate =
    origin === undefined ? 0 : Math.max(0, Math.floor((input.now - origin) / 1_000))
  return `${activity} · ${String(split.seconds + sinceUpdate)}s`
}

export function boardConversationStatusLabel(input: LiveWorkingLabelInput): string {
  const live = liveWorkingLabel(input)
  if (live) return live
  if (input.state && !isActiveConversationState(input.state)) {
    return 'idle'
  }
  return conversationStateLabel(input.state)
}

export function threadLiveWorkingLabel(
  thread: {
    messages?: Array<{ createdAt: string }>
    recentUpdate?: string
    state?: string
    updatedAt?: string
  },
  now: number
): string {
  return (
    liveWorkingLabel({
      lastMessageAt: thread.messages?.at(-1)?.createdAt,
      now,
      recentUpdate: thread.recentUpdate,
      state: thread.state,
      updatedAt: thread.updatedAt
    }) ??
    thread.recentUpdate ??
    ''
  )
}

export function matchesAgentBoardConversation(
  thread: Pick<AgentConversationThread, 'nativeThreadId'>,
  conversationId: string | undefined
): boolean {
  return thread.nativeThreadId === conversationId
}

export function useAgentBoardConversation(input: {
  fallbackTitle?: string
  workerConversationId?: string
}) {
  const { error: historyError, history, refresh } = useAgentConversationHistory()
  const workerThreads = computed(() => {
    return (history.value?.threads ?? [])
      .filter((candidate) => matchesAgentBoardConversation(candidate, input.workerConversationId))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  })
  const thread = computed<AgentConversationThread | null>(() => {
    const candidates = [...workerThreads.value].sort((left, right) => {
      const leftActive = isActiveConversationState(left.state) ? 1 : 0
      const rightActive = isActiveConversationState(right.state) ? 1 : 0
      return rightActive - leftActive || right.updatedAt.localeCompare(left.updatedAt)
    })
    return candidates.at(0) ?? null
  })
  const resolvedThreadId = computed(() => thread.value?.id ?? '')
  const title = computed(() => {
    if (thread.value) return agentConversationTitle(thread.value)
    return input.fallbackTitle ?? (input.workerConversationId ? 'Task' : 'Task unavailable')
  })
  return {
    historyError,
    refresh,
    resolvedThreadId,
    thread,
    title,
    workerThreads
  }
}
