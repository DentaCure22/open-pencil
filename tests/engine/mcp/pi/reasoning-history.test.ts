import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { migrateProviderActivityHistory } from '#mcp/pi/reasoning-history'

function thread(): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-21T00:00:00.000Z',
    effort: 'high',
    id: 'thread-1',
    messages: [],
    model: 'openai-codex/gpt-5.6-sol',
    recentUpdate: 'Done',
    sessionId: 'session-1',
    state: 'completed',
    task: 'Do the work',
    updatedAt: '2026-08-21T00:01:00.000Z',
    workerId: 'worker-1'
  }
}

describe('Pi provider activity history migration', () => {
  test('keeps provider reasoning and moves legacy preambles to commentary', () => {
    const target = thread()
    target.messages = [
      {
        createdAt: '2026-08-21T00:00:00.000Z',
        id: 'pi-thinking:job-1:0:0',
        parts: [{ state: 'complete', text: 'Inspecting the implementation.', type: 'reasoning' }],
        role: 'assistant',
        text: ''
      },
      {
        createdAt: '2026-08-21T00:00:01.000Z',
        id: 'pi-session-thinking:thread-1:entry-1:0',
        parts: [{ state: 'complete', text: 'Planning the integration.', type: 'reasoning' }],
        role: 'assistant',
        text: ''
      },
      {
        createdAt: '2026-08-21T00:00:02.000Z',
        id: 'pi-agent:job-1:response-1',
        parts: [
          {
            state: 'complete',
            text: 'The bridge contract is verified. I’m updating the event mapping next.',
            type: 'reasoning'
          }
        ],
        role: 'assistant',
        text: ''
      }
    ]

    expect(migrateProviderActivityHistory(target)).toBe(true)
    expect(target.messages).toEqual([
      {
        createdAt: '2026-08-21T00:00:00.000Z',
        id: 'pi-thinking:job-1:0:0',
        parts: [{ state: 'complete', text: 'Inspecting the implementation.', type: 'reasoning' }],
        role: 'assistant',
        text: ''
      },
      {
        createdAt: '2026-08-21T00:00:01.000Z',
        id: 'pi-session-thinking:thread-1:entry-1:0',
        parts: [{ state: 'complete', text: 'Planning the integration.', type: 'reasoning' }],
        role: 'assistant',
        text: ''
      },
      {
        createdAt: '2026-08-21T00:00:02.000Z',
        id: 'pi-agent:job-1:response-1',
        parts: [
          {
            state: 'complete',
            text: 'The bridge contract is verified. I’m updating the event mapping next.',
            type: 'commentary'
          }
        ],
        role: 'assistant',
        text: ''
      }
    ])
  })

  test('leaves unrelated authored reasoning parts intact', () => {
    const target = thread()
    target.messages = [
      {
        createdAt: '2026-08-21T00:00:00.000Z',
        id: 'fixture-reasoning',
        parts: [{ state: 'complete', text: 'Authored explanation.', type: 'reasoning' }],
        role: 'assistant',
        text: ''
      }
    ]

    expect(migrateProviderActivityHistory(target)).toBe(false)
    expect(target.messages[0]?.parts?.[0]?.type).toBe('reasoning')
  })

  test('reopens persisted Antigravity heartbeat rows that were incorrectly marked successful', () => {
    const target = thread()
    target.messages = [
      {
        completedAt: '2026-08-21T00:00:05.000Z',
        createdAt: '2026-08-21T00:00:00.000Z',
        id: 'pi-agy-tool:job-1:0:0',
        parts: [
          {
            name: 'openpencil_board_where',
            output: 'Step is still running.',
            state: 'success',
            type: 'tool'
          }
        ],
        role: 'assistant',
        text: ''
      }
    ]

    expect(migrateProviderActivityHistory(target)).toBe(true)
    expect(target.messages[0]).not.toHaveProperty('completedAt')
    expect(target.messages[0]?.parts?.[0]).toMatchObject({
      output: 'Step is still running.',
      state: 'running',
      type: 'tool'
    })
  })
})
