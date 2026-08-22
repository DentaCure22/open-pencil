import { describe, expect, test } from 'bun:test'

import type { AgentConversationHistory } from '@/app/agent-chat/client'
import {
  reconcileAgentConversationHistory,
  reconcileRetainedConversationMessages,
  retainedTranscriptNeedsHydrate
} from '@/app/agent-chat/reconcile'

function history(
  recentUpdate: string,
  finalText = 'Stable final response'
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
            text: finalText
          },
          {
            createdAt: '2026-08-17T12:01:00.000Z',
            id: 'tool-1',
            parts: [{ name: 'Run command', state: 'running', type: 'tool' }],
            role: 'assistant',
            text: ''
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

describe('agent history reconciliation', () => {
  test('retains unchanged messages while the active tool advances', () => {
    const previous = history('Running command')
    const next = history('Command completed')
    const previousThread = previous.threads[0]
    const nextThread = next.threads[0]
    const nextToolMessage = nextThread?.messages[1]
    if (!previousThread || !nextThread || !nextToolMessage) throw new Error('Invalid test fixture')
    nextThread.messages[1] = {
      ...nextToolMessage,
      parts: [{ name: 'Run command', output: 'ok', state: 'success', type: 'tool' }]
    }
    const reconciled = reconcileAgentConversationHistory(previous, next)
    const reconciledThread = reconciled.threads[0]
    if (!reconciledThread) throw new Error('Reconciled thread unavailable')

    expect(reconciledThread.messages[0]).toBe(previousThread.messages[0])
    expect(reconciledThread.messages[1]).not.toBe(previousThread.messages[1])
    expect(reconciledThread.messages[1]?.parts?.[0]).toMatchObject({ state: 'success' })
  })

  test('reuses the complete thread when a poll is identical', () => {
    const previous = history('Completed')
    const next = structuredClone(previous)
    const reconciled = reconcileAgentConversationHistory(previous, next)

    expect(reconciled.threads[0]).toBe(previous.threads[0])
  })

  test('replaces a tool row when its screenshot arrives', () => {
    const previous = history('Taking screenshot')
    const next = structuredClone(previous)
    const toolMessage = next.threads[0]?.messages[1]
    const toolPart = toolMessage?.parts?.[0]
    if (!toolMessage || toolPart?.type !== 'tool') throw new Error('Missing tool fixture')
    toolMessage.parts = [
      {
        ...toolPart,
        images: [{ alt: 'Board screenshot', url: 'data:image/png;base64,iVBORw==' }]
      }
    ]

    const reconciled = reconcileAgentConversationHistory(previous, next)

    expect(reconciled.threads[0]?.messages[1]).toBe(toolMessage)
    expect(reconciled.threads[0]?.messages[1]?.parts?.[0]).toHaveProperty('images')
  })

  test('replaces a message when its turn completion timestamp arrives', () => {
    const previous = history('Running')
    const next = structuredClone(previous)
    const message = next.threads[0]?.messages[0]
    if (!message) throw new Error('Missing message fixture')
    message.completedAt = '2026-08-17T12:01:10.000Z'

    const reconciled = reconcileAgentConversationHistory(previous, next)

    expect(reconciled.threads[0]?.messages[0]).toBe(message)
    expect(reconciled.threads[0]?.messages[0]?.completedAt).toBe('2026-08-17T12:01:10.000Z')
  })

  test('keeps a retained transcript mounted while merging a new preview tail', () => {
    const previous = [
      { createdAt: '2026-08-19T10:00:00.000Z', id: 'one', role: 'user' as const, text: 'one' },
      {
        createdAt: '2026-08-19T10:00:01.000Z',
        id: 'two',
        role: 'assistant' as const,
        text: 'old two'
      },
      {
        createdAt: '2026-08-19T10:00:02.000Z',
        id: 'three',
        role: 'user' as const,
        text: 'three'
      },
      {
        createdAt: '2026-08-19T10:00:03.000Z',
        id: 'four',
        role: 'assistant' as const,
        text: 'four'
      }
    ]
    const preview = [
      {
        createdAt: '2026-08-19T10:00:01.000Z',
        id: 'two',
        role: 'assistant' as const,
        text: 'updated two'
      },
      previous[3],
      {
        createdAt: '2026-08-19T10:00:04.000Z',
        id: 'five',
        role: 'user' as const,
        text: 'five'
      }
    ]

    const reconciled = reconcileRetainedConversationMessages(previous, preview)

    expect(reconciled.map((message) => message.id)).toEqual(['one', 'two', 'three', 'four', 'five'])
    expect(reconciled[0]).toBe(previous[0])
    expect(reconciled[1]).toBe(preview[0])
    expect(reconciled[2]).toBe(previous[2])
    expect(reconciled[3]).toBe(previous[3])
    expect(reconciled[4]).toBe(preview[2])
  })

  test('preview cannot delete retained empty-text tool and reasoning rows', () => {
    const previous = [
      {
        createdAt: '2026-08-20T18:00:00.000Z',
        id: 'user-1',
        role: 'user' as const,
        text: 'Fix the worker card'
      },
      {
        createdAt: '2026-08-20T18:00:01.000Z',
        id: 'think-1',
        parts: [
          { state: 'complete' as const, text: 'Inspect the Board card first.', type: 'reasoning' }
        ],
        role: 'assistant' as const,
        text: ''
      },
      {
        createdAt: '2026-08-20T18:00:02.000Z',
        id: 'tool-1',
        parts: [
          {
            input: '{"command":"ls"}',
            name: 'Run command',
            state: 'running' as const,
            type: 'tool'
          }
        ],
        role: 'assistant' as const,
        text: ''
      },
      {
        createdAt: '2026-08-20T18:00:03.000Z',
        id: 'tool-2',
        parts: [
          { input: 'src/app.ts', name: 'Edited files', state: 'success' as const, type: 'tool' }
        ],
        role: 'assistant' as const,
        text: ''
      }
    ]
    const preview = [previous[0]]

    const reconciled = reconcileRetainedConversationMessages(previous, preview)

    expect(reconciled.map((message) => message.id)).toEqual([
      'user-1',
      'think-1',
      'tool-1',
      'tool-2'
    ])
    expect(reconciled[1]?.parts?.[0]).toMatchObject({
      text: 'Inspect the Board card first.',
      type: 'reasoning'
    })
    expect(reconciled[2]?.parts?.[0]).toMatchObject({ name: 'Run command', type: 'tool' })
    expect(reconciled[3]?.parts?.[0]).toMatchObject({ name: 'Edited files', type: 'tool' })
    expect(
      retainedTranscriptNeedsHydrate({
        hydratedMessageCount: 4,
        hydratedUpdatedAt: '2026-08-20T18:00:03.000Z',
        retainedMessageCount: reconciled.length,
        updatedAt: '2026-08-20T18:00:03.000Z'
      })
    ).toBe(false)
    expect(
      retainedTranscriptNeedsHydrate({
        hydratedMessageCount: 4,
        hydratedUpdatedAt: '2026-08-20T18:00:03.000Z',
        retainedMessageCount: preview.length,
        updatedAt: '2026-08-20T18:00:03.000Z'
      })
    ).toBe(true)
  })

  test('preview text-only copies cannot strip retained activity parts', () => {
    const previous = [
      {
        createdAt: '2026-08-20T18:00:02.000Z',
        id: 'asst-1',
        parts: [
          { text: 'Working', type: 'text' as const },
          { name: 'Read', state: 'success' as const, type: 'tool' }
        ],
        role: 'assistant' as const,
        text: 'Working'
      }
    ]
    const preview = [
      {
        createdAt: '2026-08-20T18:00:02.000Z',
        id: 'asst-1',
        role: 'assistant' as const,
        text: 'Working'
      }
    ]

    const reconciled = reconcileRetainedConversationMessages(previous, preview)

    expect(reconciled).toHaveLength(1)
    expect(reconciled[0]?.parts).toEqual(previous[0]?.parts)
  })
})
