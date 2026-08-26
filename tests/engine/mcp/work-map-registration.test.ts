import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { registerWorkMapTools } from '#mcp/tool/work-map-registration'

type RegisteredTool = {
  description?: string
  handler?: (args: Record<string, unknown>) => Promise<unknown>
  inputSchema?: z.ZodType
}

function resultJson(value: unknown): Record<string, unknown> {
  const text = (value as { content?: Array<{ text?: unknown }> }).content?.[0]?.text
  if (typeof text !== 'string') throw new Error('Expected an MCP text result.')
  return JSON.parse(text) as Record<string, unknown>
}

describe('Work Map MCP tools', () => {
  test('grounds an active chat in the project directory', async () => {
    const tools = new Map<string, RegisteredTool>()
    const server = {
      registerTool(
        name: string,
        options: { description?: string; inputSchema: z.ZodType },
        handler: (args: Record<string, unknown>) => Promise<unknown>
      ) {
        tools.set(name, {
          description: options.description,
          handler,
          inputSchema: options.inputSchema
        })
      }
    }
    registerWorkMapTools(server as McpServer, {
      authorityRequest: async () => ({
        ok: true,
        payload: {
          placements: [
            {
              manual: false,
              projectId: 'project:treatment',
              threadId: 'thread:current',
              updatedAt: '2026-08-25T12:00:00.000Z'
            }
          ],
          projects: [
            {
              createdAt: '2026-08-25T12:00:00.000Z',
              id: 'project:treatment',
              name: 'Treatment plan',
              updatedAt: '2026-08-25T12:00:00.000Z'
            }
          ],
          revision: 4,
          todos: [],
          version: 1
        },
        status: 200
      }),
      currentThreadId: 'thread:current'
    })

    expect([...tools.keys()].sort()).toEqual([
      'workmap_apply',
      'workmap_create_todo_chat',
      'workmap_query'
    ])
    const result = resultJson(await tools.get('workmap_query')?.handler?.({}))
    expect(result).toMatchObject({
      currentPlacement: { projectId: 'project:treatment', threadId: 'thread:current' },
      currentThreadId: 'thread:current',
      revision: 4,
      selectedProjectId: 'project:treatment'
    })
    expect(tools.get('workmap_apply')?.description).toContain(
      'Todo statuses are Todo, In motion, and Finished'
    )
    expect(tools.get('workmap_apply')?.description).not.toContain('Needs you')
  })

  test('injects the active thread and forwards one atomic apply', async () => {
    const tools = new Map<string, RegisteredTool>()
    const requests: Array<{ body?: string; path: string }> = []
    const server = {
      registerTool(
        name: string,
        options: { description?: string; inputSchema: z.ZodType },
        handler: (args: Record<string, unknown>) => Promise<unknown>
      ) {
        tools.set(name, {
          description: options.description,
          handler,
          inputSchema: options.inputSchema
        })
      }
    }
    registerWorkMapTools(server as McpServer, {
      authorityRequest: async (requestPath, init) => {
        requests.push({ body: init?.body as string | undefined, path: requestPath })
        return {
          ok: true,
          payload: { previousRevision: 2, results: [], revision: 3 },
          status: 200
        }
      },
      currentThreadId: 'thread:current'
    })

    const schema = tools.get('workmap_apply')?.inputSchema
    const args = {
      expected_revision: 2,
      operations: [
        { op: 'place_chat', project_id: 'project:treatment' },
        { op: 'create_todo', project_id: 'project:treatment', title: 'Review plan editor' }
      ]
    }
    expect(schema?.safeParse(args).success).toBe(true)
    expect(
      schema?.safeParse({
        expected_revision: 2,
        operations: [{ op: 'update_todo', status: 'finished', todo_id: 'todo:active' }]
      }).success
    ).toBe(true)
    expect(
      schema?.safeParse({
        expected_revision: 2,
        operations: [{ op: 'update_todo', status: 'review', todo_id: 'todo:active' }]
      }).success
    ).toBe(false)
    await tools.get('workmap_apply')?.handler?.(args)

    expect(requests[0]?.path).toBe('/agent-router/v1/pi/work-map/agent')
    expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({
      currentThreadId: 'thread:current',
      expectedRevision: 2,
      operations: [
        { op: 'place_chat', project_id: 'project:treatment', thread_id: 'thread:current' },
        {
          op: 'create_todo',
          project_id: 'project:treatment',
          thread_id: 'thread:current',
          title: 'Review plan editor'
        }
      ]
    })
  })

  test('creates prepared future work as a dormant Todo chat', async () => {
    const tools = new Map<string, RegisteredTool>()
    const requests: Array<{ body?: string; path: string }> = []
    const server = {
      registerTool(
        name: string,
        options: { description?: string; inputSchema: z.ZodType },
        handler: (args: Record<string, unknown>) => Promise<unknown>
      ) {
        tools.set(name, {
          description: options.description,
          handler,
          inputSchema: options.inputSchema
        })
      }
    }
    registerWorkMapTools(server as McpServer, {
      authorityRequest: async (requestPath, init) => {
        requests.push({ body: init?.body as string | undefined, path: requestPath })
        return {
          ok: true,
          payload: {
            placements: [],
            projects: [],
            revision: 5,
            thread: { id: 'todo-chat:prepared' },
            todo: { id: 'todo:prepared', status: 'todo' },
            todos: [
              {
                createdAt: '2026-08-25T12:00:00.000Z',
                id: 'todo:prepared',
                projectId: 'project:treatment',
                status: 'todo',
                threadId: 'todo-chat:prepared',
                title: 'Validate treatment flow',
                updatedAt: '2026-08-25T12:00:00.000Z'
              }
            ],
            version: 1
          },
          status: 201
        }
      },
      currentThreadId: 'thread:current'
    })

    const result = resultJson(
      await tools.get('workmap_create_todo_chat')?.handler?.({
        acceptance: ['The saved flow is verified.'],
        expected_revision: 4,
        goal: 'Validate the treatment flow',
        project_id: 'project:treatment',
        request_id: 'request:prepared',
        title: 'Validate treatment flow'
      })
    )

    expect(requests[0]?.path).toBe('/agent-router/v1/pi/work-map/todo-chats/agent')
    expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({
      brief: {
        acceptance: ['The saved flow is verified.'],
        goal: 'Validate the treatment flow'
      },
      currentThreadId: 'thread:current',
      expectedRevision: 4,
      projectId: 'project:treatment',
      requestId: 'request:prepared',
      title: 'Validate treatment flow'
    })
    expect(result).toMatchObject({
      threadId: 'todo-chat:prepared',
      todoId: 'todo:prepared',
      todoStatus: 'todo'
    })
  })

  test('creates a prepared Todo chat through the dedicated authority route', async () => {
    const tools = new Map<string, RegisteredTool>()
    const requests: Array<{ body?: string; path: string }> = []
    const server = {
      registerTool(
        name: string,
        options: { inputSchema: z.ZodType },
        handler: (args: Record<string, unknown>) => Promise<unknown>
      ) {
        tools.set(name, { handler, inputSchema: options.inputSchema })
      }
    }
    registerWorkMapTools(server as McpServer, {
      authorityRequest: async (requestPath, init) => {
        requests.push({ body: init?.body as string | undefined, path: requestPath })
        return {
          ok: true,
          payload: {
            placements: [],
            projects: [{ id: 'project:dental', name: 'Dental Chart' }],
            revision: 5,
            thread: { id: 'todo-chat:history' },
            todo: { id: 'todo:history' },
            todos: [
              {
                id: 'todo:history',
                projectId: 'project:dental',
                status: 'todo',
                threadId: 'todo-chat:history',
                title: 'Add patient history shortcuts'
              }
            ]
          },
          status: 201
        }
      },
      currentThreadId: 'thread:creator'
    })

    const args = {
      expected_revision: 4,
      goal: 'Shape shortcuts with the chart still visible.',
      known_facts: ['The history opens in a side panel.'],
      project_id: 'project:dental',
      request_id: 'request:history',
      title: 'Add patient history shortcuts'
    }
    const result = resultJson(await tools.get('workmap_create_todo_chat')?.handler?.(args))

    expect(requests[0]?.path).toBe('/agent-router/v1/pi/work-map/todo-chats/agent')
    expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({
      brief: {
        goal: 'Shape shortcuts with the chart still visible.',
        knownFacts: ['The history opens in a side panel.']
      },
      currentThreadId: 'thread:creator',
      expectedRevision: 4,
      projectId: 'project:dental',
      requestId: 'request:history'
    })
    expect(result).toMatchObject({ threadId: 'todo-chat:history', todoId: 'todo:history' })
  })

  test('resolves the active thread when a warm worker is claimed after registration', async () => {
    const tools = new Map<string, RegisteredTool>()
    const server = {
      registerTool(
        name: string,
        options: { description?: string; inputSchema: z.ZodType },
        handler: (args: Record<string, unknown>) => Promise<unknown>
      ) {
        tools.set(name, {
          description: options.description,
          handler,
          inputSchema: options.inputSchema
        })
      }
    }
    let activeThreadId: string | undefined
    registerWorkMapTools(server as McpServer, {
      authorityRequest: async () => ({
        ok: true,
        payload: { placements: [], projects: [], revision: 1, todos: [], version: 1 },
        status: 200
      }),
      get currentThreadId() {
        return activeThreadId
      }
    })

    activeThreadId = 'thread-after-claim'
    const result = resultJson(await tools.get('workmap_query')?.handler?.({}))
    expect(result.currentThreadId).toBe('thread-after-claim')
  })
})
