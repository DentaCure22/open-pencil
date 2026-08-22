import { describe, expect, test } from 'bun:test'

import { agentConversationHistory, type RemoteAgentConversation } from '@/app/agent-chat/client'

function conversation(
  id: string,
  input: Partial<RemoteAgentConversation> = {}
): RemoteAgentConversation {
  return {
    canFollowUp: true,
    createdAt: '2026-08-17T12:01:00.000Z',
    effort: 'medium',
    id,
    messages: [
      {
        createdAt: '2026-08-17T12:01:00.000Z',
        id: 'user-1',
        role: 'user',
        text: 'Show this request in chats'
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Running a focused check.',
    state: 'running',
    task: 'Show this request in chats',
    updatedAt: '2026-08-17T12:01:00.000Z',
    ...input
  }
}

describe('Pi conversation inventory', () => {
  test('maps native Pi history to stable app identities', () => {
    const history = agentConversationHistory([conversation('thread-1')])
    const thread = history.threads[0]

    expect(thread).toMatchObject({
      id: 'agent:thread-1',
      nativeThreadId: 'thread-1'
    })
    expect(thread?.messages[0]?.id).toBe('agent:thread-1:user-1')
  })

  test('sorts the newest task first without synthesizing infrastructure threads', () => {
    const history = agentConversationHistory([
      conversation('older', { updatedAt: '2026-08-17T12:00:00.000Z' }),
      conversation('newer', { updatedAt: '2026-08-17T12:02:00.000Z' })
    ])

    expect(history.threads.map((thread) => thread.nativeThreadId)).toEqual(['newer', 'older'])
    expect(agentConversationHistory([])).toEqual({ threads: [] })
  })
})
