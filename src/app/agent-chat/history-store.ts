import { useIntervalFn } from '@vueuse/core'
import { onMounted, onUnmounted, readonly, ref, shallowReadonly, shallowRef } from 'vue'

import {
  agentConversationMessages,
  getAgentConversation,
  listAgentConversations,
  type AgentConversationHistory,
  type AgentConversationThread
} from './client'
import { agentHistorySignature } from './history-signature'
import {
  mapAgentConversationHistory,
  reconcileAgentConversationHistory,
  reconcileRetainedConversationMessages,
  retainedTranscriptNeedsHydrate
} from './reconcile'

const POLL_INTERVAL_MS = 2_500

const history = shallowRef<AgentConversationHistory | null>(null)
const error = ref('')
let subscribers = import.meta.hot?.data.agentHistorySubscribers ?? 0
let inFlight: Promise<void> | null = null
let historySignature = ''
const transcriptRetainers = new Map<string, number>()
const hydratedUpdatedAt = new Map<string, string>()
const hydratedMessageCount = new Map<string, number>()
const { pause: pausePolling, resume: resumePolling } = useIntervalFn(
  () => void refreshAgentConversationHistory(),
  POLL_INTERVAL_MS,
  { immediate: false }
)

function restoreHydratedMessages(
  previous: AgentConversationHistory | null,
  next: AgentConversationHistory
): AgentConversationHistory {
  return mapAgentConversationHistory(previous, next, (current, thread) => {
    if (current && transcriptRetainers.has(thread.id)) {
      return {
        ...thread,
        messages: reconcileRetainedConversationMessages(current.messages, thread.messages)
      }
    }
    return thread
  })
}

async function hydrateRetainedTranscripts(): Promise<void> {
  const current = history.value
  if (!current || transcriptRetainers.size === 0) return
  const updates = new Map<string, AgentConversationThread>()
  await Promise.all(
    [...transcriptRetainers.keys()].map(async (threadId) => {
      const thread = current.threads.find((candidate) => candidate.id === threadId)
      if (!thread) return
      if (
        !retainedTranscriptNeedsHydrate({
          hydratedMessageCount: hydratedMessageCount.get(threadId),
          hydratedUpdatedAt: hydratedUpdatedAt.get(threadId),
          retainedMessageCount: thread.messages.length,
          updatedAt: thread.updatedAt
        })
      ) {
        return
      }
      const full = await getAgentConversation(thread.nativeThreadId)
      const messages = agentConversationMessages(full)
      updates.set(threadId, {
        ...thread,
        ...(full.contextUsage ? { contextUsage: full.contextUsage } : {}),
        messages,
        pendingUiRequests: full.pendingUiRequests?.map((request) => ({ ...request })) ?? [],
        recentUpdate: full.recentUpdate,
        state: full.state,
        updatedAt: full.updatedAt
      })
      hydratedUpdatedAt.set(threadId, full.updatedAt)
      hydratedMessageCount.set(threadId, messages.length)
    })
  )
  if (updates.size === 0 || history.value !== current) return
  history.value = reconcileAgentConversationHistory(current, {
    ...current,
    threads: current.threads.map((thread) => updates.get(thread.id) ?? thread)
  })
}

async function requestHistory(): Promise<void> {
  try {
    const nextHistory = await listAgentConversations({ preview: true })
    const nextSignature = agentHistorySignature(nextHistory)
    if (nextSignature !== historySignature) {
      history.value = restoreHydratedMessages(
        history.value,
        reconcileAgentConversationHistory(history.value, nextHistory)
      )
      historySignature = nextSignature
    }
    if (transcriptRetainers.size > 0) await hydrateRetainedTranscripts()
    error.value = ''
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function refreshAgentConversationHistory(fresh = false): Promise<void> {
  if (inFlight) {
    await inFlight
    if (!fresh) return
  }
  inFlight = requestHistory().finally(() => {
    inFlight = null
  })
  await inFlight
}

export function retainAgentConversationTranscript(threadId: string): void {
  if (!threadId) return
  transcriptRetainers.set(threadId, (transcriptRetainers.get(threadId) ?? 0) + 1)
  void hydrateRetainedTranscripts()
}

export function releaseAgentConversationTranscript(threadId: string): void {
  if (!threadId) return
  const current = transcriptRetainers.get(threadId) ?? 0
  if (current <= 1) {
    transcriptRetainers.delete(threadId)
    hydratedUpdatedAt.delete(threadId)
    hydratedMessageCount.delete(threadId)
    return
  }
  transcriptRetainers.set(threadId, current - 1)
}

function retainHistoryFeed() {
  subscribers += 1
  if (subscribers !== 1) return
  void refreshAgentConversationHistory()
  resumePolling()
}

function releaseHistoryFeed() {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers === 0) pausePolling()
}

export function useAgentConversationHistory() {
  onMounted(retainHistoryFeed)
  onUnmounted(releaseHistoryFeed)
  return {
    error: readonly(error),
    history: shallowReadonly(history),
    refresh: refreshAgentConversationHistory
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    pausePolling()
    data.agentHistorySubscribers = subscribers
  })
  if (subscribers > 0) {
    void refreshAgentConversationHistory()
    resumePolling()
  }
}
