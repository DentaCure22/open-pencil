import { computed, type ComputedRef, type Ref } from 'vue'

import { conversationStatus } from '@/components/ai-elements'
import {
  resolveT3ThreadStatus,
  type T3ThreadStatus
} from '@/components/ai-elements/t3-chat-chrome.logic'

import type { AgentConversationThread } from './conversations'
import { mergeOptimisticMessages, optimisticConversation } from './optimistic'
import { isAgentConversationUnread } from './thread-preferences'

export function useAgentPanelConversationPresentation(options: {
  conversationThreadId: ComputedRef<string>
  error: Readonly<Ref<string>>
  selectedThread: ComputedRef<AgentConversationThread | null>
  submitting: Readonly<Ref<boolean>>
}) {
  const optimistic = computed(() => optimisticConversation(options.conversationThreadId.value))
  const optimisticSending = computed(
    () =>
      optimistic.value?.state === 'submitted' ||
      (optimistic.value?.state === 'thinking' && options.selectedThread.value?.state !== 'running')
  )
  const conversationState = computed(() => {
    if (options.selectedThread.value?.state === 'running') return 'running'
    if (optimistic.value?.state === 'completed') return 'completed'
    return options.selectedThread.value?.state
  })
  const uiStatus = computed(() =>
    conversationStatus({
      error: optimistic.value?.error || options.error.value,
      sending: optimisticSending.value,
      state: conversationState.value
    })
  )
  const canStopSelected = computed(
    () =>
      Boolean(
        options.selectedThread.value?.canFollowUp &&
        (options.selectedThread.value.state === 'running' ||
          options.selectedThread.value.pendingUiRequests.length)
      ) ||
      Boolean(
        options.selectedThread.value &&
        optimistic.value &&
        ['submitted', 'thinking'].includes(optimistic.value.state)
      )
  )
  const visibleMessages = computed(() =>
    mergeOptimisticMessages(
      options.conversationThreadId.value,
      options.selectedThread.value?.messages ?? []
    )
  )
  const draftHeaderTitle = computed(() => {
    const prompt = visibleMessages.value.find((message) => message.role === 'user')?.text
    return prompt?.trim().replace(/\s+/g, ' ') || 'New chat'
  })

  function threadStatus(thread: AgentConversationThread): T3ThreadStatus | undefined {
    return (
      resolveT3ThreadStatus(thread, {
        connecting:
          options.conversationThreadId.value === thread.id &&
          options.submitting.value &&
          thread.state !== 'running',
        unread: isAgentConversationUnread(thread)
      }) ?? undefined
    )
  }

  return {
    canStopSelected,
    draftHeaderTitle,
    optimistic,
    threadStatus,
    uiStatus,
    visibleMessages
  }
}
