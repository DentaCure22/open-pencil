import { useLocalStorage } from '@vueuse/core'
import { ref } from 'vue'

export const agentChatsPanelOpenEpoch = ref(0)
export const agentChatsPanelView = useLocalStorage<'conversation' | 'list'>(
  'open-pencil:agent-chats-panel-view-v1',
  'list'
)
export const agentChatsPanelSelectedId = useLocalStorage<string | null>(
  'open-pencil:agent-chats-panel-selected-v1',
  null
)
export const agentChatsPanelCreating = ref(false)
export const agentChatsPanelPendingThreadId = ref<string | null>(null)
export const agentChatsPanelDraftId = ref<string | null>(null)

export function showAgentChatsPanel() {
  agentChatsPanelOpenEpoch.value += 1
}

export function isAgentChatsNewTaskDraftId(id: string | null | undefined): boolean {
  return Boolean(id === 'new-task' || id?.startsWith('new-task:'))
}

export function nextAgentChatsNewTaskDraftId(): string {
  return `new-task:${crypto.randomUUID()}`
}

export function beginAgentChatsNewTask(draftId = nextAgentChatsNewTaskDraftId()): string {
  agentChatsPanelCreating.value = true
  agentChatsPanelPendingThreadId.value = null
  agentChatsPanelSelectedId.value = null
  agentChatsPanelView.value = 'conversation'
  agentChatsPanelDraftId.value = draftId
  return draftId
}

export function abandonAgentChatsNewTask(): string | null {
  const draftId = agentChatsPanelDraftId.value
  agentChatsPanelCreating.value = false
  agentChatsPanelPendingThreadId.value = null
  agentChatsPanelDraftId.value = null
  return draftId
}

export function claimAgentChatsNewTaskReceipt(draftId: string, threadId: string): boolean {
  if (!agentChatsPanelCreating.value || agentChatsPanelDraftId.value !== draftId || !threadId) {
    return false
  }
  agentChatsPanelPendingThreadId.value = threadId
  return true
}

export function acceptAgentChatsNewTask(threadId: string): string | null {
  if (!agentChatsPanelCreating.value || !agentChatsPanelPendingThreadId.value) return null
  if (agentChatsPanelPendingThreadId.value !== threadId) return null
  const draftId = agentChatsPanelDraftId.value
  agentChatsPanelSelectedId.value = threadId
  agentChatsPanelPendingThreadId.value = null
  agentChatsPanelCreating.value = false
  agentChatsPanelDraftId.value = null
  return draftId
}
