import { useNow } from '@vueuse/core'
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
  const updated = Date.parse(input.updatedAt ?? '')
  if (Number.isFinite(updated)) return updated
  const message = Date.parse(input.lastMessageAt ?? '')
  return Number.isFinite(message) ? message : undefined
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
  const activity = split.activity || conversationStateLabel(input.state)
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
  const now = useNow({ interval: 1_000 })
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
  const liveClock = computed(() => ({
    lastMessageAt: thread.value?.messages.at(-1)?.createdAt,
    now: now.value.getTime(),
    recentUpdate: thread.value?.recentUpdate,
    state: thread.value?.state,
    updatedAt: thread.value?.updatedAt
  }))
  const isLiveStatus = computed(() => isActiveConversationState(thread.value?.state))
  const statusLabel = computed(() =>
    boardConversationStatusLabel({
      ...liveClock.value
    })
  )
  const workingLabel = computed(() =>
    threadLiveWorkingLabel(thread.value ?? {}, liveClock.value.now)
  )
  const statusDotClass = computed(() => {
    if (thread.value?.state === 'needs_attention') return 'bg-red-400'
    if (isLiveStatus.value) return 'bg-amber-400'
    if (statusLabel.value === 'idle') return 'bg-muted/60'
    if (thread.value?.state === 'completed') return 'bg-success'
    return 'bg-muted/60'
  })

  return {
    historyError,
    refresh,
    resolvedThreadId,
    statusDotClass,
    thread,
    title,
    workerThreads,
    workingLabel
  }
}
