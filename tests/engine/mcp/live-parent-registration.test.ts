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
import { PARENT_LIVE_TOOL_NAMES, registerLiveParentTools } from '#mcp/tool/live-parent-registration'

type RegisteredTool = {
  description?: string
  handler?: (args: Record<string, unknown>) => Promise<unknown>
  inputSchema?: z.ZodType
}

type AuthorityClient = NonNullable<Parameters<typeof registerLiveParentTools>[1]>
type McpJsonResult = {
  presence?: unknown
  result?: unknown
  target?: unknown
}
type TestRpcBody = {
  args?: unknown
  command?: unknown
}

function setup(
  authority?: AuthorityClient,
  includeTools?: Parameters<typeof registerLiveParentTools>[2],
  dispatchOptions?: Parameters<typeof registerDispatchWorkTool>[1]
) {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(
      name: string,
      options: { description?: string; inputSchema: z.ZodType },
      handler?: (args: Record<string, unknown>) => Promise<unknown>
    ) {
      tools.set(name, {
        description: options.description,
        handler,
        inputSchema: options.inputSchema
      })
    }
  }
  registerDispatchWorkTool(server as McpServer, dispatchOptions)
  registerLiveParentTools(server as McpServer, authority, includeTools)
  return tools
}

function resultJson(value: unknown): McpJsonResult {
  const content = (value as { content?: Array<{ text?: unknown }> }).content
  const text = content?.[0]?.text
  if (typeof text !== 'string') throw new Error('Expected an MCP text result.')
  return JSON.parse(text) as McpJsonResult
}

