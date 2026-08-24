import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import {
  THREAD_MEMORY_FULL_TURN_LIMIT,
  THREAD_MEMORY_TOOL_OUTPUT_CHARS,
  compactAgentThreadMemory
} from '#mcp/pi/thread-memory'

function threadWithTurns(turns: number): AgentConversationThread {
  const messages = Array.from({ length: turns }, (_, index) => {
    const createdAt = `2026-08-21T00:00:${String(index).padStart(2, '0')}.000Z`
    return [
      {
        createdAt,
        id: `user-${index}`,
        role: 'user' as const,
        text: `Turn ${index}`
      },
      {
        completedAt: createdAt,
        createdAt,
        id: `assistant-${index}`,
        parts: [
          {
            input: 'x'.repeat(2_000),
            name: 'read',
            output: 'y'.repeat(4_000),
            state: 'success' as const,
            type: 'tool' as const
          }
        ],
        role: 'assistant' as const,
        text: `Answer ${index}`
      }
    ]
  }).flat()
  return {
    canFollowUp: true,
    createdAt: '2026-08-21T00:00:00.000Z',
    effort: 'high',
    id: 'thread-memory',
    messages,
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Done.',
    sessionId: 'session-memory',
    state: 'completed',
    task: 'Turn 0',
    updatedAt: '2026-08-21T00:00:00.000Z',
    workerId: 'worker-1'
  }
}

describe('Pi stored thread memory', () => {
  test('leaves the live turn intact and clips older tool output', () => {
    const conversation = threadWithTurns(THREAD_MEMORY_FULL_TURN_LIMIT + 3)
    expect(compactAgentThreadMemory(conversation)).toBe(true)

    const firstTool = conversation.messages[1]?.parts?.[0]
    const liveTool = conversation.messages[conversation.messages.length - 1]?.parts?.[0]
    expect(firstTool && 'output' in firstTool ? String(firstTool.output).length : 0).toBeLessThan(
      200
    )
    expect(liveTool && 'output' in liveTool ? String(liveTool.output).length : 0).toBe(4_000)
    expect(conversation.messages[conversation.messages.length - 2]?.text).toBe(
      `Turn ${THREAD_MEMORY_FULL_TURN_LIMIT + 2}`
    )
  })

  test('clips retained tool output to the stored-history cap', () => {
    const conversation = threadWithTurns(2)
    compactAgentThreadMemory(conversation)
    const older = conversation.messages[1]?.parts?.[0]
    const olderOutput = older && 'output' in older ? String(older.output) : ''
    expect(olderOutput.length).toBeLessThanOrEqual(THREAD_MEMORY_TOOL_OUTPUT_CHARS)
    expect(olderOutput.startsWith('y')).toBe(true)
    expect(olderOutput.endsWith('y')).toBe(true)
    expect(olderOutput).toContain('\n…\n')
  })

  test('collapses persisted wrap-up and commentary copies in the same turn', () => {
    const wrapUp = 'The header now uses the shared Board chrome.'
    const commentary = 'Inspecting the header before I edit it.'
    const conversation: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-21T00:00:00.000Z',
      effort: 'high',
      id: 'thread-dupes',
      messages: [
        {
          createdAt: '2026-08-21T00:00:00.000Z',
          id: 'user-0',
          role: 'user',
          text: 'Earlier turn'
        },
        {
          completedAt: '2026-08-21T00:00:01.000Z',
          createdAt: '2026-08-21T00:00:01.000Z',
          id: 'assistant-0',
          role: 'assistant',
          text: wrapUp
        },
        {
          createdAt: '2026-08-21T13:58:00.000Z',
          id: 'user-1',
          role: 'user',
          text: 'Finish the header.'
        },
        {
          completedAt: '2026-08-21T13:59:06.400Z',
          createdAt: '2026-08-21T13:59:06.400Z',
          id: 'pi-agent:job-1:chatcmpl-live:commentary:1',
          parts: [{ state: 'complete', text: commentary, type: 'commentary' }],
          role: 'assistant',
          text: ''
        },
        {
          completedAt: '2026-08-21T13:59:06.410Z',
          createdAt: '2026-08-21T13:59:06.410Z',
          id: 'pi-agent:job-1:d708023c:commentary:1',
          parts: [{ state: 'complete', text: commentary, type: 'commentary' }],
          role: 'assistant',
          text: ''
        },
        {
          completedAt: '2026-08-21T13:59:06.472Z',
          createdAt: '2026-08-21T13:59:06.472Z',
          id: 'pi-agent:job-1:chatcmpl-e034d9b031ea4199ae75f0a01a58',
          role: 'assistant',
          text: wrapUp
        },
        {
          completedAt: '2026-08-21T13:59:06.481Z',
          createdAt: '2026-08-21T13:59:06.481Z',
          id: 'pi-agent:job-1:b665f085',
          role: 'assistant',
          text: wrapUp
        },
        {
          completedAt: '2026-08-21T13:59:06.490Z',
          createdAt: '2026-08-21T13:59:06.490Z',
          id: 'pi-tool:job-1:call-1',
          parts: [
            {
              name: 'read',
              output: 'header contents',
              state: 'success',
              type: 'tool'
            }
          ],
          role: 'assistant',
          text: ''
        }
      ],
      model: 'xai-auth/grok-4.6',
      recentUpdate: wrapUp,
      sessionId: 'session-dupes',
      state: 'completed',
      task: 'Finish the header.',
      updatedAt: '2026-08-21T13:59:06.481Z',
      workerId: 'worker-1'
    }

    expect(compactAgentThreadMemory(conversation)).toBe(true)
    expect(
      conversation.messages.filter((message) => message.role === 'assistant' && message.text.trim())
    ).toEqual([
      expect.objectContaining({ id: 'assistant-0', text: wrapUp }),
      expect.objectContaining({
        completedAt: '2026-08-21T13:59:06.481Z',
        id: 'pi-agent:job-1:chatcmpl-e034d9b031ea4199ae75f0a01a58',
        text: wrapUp
      })
    ])
    expect(
      conversation.messages.filter((message) =>
        message.parts?.some((part) => part.type === 'commentary')
      )
    ).toEqual([
      expect.objectContaining({
        completedAt: '2026-08-21T13:59:06.410Z',
        id: 'pi-agent:job-1:chatcmpl-live:commentary:1'
      })
    ])
    expect(
      conversation.messages.some((message) =>
        message.parts?.some((part) => part.type === 'tool' && part.name === 'read')
      )
    ).toBe(true)
  })
})
