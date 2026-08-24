import { ref } from 'vue'

export const agentChatsPanelOpenEpoch = ref(0)
export const agentChatsPanelView = ref<'conversation' | 'list'>('list')
export const agentChatsPanelSelectedId = ref<string | null>(null)
export const agentChatsPanelCreating = ref(false)
export const agentChatsPanelPendingThreadId = ref<string | null>(null)

export function showAgentChatsPanel() {
  agentChatsPanelOpenEpoch.value += 1
}
