import { describe, expect, test } from 'bun:test'

import type { AgentConversationHistory } from '@/app/agent-chat/client'
import { agentHistorySignature } from '@/app/agent-chat/history-signature'

function history(
  recentUpdate: string,
  lastText = 'Stable final response'
): AgentConversationHistory {
  return {
    threads: [
      {
        canFollowUp: true,
        createdAt: '2026-08-17T12:00:00.000Z',
        id: 'agent:thread-1',
        messages: [
          {
            createdAt: '2026-08-17T12:00:00.000Z',
            id: 'final-1',
            role: 'assistant',
            text: lastText
          }
        ],
        effort: 'medium',
        model: 'xai-auth/grok-4.6',
        nativeThreadId: 'thread-1',
        recentUpdate,
        state: 'running',
        task: 'Verify stable rendering',
        updatedAt: '2026-08-17T12:01:00.000Z'
      }
    ]
  }
}

describe('agent history signature', () => {
  test('stays stable when poll payloads are identical', () => {
    const first = history('Running command')
    expect(agentHistorySignature(first)).toBe(agentHistorySignature(structuredClone(first)))
  })

  test('changes when a later message or status advances', () => {
    const previous = agentHistorySignature(history('Running command'))
    expect(agentHistorySignature(history('Command completed'))).not.toBe(previous)
    expect(
      agentHistorySignature(history('Running command', 'A much longer final response'))
    ).not.toBe(previous)
  })

  test('changes when a turn receives its completion timestamp', () => {
    const previous = history('Running command')
    const next = structuredClone(previous)
    const message = next.threads[0]?.messages[0]
    if (!message) throw new Error('Missing message fixture')
    message.completedAt = '2026-08-17T12:01:10.000Z'

    expect(agentHistorySignature(next)).not.toBe(agentHistorySignature(previous))
  })

  test('changes when a tool receives an image without embedding image data in the signature', () => {
    const previous = history('Taking screenshot')
    const next = structuredClone(previous)
    next.threads[0]?.messages.push({
      createdAt: '2026-08-17T12:01:10.000Z',
      id: 'tool-screenshot',
      parts: [
        {
          images: [{ alt: 'Board screenshot', url: 'data:image/png;base64,iVBORw==' }],
          name: 'openpencil_board_screenshot',
          state: 'success',
          type: 'tool'
        }
      ],
      role: 'assistant',
      text: ''
    })

    const signature = agentHistorySignature(next)
    expect(signature).not.toBe(agentHistorySignature(previous))
    expect(signature).not.toContain('iVBORw')
  })
})
