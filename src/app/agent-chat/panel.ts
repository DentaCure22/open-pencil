import { ref } from 'vue'

export const agentChatsPanelOpenEpoch = ref(0)

export function showAgentChatsPanel() {
  agentChatsPanelOpenEpoch.value += 1
}