describe('live-parent MCP registration', () => {
  test('keeps worker mutation tools off the Codex parent surface', () => {
    const tools = setup(undefined, PARENT_LIVE_TOOL_NAMES)
    expect([...tools.keys()].sort()).toEqual([
      'board_go',
      'board_where',
      'dispatch_work',
      'get_agent_chat_context',
      'list_agent_chats',
      'set_theme',
      'trace_query'
    ])
  })

  test('registers the compact OpenPencil remote', () => {
    const tools = setup()
    expect([...tools.keys()].sort()).toEqual([
      'board_apply',
      'board_go',
      'board_query',
      'board_screenshot',
      'board_where',
      'dispatch_work',
      'get_agent_chat_context',
      'list_agent_chats',
      'set_theme',
      'trace_query'
    ])
    expect(tools.get('board_screenshot')?.description).toContain('Read-only')
    expect(tools.get('board_screenshot')?.description).toContain('explicitly requests')
    expect(tools.get('board_query')?.description).toContain('compact top-level map')
    expect(tools.get('board_apply')?.description).toContain('single guarded atomic save')
    expect(tools.get('board_query')?.description).toContain('exact objects together')
    expect(tools.get('trace_query')?.description).toContain('bounded persisted Trace context')
    expect(tools.get('board_where')?.description).toContain('Read-only')
    expect(tools.get('board_where')?.description).toContain('only when')
    expect(tools.get('board_go')?.description).toContain('explicit user navigation')
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

  test('combines page discovery and exact object reads', () => {
    const schema = setup().get('board_query')?.inputSchema
    expect(schema).toBeDefined()
    expect(schema?.safeParse({ page_id: '0:2' }).success).toBe(true)
    expect(schema?.safeParse({ page_id: '0:2', query: {} }).success).toBe(true)
    expect(
      schema?.safeParse({
        detail: 'summary',
        page_id: '0:2',
        query: { parent_id: '0:10', types: ['FRAME', 'TEXT'] },
        token_budget: 1500
      }).success
    ).toBe(true)
    expect(
      schema?.safeParse({
        detail: 'full',
        object_ids: ['0:42', '0:43'],
        page_id: '0:2'
      }).success
    ).toBe(true)
  })

  test('keeps Trace lookup bounded to one selector', () => {
    const schema = setup().get('trace_query')?.inputSchema
    expect(schema).toBeDefined()
    expect(schema?.safeParse({ query: 'the blue card' }).success).toBe(true)
    expect(schema?.safeParse({ session_tag: 'patient-flow' }).success).toBe(true)
    expect(schema?.safeParse({ latest_spoken_turn: true, limit: 1 }).success).toBe(true)
    expect(schema?.safeParse({ spoken_turn_id: 'turn:42', turn_context: true }).success).toBe(true)
    expect(schema?.safeParse({ limit: 8, query: 'too many' }).success).toBe(false)
  })

  test('passes trace_query directly to the persisted Trace authority', async () => {
    const calls: Array<Record<string, unknown>> = []
    const authority: AuthorityClient = async (_pathname, init = {}) => {
      const body = JSON.parse(String(init.body)) as TestRpcBody
      calls.push(body)
      return {
        ok: true,
        payload: { result: { matches: [{ spoken_turn_id: 'turn:42' }] } },
        status: 200
      }
    }
    const handler = setup(authority).get('trace_query')?.handler
    const output = resultJson(await handler?.({ query: 'the blue card', turn_context: true }))

    expect(calls).toEqual([
      {
        args: { query: 'the blue card', turn_context: true },
        command: 'trace_query'
      }
    ])
    expect(output.result).toEqual({ matches: [{ spoken_turn_id: 'turn:42' }] })
  })

  test('defaults a missing or empty index query to the compact top-level map', async () => {
    const calls: Array<Record<string, unknown>> = []
    const authority: AuthorityClient = async (_pathname, init = {}) => {
      const body = JSON.parse(String(init.body)) as TestRpcBody
      calls.push(body)
      if (body.command === 'board_context') {
        return {
          ok: true,
          payload: { result: { context_token: 'context:1' } },
          status: 200
        }
      }
      return {
        ok: true,
        payload: {
          result: { nodes: [{ id: '0:42', parent_id: '0:2' }], scope: 'query' },
          target: { page_id: '0:2' }
        },
        status: 200
      }
    }
    const handler = setup(authority).get('board_query')?.handler
    const output = resultJson(await handler?.({ page_id: '0:2', query: {} }))

    expect(calls.map((call) => call.command)).toEqual(['board_context', 'board_read'])
    expect(calls[1]).toEqual({
      args: {
        context_token: 'context:1',
        limit: 100,
        page_id: '0:2',
        projection: 'summary',
        query: { parent_id: '0:2' },
        scope: 'query',
        token_budget: 3000
      },
      command: 'board_read'
    })
    expect(output).toEqual({
      result: { nodes: [{ id: '0:42', parent_id: '0:2' }], scope: 'query' },
      target: { page_id: '0:2' }
    })
  })

  test('applies one context-bound Board batch with one stable request id', async () => {
    const calls: Array<Record<string, unknown>> = []
    const authority: AuthorityClient = async (_pathname, init = {}) => {
      const body = JSON.parse(String(init.body)) as TestRpcBody
      calls.push(body)
      if (body.command === 'board_context') {
        return {
          ok: true,
          payload: { result: { context_token: 'context:apply' } },
          status: 200
        }
      }
      return {
        ok: true,
        payload: {
          result: { changed_ids: ['0:42'], status: 'committed' },
          target: { page_id: '0:2' }
        },
        status: 200
      }
    }
    const handler = setup(authority).get('board_apply')?.handler
    const output = resultJson(
      await handler?.({
        operations: [
          {
            node: { height: 100, id: '0:42', type: 'FRAME', width: 100 },
            op: 'create',
            parent_id: '0:2'
          }
        ],
        page_id: '0:2',
        request_id: 'test:apply'
      })
    )

    expect(calls.map((call) => call.command)).toEqual(['board_context', 'board_apply'])
    expect(calls[1]).toEqual({
      args: {
        context_token: 'context:apply',
        operations: [
          {
            node: { height: 100, id: '0:42', type: 'FRAME', width: 100 },
            op: 'create',
            parent_id: '0:2'
          }
        ],
        page_id: '0:2',
        request_id: 'test:apply'
      },
      command: 'board_apply'
    })
    expect(output).toEqual({
      result: { changed_ids: ['0:42'], status: 'committed' },
      target: { page_id: '0:2' }
    })
  })

  test('offers typed Code Object actions without exposing pluginData serialization', () => {
    const schema = toolsSchema(setup(), 'board_apply')
    expect(
      schema.safeParse({
        operations: [
          {
            bounds: { height: 480, width: 320, x: 100, y: 120 },
            coordinate_space: 'page',
            image_scale_mode: 'FIT',
            name: 'Generated mirror',
            object_id: 'image:mirror',
            op: 'create_image',
            parent_id: '0:2',
            source_path: '/tmp/generated-mirror.png'
          }
        ],
        page_id: '0:2'
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({
        operations: [
          {
            bounds: { height: 100, width: 100, x: 0, y: 0 },
            coordinate_space: 'screen',
            name: 'Bad coordinates',
            object_id: 'image:bad',
            op: 'create_image',
            parent_id: '0:2',
            source_path: '/tmp/bad.png'
          }
        ],
        page_id: '0:2'
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({
        operations: [
          {
            bounds: { height: 240, width: 360, x: 100, y: 120 },
            name: 'Small app',
            object_id: 'code:small-app',
            op: 'create_code_object',
            parent_id: '0:2',
            source: 'export default function App() { return <main>Hello</main> }'
          }
        ],
        page_id: '0:2'
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({
        operations: [
          {
            object_id: 'code:small-app',
            op: 'update_code_object',
            source: 'export default function App() { return <main>Updated</main> }'
          }
        ],
        page_id: '0:2'
      }).success
    ).toBe(true)
  })

  test('reacquires once when the Board changes during an apply', async () => {
    const calls: TestRpcBody[] = []
    let contexts = 0
    let applies = 0
    const authority: AuthorityClient = async (_pathname, init = {}) => {
      const body = JSON.parse(String(init.body)) as TestRpcBody
      calls.push(body)
      if (body.command === 'board_context') {
        contexts += 1
        return {
          ok: true,
          payload: { result: { context_token: `context:${String(contexts)}` } },
          status: 200
        }
      }
      applies += 1
      if (applies === 1) {
        return {
          ok: false,
          payload: {
            error: 'stale_revision: Expected revision 4, current revision is 5'
          },
          status: 409
        }
      }
      return {
        ok: true,
        payload: { result: { changed_ids: ['0:42'], status: 'committed' } },
        status: 200
      }
    }
    const handler = setup(authority).get('board_apply')?.handler
    const output = resultJson(
      await handler?.({
        operations: [{ changes: { name: 'Latest' }, object_id: '0:42', op: 'update' }],
        page_id: '0:2',
        request_id: 'test:race'
      })
    )

    expect(calls.map(({ command }) => command)).toEqual([
      'board_context',
      'board_apply',
      'board_context',
      'board_apply'
    ])
    expect(output.result).toEqual({
      changed_ids: ['0:42'],
      status: 'committed'
    })
  })

  test('acquires and hides the authority context token for exact board_query IDs', async () => {
    const calls: Array<Record<string, unknown>> = []
    const authority: AuthorityClient = async (_pathname, init = {}) => {
      const body = JSON.parse(String(init.body)) as TestRpcBody
      calls.push(body)
      if (body.command === 'board_context') {
        return {
          ok: true,
          payload: { result: { context_token: 'context:1' } },
          status: 200
        }
      }
      return {
        ok: true,
        payload: {
          result: { nodes: [{ id: '0:42', name: 'Card' }], scope: 'objects' },
          target: { page_id: '0:2' }
        },
        status: 200
      }
    }
    const handler = setup(authority).get('board_query')?.handler
    expect(handler).toBeDefined()
    const output = resultJson(await handler?.({ object_ids: ['0:42'], page_id: '0:2' }))

    expect(calls.map((call) => call.command)).toEqual(['board_context', 'board_read'])
    expect(calls[0]).toEqual({
      args: { page_id: '0:2' },
      command: 'board_context'
    })
    expect(calls[1]).toEqual({
      args: {
        context_token: 'context:1',
        object_ids: ['0:42'],
        page_id: '0:2',
        scope: 'objects'
      },
      command: 'board_read'
    })
    expect(output).toEqual({
      result: { nodes: [{ id: '0:42', name: 'Card' }], scope: 'objects' },
      target: { page_id: '0:2' }
    })
  })

  test('keeps agent cards out of selected Board content', async () => {
    const authority: AuthorityClient = async (pathname, init = {}) => {
      if (pathname.endsWith('/presence')) {
        return {
          ok: true,
          payload: {
            presence: {
              pageId: '0:2',
              pageName: 'Page 1',
              selectedIds: ['0:19', '0:42']
            }
          },
          status: 200
        }
      }
      if (pathname.endsWith('/theme')) {
        return { ok: true, payload: { theme: null }, status: 200 }
      }
      if (pathname.endsWith('/status')) {
        return {
          ok: true,
          payload: {
            identity: {
              documentId: 'doc:1',
              documentName: 'Board',
              workspaceId: 'ws:1'
            }
          },
          status: 200
        }
      }
      const body = JSON.parse(String(init.body)) as TestRpcBody
      if (body.command === 'board_context') {
        return {
          ok: true,
          payload: { result: { context_token: 'context:1' } },
          status: 200
        }
      }
      return {
        ok: true,
        payload: {
          result: {
            nodes: [
              {
                code_object_component: 'agent-conversation-terminal',
                id: '0:19'
              },
              { id: '0:42', name: 'Actual content' }
            ]
          }
        },
        status: 200
      }
    }
    const handler = setup(authority).get('board_where')?.handler
    const output = resultJson(await handler?.({}))

    expect(output.presence).toEqual({
      agentCardIds: ['0:19'],
      pageId: '0:2',
      pageName: 'Page 1',
      selectedIds: ['0:42']
    })
  })

  test('dispatch_work carries exact words and a resolved intention', () => {
    const tools = setup()
    expect(tools.get('dispatch_work')?.description).toContain('what the user said')
    const schema = tools.get('dispatch_work')?.inputSchema
    expect(schema).toBeDefined()
    expect(Object.keys((schema as z.ZodObject<Record<string, z.ZodType>>).shape).sort()).toEqual([
      'action',
      'exact_words',
      'intention',
      'target_thread_id'
    ])
    expect(
      schema?.safeParse({
        action: 'new',
        exact_words: 'Build the status card.',
        intention: 'Create a status card on the current Board.'
      }).success
    ).toBe(true)
    expect(
      schema?.safeParse({
        exact_words: 'Build the status card.',
        intention: 'Create a status card on the current Board.'
      }).success
    ).toBe(false)
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
          isCurrent: false,
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
    expect(JSON.stringify(result)).not.toContain('odontogram-grid')
  })

  test('joins durable Work Map placement into the bounded chat directory', async () => {
    const authorityRequest: NonNullable<
      Parameters<typeof registerDispatchWorkTool>[1]
    >['authorityRequest'] = async (pathname) =>
      pathname.endsWith('/work-map')
        ? {
            ok: true,
            payload: {
              placements: [
                {
                  manual: false,
                  projectId: 'project:editor',
                  threadId: 'thread-editor',
                  updatedAt: '2026-08-25T12:00:00.000Z'
                }
              ],
              projects: [
                {
                  createdAt: '2026-08-25T12:00:00.000Z',
                  id: 'project:treatment',
                  name: 'Treatment plan',
                  updatedAt: '2026-08-25T12:00:00.000Z'
                },
                {
                  createdAt: '2026-08-25T12:00:00.000Z',
                  id: 'project:editor',
                  name: 'Plan editor',
                  parentId: 'project:treatment',
                  updatedAt: '2026-08-25T12:00:00.000Z'
                }
              ],
              revision: 2,
              todos: [
                {
                  createdAt: '2026-08-25T12:00:00.000Z',
                  id: 'todo:review',
                  projectId: 'project:editor',
                  status: 'in_motion',
                  threadId: 'thread-editor',
                  title: 'Review plan interactions',
                  updatedAt: '2026-08-25T12:00:00.000Z'
                }
              ],
              version: 1
            },
            status: 200
          }
        : {
            ok: true,
            payload: {
              threads: [
                {
                  canFollowUp: true,
                  id: 'thread-editor',
                  messages: [{ role: 'user', text: 'Refine the plan editor.' }],
                  sessionId: 'session-editor',
                  state: 'running',
                  task: 'Refine the plan editor',
                  updatedAt: '2026-08-25T12:00:00.000Z'
                }
              ]
            },
            status: 200
          }
    const handler = setup(undefined, undefined, { authorityRequest }).get(
      'list_agent_chats'
    )?.handler
    const output = resultJson(await handler?.({})) as {
      boardPlacement?: string
      candidates?: Array<{ workMap?: unknown }>
    }

    expect(output.boardPlacement).toBe('work_map_reported')
    expect(output.candidates?.[0]?.workMap).toEqual({
      projectId: 'project:editor',
      projectPath: ['Treatment plan', 'Plan editor'],
      todos: [{ id: 'todo:review', status: 'in_motion', title: 'Review plan interactions' }]
    })
  })

  test('marks the active chat and keeps bare continuation local', async () => {
    const authorityRequest: NonNullable<
      Parameters<typeof registerDispatchWorkTool>[1]
    >['authorityRequest'] = async () => ({
      ok: true,
      payload: {
        threads: [
          {
            canFollowUp: true,
            id: 'thread-current',
            messages: [
              {
                role: 'user',
                text: 'Stop new chats from appearing on the Board.'
              },
              { role: 'assistant', text: 'I changed the chat overlay.' },
              { role: 'user', text: 'continue' }
            ],
            recentUpdate: 'openpencil_list_agent_chats…',
            sessionId: 'native-current',
            state: 'running',
            task: 'Stop new chats from appearing on the Board.',
            updatedAt: '2026-08-24T20:20:57.171Z'
          },
          {
            canFollowUp: true,
            id: 'thread-other',
            messages: [
              { role: 'user', text: 'Research RLMs.' },
              { role: 'assistant', text: 'Sensitive unrelated result.' }
            ],
            sessionId: 'native-other',
            state: 'completed',
            task: 'Research RLMs.',
            updatedAt: '2026-08-24T20:15:38.418Z'
          }
        ]
      },
      status: 200
    })
    const handler = setup(undefined, undefined, {
      authorityRequest,
      currentThreadId: 'thread-current'
    }).get('list_agent_chats')?.handler
    const output = resultJson(await handler?.({})) as {
      activeThreadId?: string
      candidates?: Array<{
        currentTask?: string
        isCurrent?: boolean
        threadId?: string
      }>
      continuationPolicy?: string
    }

    expect(output).toMatchObject({
      activeThreadId: 'thread-current',
      continuationPolicy: 'current_chat_only'
    })
    expect(output.candidates?.[0]).toEqual({
      currentTask: 'Stop new chats from appearing on the Board.',
      isCurrent: true,
      resumable: true,
      state: 'running',
      status: 'openpencil_list_agent_chats…',
      threadId: 'thread-current',
      updatedAt: '2026-08-24T20:20:57.171Z'
    })
    expect(output.candidates).toHaveLength(1)
    expect(JSON.stringify(output)).not.toContain('thread-other')
    expect(JSON.stringify(output)).not.toContain('Sensitive unrelated result')
  })

  test('blocks another chat from replacing a bare continuation', async () => {
    const calls: string[] = []
    const authorityRequest: NonNullable<
      Parameters<typeof registerDispatchWorkTool>[1]
    >['authorityRequest'] = async (pathname) => {
      calls.push(pathname)
      return {
        ok: true,
        payload: {
          canFollowUp: true,
          id: 'thread-current',
          messages: [
            { role: 'user', text: 'Fix the chat card placement.' },
            { role: 'user', text: 'continue' }
          ],
          sessionId: 'native-current',
          state: 'running',
          task: 'Fix the chat card placement.',
          updatedAt: '2026-08-24T20:20:57.171Z'
        },
        status: 200
      }
    }
    const handler = setup(undefined, undefined, {
      authorityRequest,
      currentThreadId: 'thread-current'
    }).get('get_agent_chat_context')?.handler
    const result = (await handler?.({
      query: 'RLM research',
      thread_id: 'thread-other'
    })) as { content?: Array<{ text?: string }>; isError?: boolean }

    expect(result.isError).toBe(true)
    expect(result.content?.[0]?.text).toContain('continues the active chat')
    expect(calls).toEqual(['/agent-router/v1/pi/conversations/thread-current/preview'])
  })

  test('imports an explicitly matched chat as external reference', async () => {
    const authorityRequest: NonNullable<
      Parameters<typeof registerDispatchWorkTool>[1]
    >['authorityRequest'] = async (pathname) => {
      const current = pathname.includes('thread-current')
      return {
        ok: true,
        payload: current
          ? {
              canFollowUp: true,
              id: 'thread-current',
              messages: [
                {
                  role: 'user',
                  text: 'Compare this implementation with the RLM research chat.'
                }
              ],
              sessionId: 'native-current',
              state: 'running',
              task: 'Fix worker context routing.',
              updatedAt: '2026-08-24T20:20:57.171Z'
            }
          : {
              canFollowUp: true,
              id: 'thread-rlm',
              messages: [
                { role: 'user', text: 'Research RLM context routing.' },
                { role: 'assistant', text: 'RLM findings.' }
              ],
              sessionId: 'native-rlm',
              state: 'completed',
              task: 'Research RLM context routing.',
              updatedAt: '2026-08-24T20:15:38.418Z'
            },
        status: 200
      }
    }
    const handler = setup(undefined, undefined, {
      authorityRequest,
      currentThreadId: 'thread-current'
    }).get('get_agent_chat_context')?.handler
    const output = resultJson(
      await handler?.({
        query: 'RLM context routing',
        thread_id: 'thread-rlm'
      })
    ) as { activeThread?: unknown; contextRole?: string; threadId?: string }

    expect(output).toMatchObject({
      activeThread: {
        currentTask: 'Compare this implementation with the RLM research chat.',
        threadId: 'thread-current'
      },
      contextRole: 'external_reference',
      threadId: 'thread-rlm'
    })
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

  test('treats an omitted query as one unfiltered inventory request', () => {
    const result = compactAgentChatCandidates({
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
    })

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

  test('does not turn generic follow-up wording into a cross-chat search', () => {
    const result = compactAgentChatCandidates(
      {
        threads: [
          {
            canFollowUp: true,
            id: 'thread-other',
            messages: [{ role: 'user', text: 'Please figure this out.' }],
            sessionId: 'session-other',
            state: 'completed',
            task: 'Another task',
            updatedAt: '2026-08-22T12:00:00.000Z'
          }
        ]
      },
      'figure it out'
    )

    expect(result.candidates).toEqual([])
    expect(result.matched).toBe(0)
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
      exact_words: 'Keep fixing the Dental Chart.',
      intention: 'Finish the existing Dental Chart cleanup.'
    }
    expect(composeDispatchRequest({ ...shared, action: 'new' })).toMatchObject({
      action: 'new',
      body: { toolScope: 'board-worker' },
      route: '/agent-router/v1/pi/dispatch'
    })
    expect(
      composeDispatchRequest({
        ...shared,
        action: 'continue',
        target_thread_id: 'thread/one'
      })
    ).toMatchObject({
      action: 'continue',
      body: { toolScope: 'board-worker' },
      route: '/agent-router/v1/pi/conversations/thread%2Fone/follow-up',
      targetThreadId: 'thread/one'
    })
    expect(
      composeDispatchRequest({
        ...shared,
        action: 'fork',
        target_thread_id: 'thread/one'
      })
    ).toMatchObject({
      action: 'fork',
      body: { toolScope: 'board-worker' },
      route: '/agent-router/v1/pi/conversations/thread%2Fone/fork',
      targetThreadId: 'thread/one'
    })
    expect(() => composeDispatchRequest({ ...shared, action: 'fork' })).toThrow(
      'fork requires target_thread_id'
    )
  })

  test('invokes the OpenPencil skill with Pi command syntax', () => {
    const prompt = composeDispatchWorkPrompt({
      action: 'new',
      exact_words: 'Move the card to the left.',
      intention: 'Move the selected card left while preserving its other properties.'
    })

    expect(prompt).toStartWith('/skill:openpencil Move the card to the left.')
    expect(prompt).toContain(
      'Intention: Move the selected card left while preserving its other properties.'
    )
    expect(prompt).not.toContain('Spoken turn:')
    expect(prompt).not.toContain('$openpencil')
  })
})

function toolsSchema(tools: Map<string, RegisteredTool>, name: string) {
  const schema = tools.get(name)?.inputSchema
  if (!schema || !('shape' in schema)) throw new Error(`Expected ${name} object schema`)
  return schema as z.ZodObject<Record<string, z.ZodType>>
}
