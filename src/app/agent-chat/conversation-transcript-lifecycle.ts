import { onScopeDispose, ref, watch, type Ref } from 'vue'

import {
  loadOlderAgentConversationTranscript,
  releaseAgentConversationTranscript,
  retainAgentConversationTranscript,
  revealAgentConversationChapter
} from './history-store'

type ConversationTranscriptOperations = {
  loadOlder: (threadId: string) => Promise<unknown>
  release: (threadId: string) => void
  retain: (threadId: string) => void
  reveal: (threadId: string, chapterId: string) => Promise<unknown>
}

const conversationTranscriptOperations: ConversationTranscriptOperations = {
  loadOlder: loadOlderAgentConversationTranscript,
  release: releaseAgentConversationTranscript,
  retain: retainAgentConversationTranscript,
  reveal: revealAgentConversationChapter
}

export function useConversationTranscriptLifecycle(
  selectedId: Readonly<Ref<string | null>>,
  operations: ConversationTranscriptOperations = conversationTranscriptOperations
) {
  const loadingOlder = ref(false)
  let retainedTranscriptId: string | null = null

  async function loadOlderSelectedTranscript() {
    const threadId = selectedId.value
    if (!threadId || loadingOlder.value) return
    loadingOlder.value = true
    try {
      await operations.loadOlder(threadId)
    } finally {
      loadingOlder.value = false
    }
  }

  async function revealSelectedChapter(chapterId: string) {
    const threadId = selectedId.value
    if (!threadId) return
    loadingOlder.value = true
    try {
      await operations.reveal(threadId, chapterId)
    } finally {
      loadingOlder.value = false
    }
  }

  function syncRetainedTranscript(threadId: string | null) {
    if (retainedTranscriptId === threadId) return
    if (retainedTranscriptId) operations.release(retainedTranscriptId)
    retainedTranscriptId = threadId
    if (retainedTranscriptId) operations.retain(retainedTranscriptId)
  }

  watch(selectedId, syncRetainedTranscript, { immediate: true })
  onScopeDispose(() => syncRetainedTranscript(null))

  return { loadingOlder, loadOlderSelectedTranscript, revealSelectedChapter }
}
