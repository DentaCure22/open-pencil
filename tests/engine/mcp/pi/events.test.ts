import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { applyPiJsonEvent, ensureVisibleFinalResponse, threadClosingText } from '#mcp/pi/events'

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

  test('inlines an offloaded Antigravity tool dump on the native completion event', () => {
    const next = thread()
    next.model = 'antigravity/gemini-3-7-flash'
    const path = join(mkdtempSync(join(tmpdir(), 'agy-native-')), 'output.txt')
    writeFileSync(path, '{"emails":[{"subject":"ATM receipt"}]}')
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { search: 'gmail' },
        toolCallId: 'call-offload',
        toolName: 'mcp',
        type: 'tool_execution_start'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        result: `The output was large and was saved to: ${pathToFileURL(path).href}`,
        toolCallId: 'call-offload',
        toolName: 'mcp',
        type: 'tool_execution_end'
      }),
      'turn-1'
    )
    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      name: 'connected_app_search',
      output: '{"emails":[{"subject":"ATM receipt"}]}',
      state: 'success',
      type: 'tool'
    })
  })

  test('treats mcp describe as the same app lookup as mcp search', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { describe: 'codex_apps_gmail_search_emails' },
        toolCallId: 'call-describe',
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

  test('drops retired memory tickets instead of storing them', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { query: 'inbox' },
        toolCallId: 'call-memory',
        toolName: 'memory_search',
        type: 'tool_execution_start'
      }),
      'turn-1'
    )
    expect(next.messages).toEqual([])
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

  test('recognizes Antigravity timeout output when Pi reports isError false', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: {
          Arguments: { chat_guid: 'any;-;test-recipient', text: 'Hi' },
          ToolName: 'messages__send_send_message'
        },
        isError: false,
        result:
          'Encountered error in step execution: MCP tool call timed out: context deadline exceeded',
        toolCallId: 'call-message-timeout',
        toolName: 'messages__send_send_message',
        type: 'tool_execution_end'
      }),
      'turn-1'
    )

    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      error: expect.stringContaining('context deadline exceeded'),
      name: 'messages__send_send_message',
      state: 'error',
      type: 'tool'
    })
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
      id: 'pi-agent:turn-1:response-tool:commentary:0',
      parts: [{ state: 'complete', text: 'I will inspect the Board.', type: 'commentary' }],
      text: ''
    })
    expect(next.messages[1]).toMatchObject({
      id: 'pi-agent:turn-1:response-final',
      text: 'Finished.'
    })
  })

  test('keeps only the last Antigravity wrap-up when one stop concatenates earlier answers', () => {
    const next = thread()
    next.model = 'antigravity/gemini-3-7-flash'
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            { thinking: 'First wrap-up.', type: 'thinking' },
            { text: 'Apple Stock chart is ready.', type: 'text' },
            { thinking: 'Second wrap-up.', type: 'thinking' },
            { text: 'The Smylr Market report is on the Board.', type: 'text' }
          ],
          provider: 'antigravity',
          responseId: 'response-stop',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    expect(next.messages.filter((message) => message.text.trim())).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:response-stop',
        text: 'The Smylr Market report is on the Board.'
      })
    ])
  })

  test('keeps a Codex final_answer as the visible close', () => {
    const next = thread()
    next.model = 'openai-codex/gpt-5.6-sol'
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            { thinking: 'Planning the edit.', type: 'thinking' },
            {
              text: 'I will inspect the header.',
              textSignature: JSON.stringify({ id: 'msg-1', phase: 'commentary', v: 1 }),
              type: 'text'
            },
            {
              text: 'The spinner replaced the status dot.',
              textSignature: JSON.stringify({ id: 'msg-2', phase: 'final_answer', v: 1 }),
              type: 'text'
            }
          ],
          provider: 'openai-codex',
          responseId: 'response-stop',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    expect(next.messages.find((message) => message.text.trim())).toMatchObject({
      id: 'pi-agent:turn-1:response-stop',
      text: 'The spinner replaced the status dot.'
    })
  })

  test('keeps a Grok, Cursor, or Gemini final_answer as the visible close', () => {
    for (const [model, provider] of [
      ['xai-auth/grok-4.6', 'xai-auth'],
      ['cursor/cursor-grok-4.6-fast', 'cursor'],
      ['antigravity/gemini-3-7-flash', 'antigravity']
    ] as const) {
      const next = thread()
      next.model = model
      applyPiJsonEvent(
        next,
        JSON.stringify({
          message: {
            content: [
              {
                text: 'Checking yesterday.',
                textSignature: JSON.stringify({ id: 'msg-1', phase: 'commentary', v: 1 }),
                type: 'text'
              },
              {
                text: 'Saturday was quiet.',
                textSignature: JSON.stringify({ id: 'msg-2', phase: 'final_answer', v: 1 }),
                type: 'text'
              }
            ],
            provider,
            responseId: 'response-stop',
            role: 'assistant',
            stopReason: 'stop'
          },
          type: 'message_end'
        }),
        'turn-1'
      )
      expect(next.messages.find((message) => message.text.trim())).toMatchObject({
        text: 'Saturday was quiet.'
      })
    }
  })

  test('moves leftover streamed preamble into commentary when a thought lands on the same message', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: "I'll check your inbox now.",
          type: 'text_delta'
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
          delta: 'A few messages need attention.',
          partial: {
            content: [
              {
                text: 'A few messages need attention.',
                textSignature: JSON.stringify({ id: 'msg-commentary', phase: 'commentary', v: 1 }),
                type: 'text'
              }
            ]
          },
          type: 'text_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )

    const streamed = next.messages.find((message) => message.id === 'pi-agent:turn-1:assistant')
    expect(streamed?.text).toBe('')
    expect(streamed?.parts).toEqual([
      expect.objectContaining({
        text: "I'll check your inbox now.",
        type: 'commentary'
      }),
      expect.objectContaining({
        text: 'A few messages need attention.',
        type: 'commentary'
      })
    ])
  })

  test('keeps streamed progress visible when a tool starts', () => {
    const next = thread()
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: "I'll check your inbox now.",
          type: 'text_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        args: { query: 'newer_than:1d' },
        toolCallId: 'call-mail',
        toolName: 'read',
        type: 'tool_execution_start'
      }),
      'turn-1'
    )

    const streamed = next.messages.find((message) => message.id === 'pi-agent:turn-1:assistant')
    expect(streamed?.text).toBe("I'll check your inbox now.")
    expect(next.messages.at(-1)?.parts?.[0]).toMatchObject({
      name: 'read',
      state: 'running',
      type: 'tool'
    })
  })

  test('does not throw away a Cursor wrap-up that landed on the commentary streaming message', () => {
    const next = thread()
    next.model = 'cursor/cursor-grok-4.6-fast'
    const commentarySignature = JSON.stringify({ id: 'msg-commentary', phase: 'commentary', v: 1 })
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: 'Checking the header.',
          partial: {
            content: [
              {
                text: 'Checking the header.',
                textSignature: commentarySignature,
                type: 'text'
              }
            ]
          },
          type: 'text_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 1,
          delta: 'The New task button is in.',
          type: 'text_delta'
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
            { thinking: 'Wrapping up.', type: 'thinking' },
            { text: 'The New task button is in.', type: 'text' }
          ],
          provider: 'cursor',
          responseId: 'response-stop',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    expect(
      next.messages.filter((message) => message.text.trim()).map((message) => message.text)
    ).toEqual(['The New task button is in.'])
    expect(next.messages.some((message) => message.id === 'pi-agent:turn-1:assistant')).toBe(true)
  })

  test('keeps Cursor streamed wrap-up text instead of replacing it with a new stop id', () => {
    const next = thread()
    next.model = 'cursor/cursor-grok-4.6-fast'
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: 'The New task button is in.',
          type: 'text_delta'
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
            { thinking: 'Wrapping up.', type: 'thinking' },
            { text: 'The New task button is in.', type: 'text' }
          ],
          provider: 'cursor',
          responseId: 'response-stop',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    expect(next.messages.filter((message) => message.text.trim())).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:assistant',
        text: 'The New task button is in.'
      })
    ])
    expect(threadClosingText(next)).toBe('The New task button is in.')
  })

  test('keeps a Cursor streamed wrap-up when stop arrives without text', () => {
    const next = thread()
    next.model = 'cursor/cursor-grok-4.6-fast'
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: 'The spinner replaced the status dot.',
          type: 'text_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [{ thinking: 'Done.', type: 'thinking' }],
          provider: 'cursor',
          responseId: 'response-empty',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    expect(next.messages.filter((message) => message.text.trim())).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:assistant',
        text: 'The spinner replaced the status dot.'
      })
    ])
    expect(threadClosingText(next)).toBe('The spinner replaced the status dot.')
  })

  test('keeps a stop message visible even when the provider tags it as commentary', () => {
    const next = thread()
    const textSignature = JSON.stringify({ id: 'msg-final', phase: 'commentary', v: 1 })
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            {
              text: 'The header button and spinner are in.',
              textSignature,
              type: 'text'
            }
          ],
          responseId: 'response-stop',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    expect(next.messages).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:response-stop',
        text: 'The header button and spinner are in.'
      })
    ])
  })

  test('writes a captured wrap-up into the transcript when the turn settled without one', () => {
    const next = thread()
    next.messages = [
      {
        createdAt: '2026-08-23T13:30:00.000Z',
        id: 'user-1',
        role: 'user',
        text: 'Add the button.'
      },
      {
        createdAt: '2026-08-23T13:30:10.000Z',
        id: 'tool-1',
        parts: [{ name: 'edit', state: 'success', type: 'tool' }],
        role: 'assistant',
        text: ''
      }
    ]

    expect(ensureVisibleFinalResponse(next, 'The button is in.', '2026-08-23T13:32:12.000Z')).toBe(
      true
    )
    expect(next.messages.at(-1)).toMatchObject({
      id: 'pi-final:thread-1:2026-08-23T13:32:12.000Z',
      text: 'The button is in.'
    })
    expect(ensureVisibleFinalResponse(next, 'The button is in.', '2026-08-23T13:32:13.000Z')).toBe(
      false
    )
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
    const thinking = `[agy tool: view_file]\n${commandActivity}${connectedAppActivity}${editActivity}Provider-visible thought summary.`
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
    expect(JSON.stringify(next.messages)).not.toContain('Provider-visible thought summary.')
    expect(JSON.stringify(next.messages)).not.toContain('dont-store-this')
  })

  test('projects Antigravity leftover thinking as commentary and fills in file reads', () => {
    const next = thread()
    next.model = 'antigravity/gemini-3-7-flash'
    const read = [
      '[agy tool: view_file]',
      '[agy input]',
      '{"AbsolutePath":"README.md"}',
      '[/agy input]',
      '[agy output]',
      'File contents',
      '[/agy output]',
      ''
    ].join('\n')
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
          delta: '**Analyzing Chat Data**\n\nI found the target file.\n[agy tool: view_file]\n',
          type: 'thinking_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    expect(
      next.messages.find((message) => message.parts?.some((part) => part.type === 'commentary'))
        ?.parts?.[0]
    ).toMatchObject({
      text: '**Analyzing Chat Data**\n\nI found the target file.',
      type: 'commentary'
    })
    expect(
      next.messages.find((message) => message.parts?.some((part) => part.type === 'tool'))
        ?.parts?.[0]
    ).toMatchObject({
      name: 'view_file',
      state: 'running',
      type: 'tool'
    })
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: read,
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
          content: `**Analyzing Chat Data**\n\nI found the target file.\n[agy tool: view_file]\n${read}`,
          contentIndex: 0,
          type: 'thinking_end'
        },
        type: 'message_update'
      }),
      'turn-1'
    )

    const tools = next.messages.flatMap(
      (message) => message.parts?.filter((part) => part.type === 'tool') ?? []
    )
    expect(tools).toEqual([
      {
        input: '{"AbsolutePath":"README.md"}',
        name: 'view_file',
        output: 'File contents',
        state: 'success',
        type: 'tool'
      }
    ])
    expect(
      next.messages.find((message) => message.parts?.some((part) => part.type === 'commentary'))
        ?.parts?.[0]
    ).toMatchObject({
      state: 'complete',
      text: '**Analyzing Chat Data**\n\nI found the target file.',
      type: 'commentary'
    })
  })

  test('deduplicates a completed Antigravity transcript replayed under a fallback turn key', () => {
    const next = thread()
    next.model = 'antigravity/gemini-3-7-flash'
    next.messages.push({
      createdAt: '2026-08-23T13:32:00.000Z',
      id: 'user-1',
      role: 'user',
      text: 'Make a Board object.'
    })
    const thinking = [
      'Inspecting the selected page.',
      '[agy tool: view_file]',
      '[agy input]',
      '{"AbsolutePath":"workspace.json"}',
      '[/agy input]',
      '[agy output]',
      'Board contents',
      '[/agy output]'
    ].join('\n')
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: { content: thinking, contentIndex: 0, type: 'thinking_end' },
        type: 'message_update'
      }),
      'job-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            { thinking, type: 'thinking' },
            { text: 'Stopped before the Board changed.', type: 'text' }
          ],
          role: 'assistant',
          stopReason: 'aborted'
        },
        type: 'message_end'
      }),
      'session:thread-1'
    )

    const toolRows = next.messages.filter((message) =>
      message.parts?.some((part) => part.type === 'tool')
    )
    const commentaryRows = next.messages.filter((message) =>
      message.parts?.some((part) => part.type === 'commentary')
    )
    expect(toolRows).toHaveLength(1)
    expect(toolRows[0]?.id).toBe('pi-agy-tool:job-1:0:0')
    expect(commentaryRows).toHaveLength(1)
    expect(commentaryRows[0]?.id).toBe('pi-agy-thought:job-1:0')
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

  test('stores provider reasoning separately from the visible answer', () => {
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
          delta: 'Inspecting the selected files.',
          type: 'thinking_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    expect(next.messages).toEqual([
      expect.objectContaining({
        id: 'pi-thinking:turn-1:0',
        parts: [
          expect.objectContaining({
            state: 'streaming',
            text: 'Inspecting the selected files.',
            type: 'reasoning'
          })
        ],
        text: ''
      })
    ])

    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          content: 'Inspecting the selected files.',
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
            { thinking: 'Inspecting the selected files.', type: 'thinking' },
            { text: 'Visible answer.', type: 'text' }
          ],
          role: 'assistant'
        },
        type: 'message_end'
      }),
      'turn-1'
    )
    expect(next.messages.find((message) => message.text.trim())?.text).toBe('Visible answer.')
    expect(
      next.messages.find((message) => message.parts?.some((part) => part.type === 'reasoning'))
        ?.parts
    ).toEqual([
      expect.objectContaining({
        state: 'complete',
        text: 'Inspecting the selected files.',
        type: 'reasoning'
      })
    ])
  })

  test('omits a reasoning row when Gemini exposes only structured tool activity', () => {
    const next = thread()
    const thinking = [
      '[agy tool: view_file]',
      '[agy input]',
      '{"AbsolutePath":"README.md"}',
      '[/agy input]',
      '[agy output]',
      'File contents',
      '[/agy output]'
    ].join('\n')
    for (const assistantMessageEvent of [
      { contentIndex: 0, type: 'thinking_start' },
      { contentIndex: 0, delta: thinking, type: 'thinking_delta' },
      { content: thinking, contentIndex: 0, type: 'thinking_end' }
    ]) {
      applyPiJsonEvent(
        next,
        JSON.stringify({ assistantMessageEvent, type: 'message_update' }),
        'turn-1'
      )
    }

    expect(
      next.messages.some((message) => message.parts?.some((part) => part.type === 'reasoning'))
    ).toBe(false)
    expect(
      next.messages.some((message) => message.parts?.some((part) => part.type === 'tool'))
    ).toBe(true)
  })

  test('does not turn repeated reasoning summaries into progress-message spam', () => {
    const next = thread()
    for (const [responseId, summary] of [
      ['response-1', 'Inspecting the implementation.'],
      ['response-2', 'Verifying the focused tests.']
    ]) {
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
          assistantMessageEvent: { contentIndex: 0, delta: summary, type: 'thinking_delta' },
          type: 'message_update'
        }),
        'turn-1'
      )
      applyPiJsonEvent(
        next,
        JSON.stringify({
          assistantMessageEvent: { content: summary, contentIndex: 0, type: 'thinking_end' },
          type: 'message_update'
        }),
        'turn-1'
      )
      applyPiJsonEvent(
        next,
        JSON.stringify({
          message: {
            content: [
              { thinking: summary, type: 'thinking' },
              { id: `call-${responseId}`, name: 'read', type: 'toolCall' }
            ],
            responseId,
            role: 'assistant',
            stopReason: 'toolUse'
          },
          type: 'message_end'
        }),
        'turn-1'
      )
    }

    const reasoning = next.messages.filter((message) =>
      message.parts?.some((part) => part.type === 'reasoning')
    )
    expect(reasoning).toHaveLength(1)
    expect(reasoning[0]?.parts).toEqual([
      expect.objectContaining({
        text: 'Verifying the focused tests.',
        type: 'reasoning'
      })
    ])
    expect(
      next.messages.some((message) => message.parts?.some((part) => part.type === 'commentary'))
    ).toBe(false)
  })

  test('uses OpenAI commentary phase text as the visible progress lane', () => {
    const next = thread()
    const textSignature = JSON.stringify({ id: 'msg-commentary', phase: 'commentary', v: 1 })
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: 'The event contract is verified.',
          partial: {
            content: [
              {
                text: 'The event contract is verified.',
                textSignature,
                type: 'text'
              }
            ]
          },
          type: 'text_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )

    expect(next.messages).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:assistant',
        parts: [
          {
            state: 'streaming',
            text: 'The event contract is verified.',
            type: 'commentary'
          }
        ],
        text: ''
      })
    ])

    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            {
              text: 'The event contract is verified. I’m updating the bridge next.',
              textSignature,
              type: 'text'
            },
            { id: 'call-1', name: 'read', type: 'toolCall' }
          ],
          responseId: 'response-commentary',
          role: 'assistant',
          stopReason: 'toolUse'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    expect(next.messages).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:assistant',
        parts: [
          {
            state: 'complete',
            text: 'The event contract is verified. I’m updating the bridge next.',
            type: 'commentary'
          }
        ],
        text: ''
      })
    ])
  })

  test('keeps one wrap-up when message_end repeats the same text under a Pi entry id', () => {
    const next = thread()
    const wrapUp =
      'The header now uses the shared Board chrome, and the composer stop control is a solid square.'
    next.messages.push({
      createdAt: '2026-08-21T12:00:00.000Z',
      id: 'user-1',
      role: 'user',
      text: 'Finish the header.'
    })
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [{ text: wrapUp, type: 'text' }],
          responseId: 'chatcmpl-e034d9b031ea4199ae75f0a01a58',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        id: 'b665f085',
        message: {
          content: [{ text: wrapUp, type: 'text' }],
          responseId: 'chatcmpl-e034d9b031ea4199ae75f0a01a58',
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    const wrapUps = next.messages.filter(
      (message) => message.role === 'assistant' && message.text.trim()
    )
    expect(wrapUps).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:chatcmpl-e034d9b031ea4199ae75f0a01a58',
        text: wrapUp
      })
    ])
    expect(wrapUps[0]?.completedAt).toBeDefined()
  })

  test('keeps one commentary row when the same text arrives under a different message id', () => {
    const next = thread()
    const commentary = 'Inspecting the header before I edit it.'
    const textSignature = JSON.stringify({ id: 'msg-commentary', phase: 'commentary', v: 1 })
    next.messages.push({
      createdAt: '2026-08-21T12:00:00.000Z',
      id: 'user-1',
      role: 'user',
      text: 'Fix the header.'
    })
    applyPiJsonEvent(
      next,
      JSON.stringify({
        message: {
          content: [
            { text: commentary, textSignature, type: 'text' },
            { id: 'call-1', name: 'read', type: 'toolCall' }
          ],
          responseId: 'chatcmpl-live',
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
        id: 'd708023c',
        message: {
          content: [
            { text: commentary, textSignature, type: 'text' },
            { id: 'call-1', name: 'read', type: 'toolCall' }
          ],
          responseId: 'chatcmpl-live',
          role: 'assistant',
          stopReason: 'toolUse'
        },
        type: 'message_end'
      }),
      'turn-1'
    )

    const commentaryRows = next.messages.filter((message) =>
      message.parts?.some((part) => part.type === 'commentary')
    )
    expect(commentaryRows).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:chatcmpl-live:commentary:0',
        parts: [{ state: 'complete', text: commentary, type: 'commentary' }],
        text: ''
      })
    ])
  })

  test('keeps streamed commentary when the same assistant message starts writing the answer', () => {
    const next = thread()
    const textSignature = JSON.stringify({ id: 'msg-commentary', phase: 'commentary', v: 1 })
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: {
          contentIndex: 0,
          delta: 'Checking the header.',
          partial: {
            content: [
              {
                text: 'Checking the header.',
                textSignature,
                type: 'text'
              }
            ]
          },
          type: 'text_delta'
        },
        type: 'message_update'
      }),
      'turn-1'
    )
    applyPiJsonEvent(
      next,
      JSON.stringify({
        assistantMessageEvent: { contentIndex: 1, delta: 'The button is in.', type: 'text_delta' },
        type: 'message_update'
      }),
      'turn-1'
    )

    expect(next.messages).toEqual([
      expect.objectContaining({
        id: 'pi-agent:turn-1:assistant',
        parts: [
          {
            state: 'streaming',
            text: 'Checking the header.',
            type: 'commentary'
          }
        ],
        text: 'The button is in.'
      })
    ])
    expect(next.recentUpdate).toBe('Writing response…')
  })
})
