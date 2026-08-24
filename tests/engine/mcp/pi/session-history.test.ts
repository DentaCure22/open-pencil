import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import type { PiRpcProcess, PiRpcResponse } from '#mcp/pi/rpc-process'
import { reconcilePiSessionHistory } from '#mcp/pi/session-history'

function thread(): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-21T00:00:00.000Z',
    effort: 'high',
    id: 'thread-1',
    lastPiEntryId: 'before-turn',
    messages: [
      {
        createdAt: '2026-08-21T00:00:00.000Z',
        id: 'user-1',
        role: 'user',
        text: 'Do the work.'
      }
    ],
    model: 'xai-auth/grok-4.6',
    piHistoryInitialized: true,
    recentUpdate: 'Pi is running.',
    sessionId: 'session-1',
    state: 'running',
    task: 'Do the work',
    updatedAt: '2026-08-21T00:00:00.000Z',
    workerId: 'worker-1'
  }
}

describe('Pi durable session reconciliation', () => {
  test('recovers missed tools and the final answer with stable turn identities', async () => {
    const target = thread()
    const commands: Array<Record<string, unknown>> = []
    const process: Pick<PiRpcProcess, 'command'> = {
      command: (command: Record<string, unknown>): Promise<PiRpcResponse> => {
        commands.push(command)
        return Promise.resolve({
          command: 'get_entries',
          data: {
            entries: [
              {
                id: 'assistant-tools',
                message: {
                  content: [
                    { thinking: 'Inspecting the saved session.', type: 'thinking' },
                    { text: 'I will inspect it.', type: 'text' },
                    {
                      arguments: { path: 'README.md' },
                      id: 'call-1',
                      name: 'read',
                      type: 'toolCall'
                    }
                  ],
                  responseId: 'response-tools',
                  role: 'assistant',
                  stopReason: 'toolUse'
                },
                type: 'message'
              },
              {
                id: 'tool-result',
                message: {
                  content: [{ text: 'file contents', type: 'text' }],
                  isError: false,
                  role: 'toolResult',
                  toolCallId: 'call-1',
                  toolName: 'read'
                },
                type: 'message'
              },
              {
                id: 'assistant-final',
                message: {
                  content: [{ text: 'The work is complete.', type: 'text' }],
                  responseId: 'response-final',
                  role: 'assistant',
                  stopReason: 'stop'
                },
                type: 'message'
              }
            ],
            leafId: 'assistant-final'
          },
          id: 'response-1',
          success: true,
          type: 'response'
        })
      }
    }

    const result = await reconcilePiSessionHistory(target, process, 'job-1')
    const tool = target.messages
      .flatMap((message) => message.parts ?? [])
      .find((part) => part.type === 'tool')

    expect(commands[0]).toMatchObject({ since: 'before-turn', type: 'get_entries' })
    expect(result).toMatchObject({ applied: true, finalResponse: 'The work is complete.' })
    expect(target.lastPiEntryId).toBe('assistant-final')
    expect(tool).toMatchObject({
      input: '{\n  "path": "README.md"\n}',
      name: 'read',
      output: 'file contents',
      state: 'success'
    })
    expect(
      target.messages.some((message) =>
        message.parts?.some(
          (part) => part.type === 'commentary' && part.text === 'I will inspect it.'
        )
      )
    ).toBe(true)
    expect(target.messages.some((message) => message.text === 'The work is complete.')).toBe(true)
  })

  test('recovers only the last Antigravity wrap-up from a concatenated stop', async () => {
    const target = thread()
    target.model = 'antigravity/gemini-3-7-flash'
    const process: Pick<PiRpcProcess, 'command'> = {
      command: (): Promise<PiRpcResponse> =>
        Promise.resolve({
          command: 'get_entries',
          data: {
            entries: [
              {
                id: 'assistant-final',
                message: {
                  content: [
                    { text: 'Apple Stock chart is ready.', type: 'text' },
                    { text: 'The Smylr Market report is on the Board.', type: 'text' }
                  ],
                  provider: 'antigravity',
                  responseId: 'response-final',
                  role: 'assistant',
                  stopReason: 'stop'
                },
                type: 'message'
              }
            ],
            leafId: 'assistant-final'
          },
          id: 'response-1',
          success: true,
          type: 'response'
        })
    }

    const result = await reconcilePiSessionHistory(target, process, 'job-1')
    expect(result).toMatchObject({
      applied: true,
      finalResponse: 'The Smylr Market report is on the Board.'
    })
    expect(
      target.messages.filter((message) => message.role === 'assistant' && message.text)
    ).toEqual([
      expect.objectContaining({
        text: 'The Smylr Market report is on the Board.'
      })
    ])
  })

  test('does not add a second wrap-up when get_entries repeats the live stream text', async () => {
    const wrapUp =
      'The header now uses the shared Board chrome, and the composer stop control is a solid square.'
    const target = thread()
    target.messages.push({
      completedAt: '2026-08-21T13:59:06.472Z',
      createdAt: '2026-08-21T13:59:06.472Z',
      id: 'pi-agent:job-1:chatcmpl-e034d9b031ea4199ae75f0a01a58',
      role: 'assistant',
      text: wrapUp
    })
    const process: Pick<PiRpcProcess, 'command'> = {
      command: (): Promise<PiRpcResponse> =>
        Promise.resolve({
          command: 'get_entries',
          data: {
            entries: [
              {
                id: 'b665f085',
                message: {
                  content: [{ text: wrapUp, type: 'text' }],
                  responseId: 'chatcmpl-e034d9b031ea4199ae75f0a01a58',
                  role: 'assistant',
                  stopReason: 'stop'
                },
                type: 'message'
              }
            ],
            leafId: 'b665f085'
          },
          id: 'response-1',
          success: true,
          type: 'response'
        })
    }

    const result = await reconcilePiSessionHistory(target, process, 'job-1')
    expect(result).toMatchObject({ applied: true, finalResponse: wrapUp })
    expect(
      target.messages.filter((message) => message.role === 'assistant' && message.text.trim())
    ).toEqual([
      expect.objectContaining({
        id: 'pi-agent:job-1:chatcmpl-e034d9b031ea4199ae75f0a01a58',
        text: wrapUp
      })
    ])
  })

  test('does not add a second commentary row when get_entries repeats live commentary', async () => {
    const commentary = 'Inspecting the header before I edit it.'
    const target = thread()
    target.messages.push({
      completedAt: '2026-08-21T13:59:06.472Z',
      createdAt: '2026-08-21T13:59:06.472Z',
      id: 'pi-agent:job-1:chatcmpl-live:commentary:1',
      parts: [{ state: 'complete', text: commentary, type: 'commentary' }],
      role: 'assistant',
      text: ''
    })
    const process: Pick<PiRpcProcess, 'command'> = {
      command: (): Promise<PiRpcResponse> =>
        Promise.resolve({
          command: 'get_entries',
          data: {
            entries: [
              {
                id: 'd708023c',
                message: {
                  content: [
                    {
                      text: commentary,
                      textSignature: JSON.stringify({
                        id: 'msg-commentary',
                        phase: 'commentary',
                        v: 1
                      }),
                      type: 'text'
                    },
                    { id: 'call-1', name: 'read', type: 'toolCall' }
                  ],
                  responseId: 'chatcmpl-live',
                  role: 'assistant',
                  stopReason: 'toolUse'
                },
                type: 'message'
              }
            ],
            leafId: 'd708023c'
          },
          id: 'response-1',
          success: true,
          type: 'response'
        })
    }

    const result = await reconcilePiSessionHistory(target, process, 'job-1')
    expect(result.applied).toBe(true)
    const commentaryRows = target.messages.filter((message) =>
      message.parts?.some((part) => part.type === 'commentary')
    )
    expect(commentaryRows).toEqual([
      expect.objectContaining({
        id: 'pi-agent:job-1:chatcmpl-live:commentary:1',
        parts: [{ state: 'complete', text: commentary, type: 'commentary' }]
      })
    ])
  })
})
