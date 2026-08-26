import { afterEach, describe, expect, test } from 'bun:test'

import {
  abandonAgentChatsNewTask,
  acceptAgentChatsNewTask,
  agentChatsPanelCreating,
  agentChatsPanelDraftId,
  agentChatsPanelPendingThreadId,
  agentChatsPanelSelectedId,
  agentChatsPanelView,
  beginAgentChatsNewTask,
  claimAgentChatsNewTaskReceipt,
  isAgentChatsNewTaskDraftId
} from '@/app/agent-chat/panel'

function resetPanel() {
  agentChatsPanelCreating.value = false
  agentChatsPanelDraftId.value = null
  agentChatsPanelPendingThreadId.value = null
  agentChatsPanelSelectedId.value = 'agent:old-thread'
  agentChatsPanelView.value = 'list'
}

afterEach(() => {
  resetPanel()
})

describe('agent chats new-task draft identity', () => {
  test('treats the shared slot and unique drafts as new-task ids', () => {
    expect(isAgentChatsNewTaskDraftId('new-task')).toBe(true)
    expect(isAgentChatsNewTaskDraftId('new-task:abc')).toBe(true)
    expect(isAgentChatsNewTaskDraftId('agent:thread-1')).toBe(false)
  })

  test('starts each new chat on its own draft instead of a shared slot', () => {
    const first = beginAgentChatsNewTask()
    const second = beginAgentChatsNewTask()
    expect(first).not.toBe(second)
    expect(isAgentChatsNewTaskDraftId(second)).toBe(true)
    expect(agentChatsPanelDraftId.value).toBe(second)
    expect(agentChatsPanelSelectedId.value).toBeNull()
    expect(agentChatsPanelPendingThreadId.value).toBeNull()
    expect(agentChatsPanelCreating.value).toBe(true)
    expect(agentChatsPanelView.value).toBe('conversation')
  })

  test('ignores a leftover receipt after the user starts another new chat', () => {
    const first = beginAgentChatsNewTask()
    beginAgentChatsNewTask()
    expect(claimAgentChatsNewTaskReceipt(first, 'agent:thread-1')).toBe(false)
    expect(agentChatsPanelPendingThreadId.value).toBeNull()
  })

  test('binds only the receipt that still belongs to the open draft', () => {
    const draftId = beginAgentChatsNewTask()
    expect(claimAgentChatsNewTaskReceipt(draftId, 'agent:thread-2')).toBe(true)
    expect(agentChatsPanelPendingThreadId.value).toBe('agent:thread-2')
    expect(acceptAgentChatsNewTask('agent:thread-2')).toBe(draftId)
    expect(agentChatsPanelSelectedId.value).toBe('agent:thread-2')
    expect(agentChatsPanelCreating.value).toBe(false)
    expect(agentChatsPanelDraftId.value).toBeNull()
  })

  test('drops an abandoned draft so going back cannot reopen the previous turn', () => {
    const draftId = beginAgentChatsNewTask()
    expect(abandonAgentChatsNewTask()).toBe(draftId)
    expect(agentChatsPanelCreating.value).toBe(false)
    expect(agentChatsPanelDraftId.value).toBeNull()
    expect(claimAgentChatsNewTaskReceipt(draftId, 'agent:thread-3')).toBe(false)
  })
})
