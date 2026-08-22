import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '@/app/agent-chat/client'
import {
  agentConversationCopyText,
  agentConversationDisplayTitle,
  agentConversationLastResponseText,
  isAgentConversationArchived,
  isAgentConversationPinned,
  isAgentConversationUnread,
  setAgentConversationArchived,
  setAgentConversationPinned,
  setAgentConversationTitle,
  setAgentConversationUnread,
  sortAgentConversationThreads
} from '@/app/agent-chat/thread-preferences'

function thread(id: string, updatedAt: string): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-22T12:00:00.000Z',
    effort: 'high',
    id: `agent:${id}`,
    messages: [
      {
        createdAt: '2026-08-22T12:00:00.000Z',
        id: `${id}:user`,
        role: 'user',
        text: 'Move this card to the right.'
      },
      {
        createdAt: '2026-08-22T12:01:00.000Z',
        id: `${id}:assistant`,
        role: 'assistant',
        text: 'Moved it and verified the result.'
      }
    ],
    model: 'xai-auth/grok-4.6',
    nativeThreadId: id,
    recentUpdate: 'Moved it and verified the result.',
    state: 'completed',
    task: 'move this card to the right',
    updatedAt
  }
}

describe('agent conversation preferences', () => {
  test('pins, renames, marks unread, archives, and restores one task without changing its chat', () => {
    const first = thread('context-menu-first', '2026-08-22T12:01:00.000Z')
    const second = thread('context-menu-second', '2026-08-22T12:02:00.000Z')

    setAgentConversationPinned(first, true)
    setAgentConversationTitle(first, 'Right-side card polish')
    setAgentConversationUnread(first, true)
    setAgentConversationArchived(first, true)

    expect(isAgentConversationPinned(first)).toBe(true)
    expect(isAgentConversationUnread(first)).toBe(true)
    expect(isAgentConversationArchived(first)).toBe(true)
    expect(agentConversationDisplayTitle(first)).toBe('Right-side card polish')
    expect(
      sortAgentConversationThreads([second, first]).map((item) => item.nativeThreadId)
    ).toEqual([first.nativeThreadId, second.nativeThreadId])
    expect(first.messages).toHaveLength(2)

    setAgentConversationPinned(first, false)
    setAgentConversationTitle(first, '')
    setAgentConversationUnread(first, false)
    setAgentConversationArchived(first, false)
  })

  test('copies a complete readable transcript and its latest agent response', () => {
    const conversation = thread('context-menu-copy', '2026-08-22T12:02:00.000Z')

    expect(agentConversationCopyText(conversation)).toBe(
      '# Move this card to the right\n\n**You**\n\nMove this card to the right.\n\n**Agent**\n\nMoved it and verified the result.'
    )
    expect(agentConversationLastResponseText(conversation)).toBe(
      'Moved it and verified the result.'
    )
  })
})
