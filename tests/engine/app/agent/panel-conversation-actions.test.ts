import { describe, expect, test } from 'bun:test'

import { computed, effectScope } from 'vue'

import type { AgentConversationThread } from '@/app/agent-chat/conversations'
import {
  abandonAgentChatsNewTask,
  agentChatsPanelCreating,
  beginAgentChatsNewTask
} from '@/app/agent-chat/panel'
import { useAgentPanelConversationActions } from '@/app/agent-chat/panel-conversation-actions'

describe('agent panel conversation actions', () => {
  test('owns new-chat destination and Bot configuration state', () => {
    abandonAgentChatsNewTask()
    const scope = effectScope()
    const actions = scope.run(() =>
      useAgentPanelConversationActions({
        approvals: {
          beginResponse: () => false,
          removeFeedback: () => undefined,
          supersedePending: () => []
        },
        applyWorkMapOperations: async () => undefined,
        canStop: () => false,
        conversationThreadId: computed(() => 'new-task:test'),
        modelScope: computed(() => 'task:new'),
        placeChatInWorkMap: async () => undefined,
        refresh: async () => undefined,
        selectedThread: computed<AgentConversationThread | null>(() => null),
        steering: computed(() => false)
      })
    )
    if (!actions) throw new Error('Conversation actions scope did not start')

    beginAgentChatsNewTask('new-task:test')
    actions.setNewConversationDestination(null, null)
    expect(actions.configuringBot.value).toBe(true)

    actions.discardNewConversationDraft()
    expect(actions.configuringBot.value).toBe(false)
    expect(agentChatsPanelCreating.value).toBe(false)
    scope.stop()
  })
})
