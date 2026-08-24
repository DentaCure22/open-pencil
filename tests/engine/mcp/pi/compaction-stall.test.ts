import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { COMPACTION_STALL_STORED_BYTES, applyCompactionStall } from '#mcp/pi/compaction-stall'

function thread(overrides?: Partial<AgentConversationThread>): AgentConversationThread {
  return {
    canFollowUp: true,
    contextUsage: {
      autoCompactionEnabled: true,
      compacting: false,
      contextWindow: 500_000,
      lastCompactedAt: '2026-08-23T12:00:00.000Z',
      percent: null,
      tokens: null
    },
    createdAt: '2026-08-23T12:00:00.000Z',
    effort: 'high',
    id: 'thread-stall',
    messages: [],
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Compacted.',
    sessionId: 'thread-stall',
    state: 'completed',
    task: 'Long chat',
    updatedAt: '2026-08-23T12:00:00.000Z',
    workerId: 'worker-1',
    ...overrides
  }
}

describe('compaction stall', () => {
  test('flags a compact that left the window still full', () => {
    const conversation = thread()
    expect(applyCompactionStall(conversation, { estimatedTokensAfter: 400_000 })).toBe(true)
    expect(conversation.contextUsage?.compactionStalled).toBe(true)
  })

  test('flags leftover stored history that is still huge after clip', () => {
    const conversation = thread({
      messages: [
        {
          createdAt: '2026-08-23T12:00:00.000Z',
          id: 'user-1',
          role: 'user',
          text: 'x'.repeat(COMPACTION_STALL_STORED_BYTES)
        }
      ]
    })
    expect(applyCompactionStall(conversation)).toBe(true)
    expect(conversation.contextUsage?.compactionStalled).toBe(true)
  })

  test('clears the stall once later usage drops below the fill line', () => {
    const conversation = thread({
      contextUsage: {
        autoCompactionEnabled: true,
        compacting: false,
        compactionStalled: true,
        contextWindow: 500_000,
        lastCompactedAt: '2026-08-23T12:00:00.000Z',
        percent: 40,
        tokens: 200_000
      }
    })
    expect(applyCompactionStall(conversation)).toBe(true)
    expect(conversation.contextUsage?.compactionStalled).toBeUndefined()
  })
})
