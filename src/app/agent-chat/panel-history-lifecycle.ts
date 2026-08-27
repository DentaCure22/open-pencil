import { computed, watch, type Ref } from 'vue'

import type { AgentConversationHistory, AgentConversationThread } from './conversations'
import { clearOptimisticConversation, moveOptimisticConversation } from './optimistic'
import {
  activeAgentChatsPanelSelectedId,
  acceptAgentChatsNewTask,
  agentChatsPanelCreating,
  agentChatsPanelPendingThreadId,
  agentChatsPanelSelectedId,
  agentChatsPanelView
} from './panel'
import {
  setAgentConversationUnread,
  shouldMarkFinishedConversationUnread
} from './thread-preferences'

type PanelLocation = {
  selectedId: string | null
  view: 'conversation' | 'list'
}

export function restoredAgentPanelLocation(
  threads: readonly AgentConversationThread[],
  location: PanelLocation
): PanelLocation {
  if (threads.some((thread) => thread.id === location.selectedId)) return location
  const selectedId = threads[0]?.id ?? null
  return {
    selectedId,
    view: location.view !== 'list' && !selectedId ? 'list' : location.view
  }
}

export function useAgentPanelHistoryLifecycle(options: {
  history: Readonly<Ref<AgentConversationHistory | null>>
  loadWorkMap: () => Promise<unknown>
}) {
  const knownThreadStates = new Map<string, AgentConversationThread['state']>()
  let threadStatesInitialized = false
  const selectedThread = computed(() => {
    const selectedId = activeAgentChatsPanelSelectedId()
    if (!selectedId) return null
    return options.history.value?.threads.find((thread) => thread.id === selectedId) ?? null
  })

  watch(
    options.history,
    (nextHistory) => {
      const nextStates = new Map<string, AgentConversationThread['state']>()
      let todoWorkSettled = false
      for (const thread of nextHistory?.threads ?? []) {
        nextStates.set(thread.id, thread.state)
        if (
          thread.todoDraft &&
          knownThreadStates.get(thread.id) === 'running' &&
          thread.state !== 'running'
        ) {
          todoWorkSettled = true
        }
        const finishedInBackground =
          threadStatesInitialized &&
          shouldMarkFinishedConversationUnread({
            open:
              agentChatsPanelView.value === 'conversation' &&
              agentChatsPanelSelectedId.value === thread.id,
            previousState: knownThreadStates.get(thread.id),
            state: thread.state
          })
        if (finishedInBackground) setAgentConversationUnread(thread, true)
      }
      knownThreadStates.clear()
      for (const [threadId, state] of nextStates) knownThreadStates.set(threadId, state)
      threadStatesInitialized = true
      if (todoWorkSettled) void options.loadWorkMap()

      if (agentChatsPanelCreating.value && agentChatsPanelPendingThreadId.value) {
        const pending = nextHistory?.threads.find(
          (thread) => thread.id === agentChatsPanelPendingThreadId.value
        )
        if (pending) {
          const acceptedDraftId = acceptAgentChatsNewTask(pending.id)
          if (acceptedDraftId) moveOptimisticConversation(acceptedDraftId, pending.id)
          clearOptimisticConversation('new-task')
        }
        return
      }
      if (agentChatsPanelCreating.value || !nextHistory) return
      const location = restoredAgentPanelLocation(nextHistory.threads, {
        selectedId: agentChatsPanelSelectedId.value,
        view: agentChatsPanelView.value
      })
      agentChatsPanelSelectedId.value = location.selectedId
      agentChatsPanelView.value = location.view
    },
    { immediate: true }
  )

  return { selectedThread }
}
