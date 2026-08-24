import { describe, expect, test } from 'bun:test'

import {
  compareAgentConversationsByLastUserMessage,
  previewAgentConversation,
  type AgentConversationThread
} from '#mcp/agent-router/contracts'

function thread(id: string, lastUserMessageAt: string, updatedAt: string): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: lastUserMessageAt,
    effort: 'high',
    id,
    messages: [
      {
        createdAt: lastUserMessageAt,
        id: `${id}:user`,
        role: 'user',
        text: 'Do this next.'
      },
      {
        createdAt: updatedAt,
        id: `${id}:assistant`,
        role: 'assistant',
        text: 'Working on it.'
      },
      {
        createdAt: updatedAt,
        id: `${id}:assistant-2`,
        role: 'assistant',
        text: 'Still working.'
      },
      {
        createdAt: updatedAt,
        id: `${id}:assistant-3`,
        role: 'assistant',
        text: 'Almost done.'
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Almost done.',
    sessionId: id,
    state: 'running',
    task: 'Do this next.',
    updatedAt,
    workerId: `worker:${id}`
  }
}

describe('agent conversation order', () => {
  test('keeps list order on the last user message even when the agent is still turning', () => {
    const olderUser = thread('older-user', '2026-08-22T12:00:00.000Z', '2026-08-22T12:10:00.000Z')
    const newerUser = thread('newer-user', '2026-08-22T12:05:00.000Z', '2026-08-22T12:06:00.000Z')

    expect(
      [olderUser, newerUser].sort(compareAgentConversationsByLastUserMessage).map((item) => item.id)
    ).toEqual(['newer-user', 'older-user'])

    const preview = previewAgentConversation(olderUser)
    expect(preview.messages.every((message) => message.role === 'assistant')).toBe(true)
    expect(preview.lastUserMessageAt).toBe('2026-08-22T12:00:00.000Z')
  })
})
