import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { applyPiJsonEvent } from '#mcp/pi/events'

function thread(): AgentConversationThread {
  return {
    canFollowUp: false,
    createdAt: '2026-08-21T12:00:00.000Z',
    effort: 'high',
    id: 'thread-1',
    messages: [],
    model: 'xai/grok-4.6',
    recentUpdate: 'Starting Pi.',
    sessionId: null,
    state: 'running',
    task: 'Route this',
    updatedAt: '2026-08-21T12:00:00.000Z',
    workerId: 'worker-1'
  }
}

describe('Pi JSON events', () => {
  test('binds the session and streams assistant text', () => {
    const next = thread()
    expect(
      applyPiJsonEvent(next, JSON.stringify({ id: 'session-1', type: 'session' }), 'turn-1')
    ).toBe(true)
    expect(next.sessionId).toBe('session-1')
    expect(next.canFollowUp).toBe(true)
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: { contentIndex: 0, delta: 'Continuing ', type: 'text_delta' },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: { contentIndex: 0, delta: 'on Worker 1.', type: 'text_delta' },
        type: 'message_update'
      }),
      'turn-1'
    )
    expect(next.messages.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'Continuing on Worker 1.'
    })
    expect(next.messages.at(-1)?.parts).toBeUndefined()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [{ text: 'Continuing on Worker 1.', type: 'text' }],
          role: 'assistant'
        },
        type: 'message_end'
      }),
      'turn-1'
    )
    expect(next.messages).toHaveLength(1)
    expect(next.messages.at(-1)?.text).toBe('Continuing on Worker 1.')
    expect(next.recentUpdate).toBe('Continuing on Worker 1.')
  })

  test('shows a running tool without deciding the turn outcome', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { api_key: 'super-secret', path: 'README.md' },
        toolCallId: 'call-1',
        toolName: 'read',
        type: 'tool_execution_start'
      }),
      'turn-1'
    )
    expect(next.recentUpdate).toBe('read…')
    const startedAt = next.messages.at(-1)?.createdAt
    const startedPart = next.messages.at(-1)?.parts?.[0]
    expect(startedPart).toMatchObject({
      name: 'read',
      state: 'running',
      type: 'tool'
    })
    expect(startedPart?.type === 'tool' ? startedPart.input : '').toContain('"path": "README.md"')
    expect(JSON.stringify(next.messages)).not.toContain('super-secret')
    expect(JSON.stringify(next.messages)).toContain('[redacted]')
    applyPiJsonEvent(
      next,
      JSON.stringify({
        isError: false,
        result: { content: [{ text: 'Project notes', type: 'text' }] },
        toolCallId: 'call-1',
        toolName: 'read',
        type: 'tool_execution_end'
      }),
      'turn-1'
    )
    expect(next.messages.at(-1)?.createdAt).toBe(startedAt)
    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      input: expect.stringContaining('"path": "README.md"'),
      name: 'read',
      output: 'Project notes',
      state: 'success',
      type: 'tool'
    })
    applyPiJsonEvent(next, JSON.stringify({ type: 'agent_settled' }), 'turn-1')
    expect(next.state).toBe('running')
  })

  test('keeps failure output authoritative when Pi reports isError', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { exact_words: 'Route this' },
        toolCallId: 'call-failed',
        toolName: 'dispatch_work',
        type: 'tool_execution_start'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        isError: true,
        result: {
          content: [{ text: 'Semantic dispatch failed: no eligible worker.', type: 'text' }]
        },
        toolCallId: 'call-failed',
        toolName: 'dispatch_work',
        type: 'tool_execution_end'
      }),
      'turn-1'
    )
    applyPiJsonEvent(next, JSON.stringify({ type: 'agent_settled' }), 'turn-1')

    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      error: 'Semantic dispatch failed: no eligible worker.',
      name: 'dispatch_work',
      state: 'error',
      type: 'tool'
    })
    expect(next.recentUpdate).toBe('dispatch_work failed.')
    expect(next.state).toBe('running')
  })

  test('recognizes semantic failure output when Pi reports isError false', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { server: 'openpencil', tool: 'openpencil_dispatch_work' },
        isError: false,
        result: {
          content: [
            {
              text: 'Failed to call openpencil_dispatch_work: Semantic dispatch failed.',
              type: 'text'
            }
          ]
        },
        toolCallId: 'call-semantic-failure',
        toolName: 'mcp',
        type: 'tool_execution_end'
      }),
      'turn-1'
    )

    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      error: 'Failed to call openpencil_dispatch_work: Semantic dispatch failed.',
      name: 'openpencil_dispatch_work',
      state: 'error',
      type: 'tool'
    })
    expect(next.state).toBe('running')
  })

  test('keeps the connected-app tool identity when the completion event omits its arguments', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { args: { query: 'today' }, server: 'gmail', tool: 'gmail_search' },
        toolCallId: 'call-gmail',
        toolName: 'mcp',
        type: 'tool_execution_start'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        isError: false,
        result: { content: [{ text: 'No messages found.', type: 'text' }] },
        toolCallId: 'call-gmail',
        toolName: 'mcp',
        type: 'tool_execution_end'
      }),
      'turn-1'
    )

    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      name: 'gmail_search',
      state: 'success',
      type: 'tool'
    })
    expect(next.recentUpdate).toBe('gmail_search')
  })

  test('keeps MCP image results inside their tool output without dumping base64 into text', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: {
          args: { object_ids: ['0:42'], page_id: '0:2' },
          server: 'openpencil',
          tool: 'openpencil_board_screenshot'
        },
        isError: false,
        result: {
          content: [
            { text: '{"objectIds":["0:42"]}', type: 'text' },
            { data: 'iVBORw==', mimeType: 'image/png', type: 'image' }
          ]
        },
        toolCallId: 'call-screenshot',
        toolName: 'mcp',
        type: 'tool_execution_end'
      }),
      'turn-1'
    )

    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]?.parts?.[0]).toMatchObject({
      images: [
        {
          alt: 'Board screenshot',
          url: 'data:image/png;base64,iVBORw=='
        }
      ],
      name: 'openpencil_board_screenshot',
      output: '{"objectIds":["0:42"]}',
      state: 'success',
      type: 'tool'
    })
    expect(next.messages[0]?.parts?.[0]).not.toHaveProperty(
      'output',
      expect.stringContaining('iVBORw')
    )
  })

  test('keeps intermediate tool-use text in order instead of replacing it with the final answer', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            { text: 'I will inspect the Board.', type: 'text' },
            { id: 'call-1', name: 'bash', type: 'toolCall' }
          ],
          responseId: 'response-tool',
          role: 'assistant',
          stopReason: 'toolUse'
        },
        type: 'message_end'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [{ text: 'Finished.', type: 'text' }],
          responseId: 'response-final',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    expect(next.messages).toHaveLength(2)
    expect(next.messages[0]).toMatchObject({
      id: 'pi-agent:turn-1:response-tool',
      parts: [{ state: 'complete', text: 'I will inspect the Board.', type: 'reasoning' }],
      text: ''
    })
    expect(next.messages[1]).toMatchObject({
      id: 'pi-agent:turn-1:response-final',
      text: 'Finished.'
    })
  })

  test('names Pi connected-app discovery as search activity', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { search: 'gmail' },
        toolCallId: 'call-search',
        toolName: 'mcp',
        type: 'tool_execution_start'
      }),
      'turn-1'
    )

    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      name: 'connected_app_search',
      state: 'running',
      type: 'tool'
    })
  })

  test('projects Antigravity tool markers into the safe activity timeline', () => {
    const next = thread()
    const commandActivity = [
      '[agy tool: run_command]',
      '[agy input]',
      '{"CommandLine":"bun test tests/engine/mcp/pi/events.test.ts","password":"dont-store-this"}',
      '[/agy input]',
      ''
    ].join('\n')
    const editActivity = [
      '[agy edit: Update Board layout]',
      '[agy input]',
      '{"description":"Update Board layout","path":"src/views/EditorView.vue"}',
      '[/agy input]',
      '[agy output]',
      '@@ -1,1 +1,1 @@\n-old layout\n+new layout',
      '[/agy output]',
      ''
    ].join('\n')
    const connectedAppActivity = [
      '[agy tool: call_mcp_tool]',
      '[agy input]',
      '{"Arguments":{"args":{},"tool":"codex_apps_gmail_get_profile"},"ServerName":"pi-antigravity-bridge","ToolName":"mcp","toolAction":"Getting Gmail profile","toolSummary":"Check Gmail connection and profile"}',
      '[/agy input]',
      ''
    ].join('\n')
    const thinking = `[agy tool: view_file]\n${commandActivity}${connectedAppActivity}${editActivity}private reasoning`
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: { contentIndex: 0, type: 'thinking_start' },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: '[agy tool: view_file]\n',
          type: 'thinking_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: commandActivity,
          type: 'thinking_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: connectedAppActivity,
          type: 'thinking_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: editActivity,
          type: 'thinking_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      name: 'edit',
      state: 'running',
      type: 'tool'
    })
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          content: thinking,
          contentIndex: 0,
          type: 'thinking_end'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            {
              thinking,
              type: 'thinking'
            },
            { text: 'Finished.', type: 'text' }
          ],
          role: 'assistant'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    const tools = next.messages.flatMap(
      (message) => message.parts?.filter((part) => part.type === 'tool') ?? []
    )
    expect(tools).toEqual([
      { name: 'view_file', state: 'success', type: 'tool' },
      {
        input:
          '{"CommandLine":"bun test tests/engine/mcp/pi/events.test.ts","password":"[redacted]"}',
        name: 'run_command',
        state: 'success',
        type: 'tool'
      },
      {
        input:
          '{"Arguments":{"args":{},"tool":"codex_apps_gmail_get_profile"},"ServerName":"pi-antigravity-bridge","ToolName":"mcp","toolAction":"Getting Gmail profile","toolSummary":"Check Gmail connection and profile"}',
        name: 'codex_apps_gmail_get_profile',
        state: 'success',
        type: 'tool'
      },
      {
        input: '{"description":"Update Board layout","path":"src/views/EditorView.vue"}',
        name: 'edit',
        output: '@@ -1,1 +1,1 @@\n-old layout\n+new layout',
        state: 'success',
        type: 'tool'
      }
    ])
    expect(next.messages.at(-1)?.text).toBe('Finished.')
    expect(JSON.stringify(next.messages)).not.toContain('private reasoning')
    expect(JSON.stringify(next.messages)).not.toContain('dont-store-this')
  })

  test('attaches completed Antigravity image tool output to the generated-image part', () => {
    const next = thread()
    const imagePath = resolve('packages/demos/videos/toolbar.png')
    const activityInput = [
      '[agy tool: call_mcp_tool]',
      '[agy input]',
      '{"Arguments":{"prompt":"A clean toolbar"},"ToolName":"ima2-media_generate_image"}',
      '[/agy input]'
    ]
    const runningActivity = [
      ...activityInput,
      '[agy output]',
      'Step is still running',
      '[/agy output]',
      ''
    ].join('\n')
    const completedActivity = [
      ...activityInput,
      '[agy output]',
      JSON.stringify({ result: { images: [{ path: imagePath }] }, status: 'completed' }),
      '[/agy output]',
      ''
    ].join('\n')

    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: { contentIndex: 0, type: 'thinking_start' },
        type: 'message_update'
      }),
      'turn-image'
    )
    for (const delta of [runningActivity, completedActivity]) {
      applyPiJsonEvent(
        next,
        JSON.stringify({
          assistantMessageEvent: { contentIndex: 0, delta, type: 'thinking_delta' },
          type: 'message_update'
        }),
        'turn-image'
      )
    }
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          content: `${runningActivity}${completedActivity}`,
          contentIndex: 0,
          type: 'thinking_end'
        },
        type: 'message_update'
      }),
      'turn-image'
    )

    const imagePart = next.messages
      .flatMap((message) => message.parts ?? [])
      .find((part) => part.type === 'tool')
    expect(
      next.messages.flatMap((message) => message.parts ?? []).filter((part) => part.type === 'tool')
    ).toHaveLength(1)
    expect(imagePart).toMatchObject({
      input: '{"Arguments":{"prompt":"A clean toolbar"},"ToolName":"ima2-media_generate_image"}',
      name: 'ima2-media_generate_image',
      state: 'success',
      type: 'tool'
    })
    expect(imagePart?.type === 'tool' ? imagePart.images?.[0]?.url : '').toStartWith(
      'data:image/png;base64,'
    )
  })

  test('shows a safe thinking lifecycle without exposing private thinking text', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: { contentIndex: 0, type: 'thinking_start' },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: 'private chain of thought',
          type: 'thinking_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    expect(next.messages).toHaveLength(1)
    expect(next.messages[0]?.parts?.[0]).toEqual({
      state: 'streaming',
      text: 'Thinking',
      type: 'reasoning'
    })
    expect(JSON.stringify(next.messages)).not.toContain('private chain of thought')

    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          content: 'private chain of thought',
          contentIndex: 0,
          type: 'thinking_end'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            { thinking: 'private chain of thought', type: 'thinking' },
            { text: 'Visible answer.', type: 'text' }
          ],
          role: 'assistant'
        },
        type: 'message_end'
      }),
      'turn-1'
    )
    expect(next.messages[0]?.parts?.[0]).toEqual({
      state: 'complete',
      text: 'Thought',
      type: 'reasoning'
    })
    expect(next.messages.at(-1)?.text).toBe('Visible answer.')
    expect(JSON.stringify(next.messages)).not.toContain('private chain of thought')
  })
})
