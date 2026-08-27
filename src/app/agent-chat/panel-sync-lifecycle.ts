import { useIntervalFn } from '@vueuse/core'
import { onMounted, onUnmounted, watch, type ComputedRef, type Ref } from 'vue'

import { ensureAgentConversationTitle, type AgentConversationThread } from './conversations'
import { seedConversationModel } from './models'

export function useAgentPanelSyncLifecycle(options: {
  loadWorkMap: () => Promise<unknown>
  modelScope: ComputedRef<string>
  selectedThread: ComputedRef<AgentConversationThread | null>
  view: Readonly<Ref<'conversation' | 'list'>>
  workMapBusy: Readonly<Ref<boolean>>
}) {
  let requestedGeneratedTitleFor = ''
  const { pause: pauseWorkMapRefresh, resume: resumeWorkMapRefresh } = useIntervalFn(
    () => {
      if (options.view.value === 'list' && !options.workMapBusy.value) {
        void options.loadWorkMap()
      }
    },
    10_000,
    { immediate: false }
  )

  watch(
    () =>
      options.selectedThread.value && !options.selectedThread.value.title
        ? options.selectedThread.value.nativeThreadId
        : '',
    (threadId) => {
      if (!threadId || requestedGeneratedTitleFor === threadId) return
      requestedGeneratedTitleFor = threadId
      void ensureAgentConversationTitle(threadId).catch(() => {
        if (requestedGeneratedTitleFor === threadId) requestedGeneratedTitleFor = ''
      })
    },
    { immediate: true }
  )

  watch(
    options.selectedThread,
    (thread) => {
      if (!thread) return
      seedConversationModel(options.modelScope.value, thread.model, thread.effort)
    },
    { immediate: true }
  )

  onMounted(() => {
    void options.loadWorkMap()
    resumeWorkMapRefresh()
  })

  onUnmounted(pauseWorkMapRefresh)
}
