import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { pageAgentConversation } from '#mcp/agent-router/conversation-page'
import { clipReplayText } from '#mcp/agent-router/replay-buffer'
import { compactAgentThreadMemory } from '#mcp/pi/thread-memory'

describe('replay buffer', () => {
  test('keeps the start and end of a fat dump inside the budget', () => {
    const clipped = clipReplayText(`HEAD${'x'.repeat(8_000)}TAIL`, 8, 8)

    expect(clipped.startsWith('HEAD')).toBe(true)
    expect(clipped.endsWith('TAIL')).toBe(true)
    expect(clipped).toContain('\n…\n')
    expect(clipped.length).toBeLessThanOrEqual(16)
  })

  test('leaves short dumps intact', () => {
    expect(clipReplayText('short')).toBe('short')
  })

  test('stored memory and page copies keep the head and tail of leftover dumps', () => {
    const fat = `HEAD${'y'.repeat(20_000)}TAIL`
    const conversation: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-23T12:00:00.000Z',
      effort: 'high',
      id: 'thread-replay',
      messages: [
        {
          createdAt: '2026-08-23T12:00:00.000Z',
          id: 'user-1',
          role: 'user',
          text: 'Older'
        },
        {
          createdAt: '2026-08-23T12:00:10.000Z',
          id: 'assistant-1',
          parts: [{ name: 'read', output: fat, state: 'success', type: 'tool' }],
          role: 'assistant',
          text: 'Done'
        },
        {
          createdAt: '2026-08-23T12:01:00.000Z',
          id: 'user-2',
          role: 'user',
          text: 'Live'
        }
      ],
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Done.',
      sessionId: 'thread-replay',
      state: 'completed',
      task: 'Replay',
      updatedAt: '2026-08-23T12:01:00.000Z',
      workerId: 'worker-1'
    }

    expect(compactAgentThreadMemory(conversation)).toBe(true)
    const stored = conversation.messages[1]?.parts?.[0]
    const storedOutput = stored && 'output' in stored ? String(stored.output) : ''
    expect(storedOutput).toContain('HEAD')
    expect(storedOutput).toContain('TAIL')
    expect(storedOutput).toContain('\n…\n')
    expect(storedOutput.length).toBeLessThan(fat.length)

    const page = pageAgentConversation(
      {
        ...conversation,
        messages: [
          conversation.messages[0]!,
          {
            ...conversation.messages[1]!,
            parts: [{ name: 'read', output: fat, state: 'success', type: 'tool' }]
          },
          conversation.messages[2]!
        ]
      },
      { turnLimit: 5 }
    )
    const pageOutput = page.messages[1]?.parts?.[0]
    const pageText = pageOutput && 'output' in pageOutput ? String(pageOutput.output) : ''
    expect(pageText).toContain('HEAD')
    expect(pageText).toContain('TAIL')
    expect(pageText).toContain('\n…\n')
    expect(pageText.length).toBeLessThan(fat.length)
  })
})
