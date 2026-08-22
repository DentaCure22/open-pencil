import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import {
  compactAgentChatCandidates,
  compactAgentChatContext,
  composeDispatchRequest,
  composeDispatchWorkPrompt,
  registerDispatchWorkTool
} from '#mcp/tool/dispatch-registration'
import { registerLiveParentTools } from '#mcp/tool/live-parent-registration'

type RegisteredTool = {
  description?: string
  inputSchema?: z.ZodType
}

function setup() {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(name: string, options: { description?: string; inputSchema: z.ZodType }) {
      tools.set(name, { description: options.description, inputSchema: options.inputSchema })
    }
  }
  registerDispatchWorkTool(server as McpServer)
  registerLiveParentTools(server as McpServer)
  return tools
}

describe('live-parent MCP registration', () => {
  test('registers the compact OpenPencil remote', () => {
    const tools = setup()
    expect([...tools.keys()].sort()).toEqual([
      'board_go',
      'board_screenshot',
      'board_where',
      'dispatch_work',
      'get_agent_chat_context',
      'list_agent_chats',
      'set_theme'
    ])
    expect(tools.get('board_screenshot')?.description).toContain('Read-only')
    expect(tools.get('board_screenshot')?.description).toContain('available to workers')
    expect(tools.get('board_where')?.description).toContain('Read-only')
    expect(tools.get('board_where')?.description).toContain('Workers may call this once')
    expect(tools.get('board_go')?.description).toContain('Never dispatch navigation')
    expect(tools.get('set_theme')?.description).toContain('light, dark, or auto')
    expect(tools.get('get_agent_chat_context')?.description).toContain('at most six')
    expect(tools.get('list_agent_chats')?.description).toContain('Omit query')
    expect(tools.get('list_agent_chats')?.description).toContain('does not report')
    expect(tools.has('board_context')).toBe(false)
    expect(tools.has('board_build')).toBe(false)
    expect(tools.has('open_file')).toBe(false)
  })

  test('requires exact Board IDs for screenshots', () => {
    const schema = toolsSchema(setup(), 'board_screenshot')
    expect(Object.keys(schema.shape).sort()).toEqual(['object_ids', 'page_id', 'scale'])
    expect(schema.safeParse({ object_ids: ['0:42'], page_id: '0:2', scale: 1 }).success).toBe(true)
    expect(schema.safeParse({ object_ids: [], page_id: '0:2' }).success).toBe(false)
  })

  test('dispatch_work carries the exact words and their spoken window', () => {
    const tools = setup()
    expect(tools.get('dispatch_work')?.description).toContain('what the user said')
    const schema = tools.get('dispatch_work')?.inputSchema
    expect(schema).toBeDefined()
    expect(Object.keys((schema as z.ZodObject<Record<string, z.ZodType>>).shape).sort()).toEqual([
      'action',
      'continue_thread_id',
      'done',
      'exact_words',
      'target_thread_id',
      'turn_ended_at',
      'turn_started_at'
    ])
  })

  test('lists structured chat candidates without transcript or session fields', () => {
    const tools = setup()
    expect(tools.get('list_agent_chats')?.description).toContain('Read-only')
    const result = compactAgentChatCandidates(
      {
        threads: [
          {
            canFollowUp: true,
            id: 'thread-running',
            messages: [
              { role: 'user', text: 'Fix the Dental Chart object `0:42`.' },
              {
                role: 'assistant',
                text: 'Aligned `odontogram-grid` in `patients-list.tsx`.'
              },
              {
                parts: [{ output: 'large secret tool output', type: 'tool' }],
                role: 'assistant',
                text: ''
              }
            ],
            recentUpdate: 'Editing odontogram layout.',
            sessionId: 'native-secret-running',
            state: 'running',
            task: 'Dental Chart cleanup',
            updatedAt: '2026-08-22T12:00:00.000Z'
          },
          {
            canFollowUp: true,
            id: 'thread-old',
            messages: [{ role: 'assistant', text: 'The launcher was repaired.' }],
            recentUpdate: 'Completed.',
            sessionId: 'native-secret-old',
            state: 'completed',
            task: 'Smylr launcher',
            updatedAt: '2026-08-21T12:00:00.000Z'
          }
        ]
      },
      'dental chart'
    )

    expect(result).toEqual({
      boardPlacement: 'not_reported',
      candidates: [
        {
          currentTask: 'Fix the Dental Chart object `0:42`.',
          latestResult: 'Aligned `odontogram-grid` in `patients-list.tsx`.',
          references: ['0:42', 'odontogram-grid', 'patients-list.tsx'],
          resumable: true,
          state: 'running',
          status: 'Editing odontogram layout.',
          threadId: 'thread-running',
          updatedAt: '2026-08-22T12:00:00.000Z'
        }
      ],
      hasMore: false,
      matched: 1,
      resumableCount: 1,
      runningCount: 1,
      scope: 'resident_pi_chats'
    })
    expect(JSON.stringify(result)).not.toContain('native-secret')
    expect(JSON.stringify(result)).not.toContain('tool output')
  })

  test('returns one focused chat context without tool activity', () => {
    const result = compactAgentChatContext({
      canFollowUp: true,
      id: 'thread-focused',
      messages: [
        { role: 'user', text: 'Original request.' },
        {
          parts: [{ input: 'hidden input', output: 'hidden output', type: 'tool' }],
          role: 'assistant',
          text: ''
        },
        { role: 'assistant', text: 'Original result.' },
        { role: 'user', text: 'Current request for `0:42`.' },
        { role: 'assistant', text: 'Current result.' }
      ],
      recentUpdate: 'Current result.',
      sessionId: 'native-secret',
      state: 'completed',
      task: 'Original request.',
      updatedAt: '2026-08-22T12:00:00.000Z'
    })

    expect(result).toMatchObject({
      currentTask: 'Current request for `0:42`.',
      latestResult: 'Current result.',
      originTask: 'Original request.',
      references: ['0:42'],
      status: ''
    })
    expect(result.recentMessages).toHaveLength(4)
    expect(JSON.stringify(result)).not.toContain('hidden')
    expect(JSON.stringify(result)).not.toContain('native-secret')
  })

  test('requires concrete query matches instead of substring noise', () => {
    const result = compactAgentChatCandidates(
      {
        threads: [
          {
            canFollowUp: true,
            id: 'thread-patients',
            messages: [{ role: 'user', text: 'Center the patients search.' }],
            sessionId: 'session-patients',
            state: 'completed',
            task: 'Move this right',
            updatedAt: '2026-08-22T12:00:00.000Z'
          },
          {
            canFollowUp: true,
            id: 'thread-research',
            messages: [{ role: 'user', text: 'Research Apple leadership.' }],
            sessionId: 'session-research',
            state: 'completed',
            task: 'Use Exa to research',
            updatedAt: '2026-08-22T13:00:00.000Z'
          }
        ]
      },
      'patients search'
    )

    expect(result.candidates.map((candidate) => candidate.threadId)).toEqual(['thread-patients'])
  })

  test('treats generic chat-list wording as one unfiltered inventory request', () => {
    const result = compactAgentChatCandidates(
      {
        threads: [
          {
            canFollowUp: true,
            id: 'thread-completed',
            messages: [{ role: 'user', text: 'Center the patients search.' }],
            sessionId: 'session-completed',
            state: 'completed',
            task: 'Patients search',
            updatedAt: '2026-08-22T12:00:00.000Z'
          },
          {
            canFollowUp: false,
            id: 'thread-running',
            messages: [{ role: 'user', text: 'Repair the dental chart.' }],
            sessionId: null,
            state: 'running',
            task: 'Dental chart',
            updatedAt: '2026-08-22T13:00:00.000Z'
          }
        ]
      },
      'what chats do I have open up on the board'
    )

    expect(result.candidates.map((candidate) => candidate.threadId)).toEqual([
      'thread-running',
      'thread-completed'
    ])
    expect(result).toMatchObject({
      boardPlacement: 'not_reported',
      matched: 2,
      resumableCount: 1,
      runningCount: 1,
      scope: 'resident_pi_chats'
    })
  })

  test('returns six chat candidates by default', () => {
    const result = compactAgentChatCandidates({
      threads: Array.from({ length: 7 }, (_, index) => ({
        canFollowUp: true,
        id: `thread-${String(index)}`,
        messages: [],
        sessionId: `session-${String(index)}`,
        state: 'completed',
        task: `Task ${String(index)}`,
        updatedAt: `2026-08-22T12:00:0${String(index)}.000Z`
      }))
    })

    expect(result.candidates).toHaveLength(6)
    expect(result).toMatchObject({
      hasMore: true,
      matched: 7,
      resumableCount: 7,
      runningCount: 0
    })
  })

  test('routes new, continue, and fork without another dispatcher turn', () => {
    const shared = {
      done: 'The requested Board change is complete.',
      exact_words: 'Keep fixing the Dental Chart.',
      turn_ended_at: '2026-08-21T15:00:03.000Z',
      turn_started_at: '2026-08-21T15:00:00.000Z'
    }
    expect(composeDispatchRequest(shared)).toMatchObject({
      action: 'new',
      route: '/agent-router/v1/pi/dispatch'
    })
    expect(
      composeDispatchRequest({ ...shared, action: 'continue', target_thread_id: 'thread/one' })
    ).toMatchObject({
      action: 'continue',
      route: '/agent-router/v1/pi/conversations/thread%2Fone/follow-up',
      targetThreadId: 'thread/one'
    })
    expect(
      composeDispatchRequest({ ...shared, action: 'fork', target_thread_id: 'thread/one' })
    ).toMatchObject({
      action: 'fork',
      route: '/agent-router/v1/pi/conversations/thread%2Fone/fork',
      targetThreadId: 'thread/one'
    })
    expect(() => composeDispatchRequest({ ...shared, action: 'fork' })).toThrow(
      'fork requires target_thread_id'
    )
  })

  test('invokes the OpenPencil skill with Pi command syntax', () => {
    const prompt = composeDispatchWorkPrompt({
      done: 'The requested Board change is complete.',
      exact_words: 'Move the card to the left.',
      turn_ended_at: '2026-08-21T15:00:03.000Z',
      turn_started_at: '2026-08-21T15:00:00.000Z'
    })

    expect(prompt).toStartWith('/skill:openpencil Move the card to the left.')
    expect(prompt).toContain('Spoken turn: 2026-08-21T15:00:00.000Z to 2026-08-21T15:00:03.000Z')
    expect(prompt).not.toContain('$openpencil')
  })
})

function toolsSchema(tools: Map<string, RegisteredTool>, name: string) {
  const schema = tools.get(name)?.inputSchema
  if (!schema || !('shape' in schema)) throw new Error(`Expected ${name} object schema`)
  return schema as z.ZodObject<Record<string, z.ZodType>>
}
