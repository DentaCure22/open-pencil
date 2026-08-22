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
    expect(target.messages.some((message) => message.text === 'The work is complete.')).toBe(true)
  })
})
