import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { registerWorkMapTools, workMapSnapshotFromPayload } from '#mcp/tool/work-map-registration'

type RegisteredTool = {
  description?: string
  handler?: (args: Record<string, unknown>) => Promise<unknown>
  inputSchema?: z.ZodType
}

type WorkMapToolResult = {
  currentThreadId?: string
  [key: string]: unknown
}

function resultJson(value: unknown): WorkMapToolResult {
  const text = (value as { content?: Array<{ text?: unknown }> }).content?.[0]?.text
  if (typeof text !== 'string') throw new Error('Expected an MCP text result.')
  return JSON.parse(text) as WorkMapToolResult
}

describe('Work Map MCP tools', () => {
  test('projects both legacy and current authority snapshots for chat placement', () => {
    const payload = {
      placements: [{ manual: true, projectId: null, threadId: 'thread:one' }],
      projects: [{ id: 'project:one', name: 'One' }],
      revision: 4,
      todos: [
        {
          id: 'todo:one',
          projectId: 'project:one',
          status: 'todo',
          title: 'One'
        }
      ]
    }

    for (const version of [1, 2]) {
      expect(workMapSnapshotFromPayload({ ...payload, version })).toEqual({
        placements: payload.placements,
        projects: payload.projects,
        todos: payload.todos
      })
    }
  })

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
          bots: [
            {
              createdAt: '2026-08-25T12:00:00.000Z',
              id: 'bot:current',
              projectId: 'project:treatment',
              threadId: 'thread:current',
              updatedAt: '2026-08-25T12:00:00.000Z'
            }
          ],
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
              botId: 'bot:current',
              createdAt: '2026-08-25T12:00:00.000Z',
              id: 'project:treatment',
              name: 'Treatment plan',
              spaceFrameId: 'frame:treatment-space',
              spacePageId: 'page:treatment',
              updatedAt: '2026-08-25T12:00:00.000Z'
            }
          ],
          revision: 4,
          routines: [
            {
              botId: 'bot:current',
              createdAt: '2026-08-25T12:00:00.000Z',
              enabled: true,
              id: 'routine:daily',
              nextRunAt: '2026-08-26T12:00:00.000Z',
              prompt: 'Review the treatment plan',
              updatedAt: '2026-08-25T12:00:00.000Z'
            }
          ],
          todos: [
            {
              createdAt: '2026-08-25T12:00:00.000Z',
              id: 'todo:active',
              projectId: 'project:treatment',
              status: 'todo',
              title: 'Active work',
              updatedAt: '2026-08-25T12:00:00.000Z'
            },
            {
              archivedAt: '2026-08-25T12:10:00.000Z',
              createdAt: '2026-08-25T12:00:00.000Z',
              id: 'todo:archived',
              projectId: 'project:treatment',
              status: 'in_motion',
              title: 'Archived work',
              updatedAt: '2026-08-25T12:10:00.000Z'
            }
          ],
          version: 2
        },
        status: 200
      }),
      currentThreadId: 'thread:current'
    })

    expect([...tools.keys()].sort()).toEqual([
      'workmap_apply',
      'workmap_capture_future_work',
      'workmap_query',
      'workmap_update_todo_object'
    ])
    const result = resultJson(await tools.get('workmap_query')?.handler?.({}))
    expect(result).toMatchObject({
      bots: [{ id: 'bot:current', threadId: 'thread:current' }],
      currentBot: { id: 'bot:current', threadId: 'thread:current' },
      currentPlacement: { projectId: 'project:treatment', threadId: 'thread:current' },
      currentThreadId: 'thread:current',
      directories: [
        {
          botId: 'bot:current',
          id: 'project:treatment',
          openTodoCount: 1,
          space: { frameId: 'frame:treatment-space', pageId: 'page:treatment' }
        }
      ],
      projects: [
        {
          botId: 'bot:current',
          id: 'project:treatment',
          openTodoCount: 1,
          space: { frameId: 'frame:treatment-space', pageId: 'page:treatment' }
        }
      ],
      revision: 4,
      routines: [{ botId: 'bot:current', id: 'routine:daily' }],
      selectedDirectoryId: 'project:treatment',
      selectedProjectId: 'project:treatment',
      todoCounts: { in_motion: 0, todo: 1 },
      todos: [{ id: 'todo:active' }]
    })
    expect(tools.get('workmap_apply')?.description).toContain(
      'Todo and In motion are the only active states'
    )
    expect(tools.get('workmap_apply')?.description).toContain('create_bot')
    expect(tools.get('workmap_apply')?.description).toContain('Bots never live in Inbox or Misc')
    expect(tools.get('workmap_apply')?.description).toContain('set_project_space')
    expect(tools.get('workmap_apply')?.description).toContain('never creates an empty Board frame')
    expect(tools.get('workmap_apply')?.description).toContain('first Board object')
    expect(tools.get('workmap_apply')?.description).toContain(
      'sub-bot Board frame must be created or reparented inside its bound parent Bot frame'
    )
    expect(tools.get('workmap_query')?.description).toContain('exact Board space frame/page')
    expect(tools.get('workmap_query')?.description).toContain(
      'required Board parent for the sub-bot space'
    )
    expect(tools.get('workmap_query')?.description).toContain(
      'no Board space until its first Board object'
    )
    expect(tools.get('workmap_apply')?.description).not.toContain('Finished')
    expect(tools.get('workmap_apply')?.description).not.toContain('Needs you')
    expect(tools.get('workmap_capture_future_work')?.description).toContain(
      'without interrupting the current task'
    )
    expect(tools.get('workmap_capture_future_work')?.description).toContain(
      'one editable, responsive Todo Code Object'
    )
    expect(tools.get('workmap_update_todo_object')?.description).toContain(
      "active chat's existing Todo Code Object"
    )
  })

  test('exposes the bound parent Bot space to a sub-bot worker', async () => {
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
          bots: [],
          placements: [
            {
              manual: false,
              projectId: 'project:history',
              threadId: 'thread:current',
              updatedAt: '2026-08-26T12:00:00.000Z'
            }
          ],
          projects: [
            {
              createdAt: '2026-08-26T12:00:00.000Z',
              id: 'project:dental',
              name: 'Dental Chart',
              spaceFrameId: 'frame:dental-space',
              spacePageId: 'page:dental',
              updatedAt: '2026-08-26T12:00:00.000Z'
            },
            {
              createdAt: '2026-08-26T12:00:00.000Z',
              id: 'project:history',
              name: 'Patient history',
              parentId: 'project:dental',
              updatedAt: '2026-08-26T12:00:00.000Z'
            }
          ],
          revision: 2,
          routines: [],
          todos: [],
          version: 2
        },
        status: 200
      }),
      currentThreadId: 'thread:current'
    })

    const result = resultJson(await tools.get('workmap_query')?.handler?.({}))
    expect(result).toMatchObject({
      directories: [
        {
          id: 'project:dental',
          space: { frameId: 'frame:dental-space', pageId: 'page:dental' }
        },
        {
          id: 'project:history',
          parentId: 'project:dental',
          space: null
        }
      ],
      selectedDirectoryId: 'project:history'
    })
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
        {
          frame_id: 'frame:treatment-space',
          op: 'set_project_space',
          page_id: 'page:treatment',
          project_id: 'project:treatment'
        },
        { bot_id: 'bot:current', op: 'create_bot', project_id: 'project:treatment' },
        {
          bot_id: 'bot:current',
          every_minutes: 1_440,
          next_run_at: '2026-08-26T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review the treatment plan'
        },
        { op: 'create_todo', project_id: 'project:treatment', title: 'Review plan editor' }
      ]
    }
    expect(schema?.safeParse(args).success).toBe(true)
    expect(
      schema?.safeParse({
        expected_revision: 2,
        operations: [{ op: 'create_bot', project_id: null }]
      }).success
    ).toBe(false)
    expect(
      schema?.safeParse({
        expected_revision: 2,
        operations: [{ op: 'update_todo', status: 'finished', todo_id: 'todo:active' }]
      }).success
    ).toBe(false)
    expect(
      schema?.safeParse({
        expected_revision: 2,
        operations: [{ op: 'archive_todo', todo_id: 'todo:active' }]
      }).success
    ).toBe(false)
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
          frame_id: 'frame:treatment-space',
          op: 'set_project_space',
          page_id: 'page:treatment',
          project_id: 'project:treatment'
        },
        {
          bot_id: 'bot:current',
          op: 'create_bot',
          project_id: 'project:treatment',
          thread_id: 'thread:current'
        },
        {
          bot_id: 'bot:current',
          every_minutes: 1_440,
          next_run_at: '2026-08-26T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review the treatment plan'
        },
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

    expect(
      tools.get('workmap_capture_future_work')?.inputSchema?.safeParse({
        expected_revision: 4,
        goal: 'Validate the treatment flow.',
        project_id: 'project:treatment',
        request_id: 'request:prepared',
        title: 'Validate treatment flow'
      }).success
    ).toBe(true)

    const result = resultJson(
      await tools.get('workmap_capture_future_work')?.handler?.({
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
      document_html: '<!doctype html><html><body><h1>Patient history</h1></body></html>',
      expected_revision: 4,
      goal: 'Shape shortcuts with the chart still visible.',
      known_facts: ['The history opens in a side panel.'],
      project_id: 'project:dental',
      request_id: 'request:history',
      title: 'Add patient history shortcuts'
    }
    const result = resultJson(await tools.get('workmap_capture_future_work')?.handler?.(args))

    expect(requests[0]?.path).toBe('/agent-router/v1/pi/work-map/todo-chats/agent')
    expect(JSON.parse(requests[0]?.body ?? '{}')).toMatchObject({
      brief: {
        documentHtml: '<!doctype html><html><body><h1>Patient history</h1></body></html>',
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

  test('updates the active Todo Code Object without changing lifecycle state', async () => {
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
        return { ok: true, payload: { thread: { id: 'todo-chat:active' } }, status: 200 }
      },
      currentThreadId: 'todo-chat:active'
    })

    const html =
      '<!doctype html><html><body><main><h1 data-todo-title>Responsive Todo</h1></main></body></html>'
    const result = resultJson(
      await tools
        .get('workmap_update_todo_object')
        ?.handler?.({ document_html: html, title: 'Responsive Todo' })
    )

    expect(requests[0]?.path).toBe(
      '/agent-router/v1/pi/conversations/todo-chat%3Aactive/todo-draft'
    )
    expect(JSON.parse(requests[0]?.body ?? '{}')).toEqual({
      documentHtml: html,
      title: 'Responsive Todo'
    })
    expect(result).toMatchObject({
      threadId: 'todo-chat:active',
      title: 'Responsive Todo',
      updated: true
    })
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
    const activeThread = { id: undefined as string | undefined }
    registerWorkMapTools(server as McpServer, {
      authorityRequest: async () => ({
        ok: true,
        payload: { placements: [], projects: [], revision: 1, todos: [], version: 1 },
        status: 200
      }),
      get currentThreadId() {
        return activeThread.id
      }
    })

    activeThread.id = 'thread-after-claim'
    const result = resultJson(await tools.get('workmap_query')?.handler?.({}))
    expect(result.currentThreadId).toBe('thread-after-claim')
  })

  test('lets the live parent archive and restore exact chats without exposing deletion', async () => {
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
      allowConversationLifecycle: true,
      authorityRequest: async (requestPath, init) => {
        requests.push({ body: init?.body as string | undefined, path: requestPath })
        return {
          ok: true,
          payload: {
            placements: [],
            projects: [{ id: 'project:one', name: 'One' }],
            receipt: { previousRevision: 4, revision: 5 },
            revision: 5,
            todos: [
              {
                id: 'todo:active',
                projectId: 'project:one',
                status: 'todo',
                title: 'Active chat'
              },
              {
                archivedAt: '2026-08-26T12:00:00.000Z',
                id: 'todo:archived',
                projectId: 'project:one',
                status: 'in_motion',
                title: 'Archived chat'
              }
            ]
          },
          status: 200
        }
      }
    })

    const querySchema = tools.get('workmap_query')?.inputSchema
    const applySchema = tools.get('workmap_apply')?.inputSchema
    expect(querySchema?.safeParse({ include_archived: true }).success).toBe(true)
    expect(
      applySchema?.safeParse({
        expected_revision: 4,
        operations: [{ confirmed: true, op: 'archive_todo', todo_id: 'todo:active' }]
      }).success
    ).toBe(true)
    expect(
      applySchema?.safeParse({
        expected_revision: 4,
        operations: [{ op: 'archive_todo', todo_id: 'todo:active' }]
      }).success
    ).toBe(false)
    expect(
      applySchema?.safeParse({
        expected_revision: 4,
        operations: [{ op: 'restore_todo', todo_id: 'todo:archived' }]
      }).success
    ).toBe(true)
    expect(
      applySchema?.safeParse({
        expected_revision: 4,
        operations: [{ op: 'delete_todo', todo_id: 'todo:active' }]
      }).success
    ).toBe(false)
    expect(tools.get('workmap_apply')?.description).toContain('No delete operation is exposed')

    const activeOnly = resultJson(await tools.get('workmap_query')?.handler?.({}))
    expect(activeOnly.todos).toEqual([
      { id: 'todo:active', projectId: 'project:one', status: 'todo', title: 'Active chat' }
    ])
    const withArchived = resultJson(
      await tools.get('workmap_query')?.handler?.({ include_archived: true })
    )
    expect(withArchived.todos).toEqual([
      { id: 'todo:active', projectId: 'project:one', status: 'todo', title: 'Active chat' },
      {
        archivedAt: '2026-08-26T12:00:00.000Z',
        id: 'todo:archived',
        projectId: 'project:one',
        status: 'in_motion',
        title: 'Archived chat'
      }
    ])

    await tools.get('workmap_apply')?.handler?.({
      expected_revision: 4,
      operations: [{ confirmed: true, op: 'archive_todo', todo_id: 'todo:active' }]
    })
    await tools.get('workmap_apply')?.handler?.({
      expected_revision: 5,
      operations: [{ op: 'restore_todo', todo_id: 'todo:archived' }]
    })

    const applyRequests = requests.filter((request) => request.path.endsWith('/work-map/apply'))
    expect(applyRequests).toHaveLength(2)
    expect(JSON.parse(applyRequests[0]?.body ?? '{}')).toEqual({
      expectedRevision: 4,
      operations: [{ confirmed: true, op: 'archive_todo', todo_id: 'todo:active' }]
    })
    expect(JSON.parse(applyRequests[1]?.body ?? '{}')).toEqual({
      expectedRevision: 5,
      operations: [{ op: 'restore_todo', todo_id: 'todo:archived' }]
    })

    const mixed = await tools.get('workmap_apply')?.handler?.({
      expected_revision: 5,
      operations: [
        { confirmed: true, op: 'archive_todo', todo_id: 'todo:active' },
        { name: 'Two', op: 'create_project', project_id: 'project:two' }
      ]
    })
    expect((mixed as { isError?: boolean }).isError).toBe(true)
    expect(requests.filter((request) => request.path.endsWith('/work-map/apply'))).toHaveLength(2)
  })
})
