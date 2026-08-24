import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import {
  CONVERSATION_PAGE_BYTE_BUDGET,
  CONVERSATION_PAGE_TOOL_CHARS,
  pageAgentConversation
} from '#mcp/agent-router/conversation-page'

function thread(messages: AgentConversationThread['messages']): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-23T12:00:00.000Z',
    effort: 'high',
    id: 'thread-page',
    messages,
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Done.',
    sessionId: 'thread-page',
    state: 'completed',
    task: 'Long chat',
    updatedAt: '2026-08-23T12:20:00.000Z',
    workerId: 'worker-1'
  }
}

function user(
  index: number,
  text = `Prompt ${String(index)}`
): AgentConversationThread['messages'][number] {
  return {
    createdAt: `2026-08-23T12:${String(index).padStart(2, '0')}:00.000Z`,
    id: `user-${String(index)}`,
    role: 'user',
    text
  }
}

function assistant(
  index: number,
  text = `Answer ${String(index)}`,
  output?: string
): AgentConversationThread['messages'][number] {
  return {
    completedAt: `2026-08-23T12:${String(index).padStart(2, '0')}:30.000Z`,
    createdAt: `2026-08-23T12:${String(index).padStart(2, '0')}:10.000Z`,
    id: `assistant-${String(index)}`,
    ...(output
      ? {
          parts: [
            {
              name: 'read',
              output,
              state: 'success' as const,
              type: 'tool' as const
            }
          ]
        }
      : {}),
    role: 'assistant',
    text
  }
}

function longChat(): AgentConversationThread {
  const messages: AgentConversationThread['messages'] = []
  for (let index = 1; index <= 8; index += 1) {
    messages.push(user(index), assistant(index))
  }
  return thread(messages)
}

describe('agent conversation pages', () => {
  test('opens on the newest five user turns and keeps an older cursor', () => {
    const page = pageAgentConversation(longChat())

    expect(page.messages.map((message) => message.id)).toEqual([
      'user-4',
      'assistant-4',
      'user-5',
      'assistant-5',
      'user-6',
      'assistant-6',
      'user-7',
      'assistant-7',
      'user-8',
      'assistant-8'
    ])
    expect(page.hasOlder).toBe(true)
    expect(page.hasNewer).toBe(false)
    expect(page.olderBefore).toBe('user-4')
    expect(page.messageTotal).toBe(16)
    expect(page.turns).toHaveLength(8)
    expect(page.turns[0]).toMatchObject({ id: 'user-1', prompt: 'Prompt 1' })
  })

  test('loads the previous page from the older cursor', () => {
    const page = pageAgentConversation(longChat(), { before: 'user-4' })

    expect(page.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      'user-2',
      'assistant-2',
      'user-3',
      'assistant-3'
    ])
    expect(page.hasOlder).toBe(false)
    expect(page.hasNewer).toBe(true)
    expect(page.olderBefore).toBe('user-1')
  })

  test('returns only messages after a live cursor', () => {
    const page = pageAgentConversation(longChat(), { after: 'assistant-8' })

    expect(page.messages).toEqual([])
    expect(page.hasNewer).toBe(false)

    const growing = longChat()
    growing.messages.push(user(9), assistant(9))
    const delta = pageAgentConversation(growing, { after: 'assistant-8' })
    expect(delta.messages.map((message) => message.id)).toEqual(['user-9', 'assistant-9'])
    expect(delta.hasNewer).toBe(false)
  })

  test('clips an oversized tool payload instead of shipping an uncapped page', () => {
    const fat = 'x'.repeat(CONVERSATION_PAGE_BYTE_BUDGET)
    const page = pageAgentConversation(thread([user(1), assistant(1, 'Done', fat)]))
    const output = page.messages[1]?.parts?.[0]

    expect(page.messages).toHaveLength(2)
    expect(output).toMatchObject({ name: 'read', type: 'tool' })
    const clipped =
      typeof output === 'object' && output && 'output' in output ? String(output.output) : ''
    expect(clipped).toHaveLength(CONVERSATION_PAGE_TOOL_CHARS)
    expect(clipped.startsWith('x')).toBe(true)
    expect(clipped.endsWith('x')).toBe(true)
    expect(clipped).toContain('\n…\n')
    expect(JSON.stringify(page.messages).length).toBeLessThan(CONVERSATION_PAGE_BYTE_BUDGET)
  })
})
