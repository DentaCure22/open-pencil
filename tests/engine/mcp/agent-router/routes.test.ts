import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Hono } from 'hono'

import { AgentAttachmentStore } from '#mcp/agent-attachments/store'
import { botCharterPath } from '#mcp/agent-router/bot-charter'
import type {
  AgentConversationRouter,
  AgentConversationThread,
  AgentDispatchRequest
} from '#mcp/agent-router/contracts'
import { registerAgentRoutes } from '#mcp/agent-router/routes'
import { WorkMapStore, type WorkMapInboxItem } from '#mcp/agent-router/work-map'
import { localWorkspaceTraceEvidencePath } from '#mcp/local-workspace-authority/agent-context'
import type { LocalWorkspaceTraceEvidencePinResult } from '#mcp/local-workspace-authority/trace-file-store'

const AUTH_TOKEN = 'trace-retention-test-token'
const AUTHORIZATION = { Authorization: `Bearer ${AUTH_TOKEN}` }

function agentRouter(overrides: Partial<AgentConversationRouter> = {}): AgentConversationRouter {
  const receipt = {
    dispatchedAt: '2026-08-22T12:00:00.000Z',
    jobId: 'job:trace-retention',
    state: 'running' as const,
    threadId: 'thread:trace-retention'
  }
  return {
    close: () => undefined,
    conversation: () => null,
    conversationPreviews: () => [],
    conversations: () => [],
    createTodoDraft: () => {
      throw new Error('Unexpected Todo draft creation')
    },
    updateTodoDraft: () => null,
    delete: () => true,
    dispatch: async () => receipt,
    ensureTitle: () => false,
    followUp: async () => receipt,
    fork: async () => receipt,
    job: () => null,
    models: () => [],
    providerUsage: async () => null,
    resetWorkers: () => ({ deleted: 0 }),
    respondToUiRequest: () => false,
    status: async () => ({ active: 0, available: true, workspaceRoot: '/tmp' }),
    steer: async () => receipt,
    stop: () => false,
    waitForJob: async () => null,
    ...overrides
  }
}

class TraceEvidencePins {
  readonly pinned: Array<{ evidenceId: string; pinId: string }> = []
  readonly released: string[] = []
  readonly unpinned: Array<{ evidenceId: string; pinId: string }> = []

  async pinTraceEvidence(
    evidenceId: string,
    pinId: string
  ): Promise<LocalWorkspaceTraceEvidencePinResult> {
    this.pinned.push({ evidenceId, pinId })
    return 'pinned'
  }

  async releaseTraceEvidencePins(pinId: string): Promise<number> {
    this.released.push(pinId)
    return 1
  }

  async unpinTraceEvidence(evidenceId: string, pinId: string): Promise<boolean> {
    this.unpinned.push({ evidenceId, pinId })
    return true
  }
}

function appWithRoutes(
  router: AgentConversationRouter,
  traceEvidence: TraceEvidencePins,
  options: {
    attachmentStore?: AgentAttachmentStore
    authorityRoot?: string
    boardSpace?: {
      assertBoardSpaceParent(input: {
        frameId: string
        pageId: string
        parentFrameId: string | null
      }): Promise<void>
    }
    routineScheduler?: { runNow(routineId: string): WorkMapInboxItem }
    workMap?: WorkMapStore
  } = {}
): Hono {
  const app = new Hono()
  registerAgentRoutes(app, {
    ...(options.attachmentStore ? { attachmentStore: options.attachmentStore } : {}),
    authorityRoot: options.authorityRoot ?? '/tmp/openpencil-trace-retention-test',
    ...(options.boardSpace ? { boardSpace: options.boardSpace } : {}),
    getAuthToken: () => AUTH_TOKEN,
    router,
    ...(options.routineScheduler ? { routineScheduler: options.routineScheduler } : {}),
    traceEvidence,
    ...(options.workMap ? { workMap: options.workMap } : {})
  })
  return app
}

describe('agent Trace evidence retention', () => {
  test('lets an explicitly asked agent promote its active chat to a scheduled Bot', async () => {
    const thread: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-26T12:00:00.000Z',
      effort: 'high',
      id: 'thread:bot',
      messages: [],
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Ready.',
      sessionId: 'session:bot',
      state: 'completed',
      task: 'Review the Dental Chart every morning',
      updatedAt: '2026-08-26T12:00:00.000Z',
      workerId: 'worker:bot'
    }
    const app = appWithRoutes(
      agentRouter({
        conversation: (threadId) => (threadId === thread.id ? thread : null)
      }),
      new TraceEvidencePins(),
      { workMap: new WorkMapStore() }
    )

    const response = await app.request('/agent-router/v1/pi/work-map/agent', {
      body: JSON.stringify({
        currentThreadId: thread.id,
        expectedRevision: 0,
        operations: [
          {
            bot_id: 'bot:dental-review',
            op: 'create_bot',
            project_id: null,
            thread_id: thread.id
          },
          {
            bot_id: 'bot:dental-review',
            every_minutes: 1_440,
            next_run_at: '2026-08-27T12:00:00.000Z',
            op: 'create_routine',
            prompt: 'Review the Dental Chart',
            routine_id: 'routine:dental-review'
          }
        ]
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      bots: [{ id: 'bot:dental-review', threadId: thread.id }],
      receipt: { previousRevision: 0, revision: 1 },
      routines: [{ botId: 'bot:dental-review', id: 'routine:dental-review' }]
    })
  })

  test('starts a Bot routine and returns its running Inbox receipt', async () => {
    const workMap = new WorkMapStore()
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Daily review',
          op: 'create_project',
          project_id: 'project:daily'
        },
        {
          bot_id: 'bot:daily',
          op: 'create_bot',
          project_id: 'project:daily',
          thread_id: 'thread:daily'
        },
        {
          bot_id: 'bot:daily',
          next_run_at: '2026-08-27T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review open work',
          routine_id: 'routine:daily'
        }
      ]
    })
    const app = appWithRoutes(agentRouter(), new TraceEvidencePins(), {
      routineScheduler: {
        runNow: (routineId) => workMap.beginRoutineRun(routineId, { force: true })
      },
      workMap
    })

    const response = await app.request(
      '/agent-router/v1/pi/work-map/routines/routine%3Adaily/run',
      { headers: AUTHORIZATION, method: 'POST' }
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      inboxItem: {
        routineId: 'routine:daily',
        status: 'running',
        threadId: 'thread:daily'
      },
      revision: 2
    })
  })

  test('updates an existing Bot routine through the user Work Map route', async () => {
    const workMap = new WorkMapStore()
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Daily review',
          op: 'create_project',
          project_id: 'project:daily'
        },
        {
          bot_id: 'bot:daily',
          op: 'create_bot',
          project_id: 'project:daily',
          thread_id: 'thread:daily'
        },
        {
          bot_id: 'bot:daily',
          every_minutes: 1_440,
          next_run_at: '2026-08-27T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review open work',
          routine_id: 'routine:daily'
        }
      ]
    })
    const original = workMap.snapshot().routines[0]
    const app = appWithRoutes(agentRouter(), new TraceEvidencePins(), {
      workMap
    })

    const response = await app.request('/agent-router/v1/pi/work-map/apply', {
      body: JSON.stringify({
        expectedRevision: 1,
        operations: [
          {
            create_briefing_object: true,
            op: 'update_routine',
            routine_id: 'routine:daily'
          }
        ]
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      revision: 2,
      routines: [
        {
          botId: original?.botId,
          briefingObject: true,
          createdAt: original?.createdAt,
          everyMinutes: original?.everyMinutes,
          id: original?.id,
          nextRunAt: original?.nextRunAt,
          prompt: original?.prompt
        }
      ]
    })
  })

  test('creates a prepared Todo chat without dispatching a worker', async () => {
    const workMap = new WorkMapStore()
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Dental Chart',
          op: 'create_project',
          project_id: 'project:dental'
        }
      ]
    })
    let draft: AgentConversationThread | null = null
    const titleRequests: string[] = []
    const app = appWithRoutes(
      agentRouter({
        conversation: (threadId) => (draft?.id === threadId ? draft : null),
        createTodoDraft: (request) => {
          draft = {
            canFollowUp: true,
            createdAt: '2026-08-25T12:00:00.000Z',
            effort: request.effort || 'high',
            id: request.threadId || 'thread:todo',
            messages: [],
            model: request.model || 'xai-auth/grok-4.6',
            recentUpdate: 'Ready to plan.',
            sessionId: null,
            state: 'completed',
            task: request.brief.goal,
            title: request.title,
            todoDraft: {
              brief: request.brief,
              kind: 'todo',
              projectId: request.projectId,
              todoId: request.todoId
            },
            updatedAt: '2026-08-25T12:00:00.000Z',
            workerId: 'worker:todo'
          }
          return draft
        },
        updateTodoDraft: (threadId, brief) => {
          if (!draft || threadId !== draft.id || !draft.todoDraft) return null
          draft.todoDraft.brief = brief
          draft.task = brief.goal
          draft.updatedAt = '2026-08-25T12:05:00.000Z'
          return structuredClone(draft)
        },
        ensureTitle: (threadId) => {
          titleRequests.push(threadId)
          return true
        }
      }),
      new TraceEvidencePins(),
      { workMap }
    )

    const response = await app.request('/agent-router/v1/pi/work-map/todo-chats', {
      body: JSON.stringify({
        brief: {
          goal: 'Shape patient history shortcuts',
          knownFacts: ['The chart stays visible while history opens.']
        },
        effort: 'high',
        expectedRevision: 1,
        model: 'xai-auth/grok-4.6',
        projectId: 'project:dental',
        requestId: 'request:patient-history'
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })
    const payload = (await response.json()) as {
      thread: AgentConversationThread
      todo: { status: string; threadId: string }
    }

    expect(response.status).toBe(201)
    expect(payload.thread).toMatchObject({
      messages: [],
      sessionId: null,
      title: '',
      todoDraft: { brief: { goal: 'Shape patient history shortcuts' } }
    })
    expect(payload.thread.todoDraft?.brief.documentHtml).toContain(
      '<h1 data-todo-title>Shape patient history shortcuts</h1>'
    )
    expect(payload.thread.todoDraft?.brief).toMatchObject({
      title: 'Shape patient history shortcuts'
    })
    expect(payload.thread.todoDraft?.brief.documentHtml).toContain(
      'data-openpencil-code-object="todo-document"'
    )
    expect(payload.thread.todoDraft?.brief.documentHtml).toContain('container-type: inline-size')
    expect(payload.todo).toMatchObject({
      status: 'todo',
      threadId: payload.thread.id,
      title: 'Shape patient history shortcuts'
    })
    expect(titleRequests).toEqual([payload.thread.id])

    const updateResponse = await app.request(
      `/agent-router/v1/pi/conversations/${encodeURIComponent(payload.thread.id)}/todo-draft`,
      {
        body: JSON.stringify({
          brief: {
            context: 'Keep the chart visible while the panel is open.',
            goal: 'Shape patient history shortcuts',
            references: [
              {
                id: '/tmp/history-panel.png',
                kind: 'image',
                label: 'History panel'
              }
            ]
          }
        }),
        headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
        method: 'PATCH'
      }
    )
    expect(updateResponse.status).toBe(200)
    expect(await updateResponse.json()).toMatchObject({
      thread: {
        messages: [],
        sessionId: null,
        todoDraft: {
          brief: {
            context: 'Keep the chart visible while the panel is open.',
            references: [{ kind: 'image', label: 'History panel' }]
          }
        }
      }
    })
    expect(workMap.snapshot().todos[0]).toMatchObject({ status: 'todo' })

    const startResponse = await app.request(
      `/agent-router/v1/pi/conversations/${encodeURIComponent(payload.thread.id)}/follow-up`,
      {
        body: JSON.stringify({ message: 'Start with the interaction states.' }),
        headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
        method: 'POST'
      }
    )
    expect(startResponse.status).toBe(202)
    expect(workMap.snapshot().todos[0]).toMatchObject({ status: 'todo' })
  })

  test('persists agent self-placement and user Work Map edits through one authority', async () => {
    const workMap = new WorkMapStore()
    const thread: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-25T12:00:00.000Z',
      effort: 'high',
      id: 'thread:work-map',
      messages: [],
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Working.',
      sessionId: 'session:work-map',
      state: 'running',
      task: 'Organize this chat',
      updatedAt: '2026-08-25T12:00:00.000Z',
      workerId: 'worker:work-map'
    }
    const app = appWithRoutes(
      agentRouter({
        conversation: (threadId) => (threadId === thread.id ? thread : null)
      }),
      new TraceEvidencePins(),
      { workMap }
    )

    const agentResponse = await app.request('/agent-router/v1/pi/work-map/agent', {
      body: JSON.stringify({
        currentThreadId: thread.id,
        expectedRevision: 0,
        operations: [
          {
            name: 'Treatment plan',
            op: 'create_project',
            project_id: 'project:treatment'
          },
          {
            op: 'place_chat',
            project_id: 'project:treatment',
            thread_id: thread.id
          },
          {
            op: 'create_todo',
            project_id: 'project:treatment',
            thread_id: thread.id,
            title: 'Organize this chat',
            todo_id: 'todo:work-map'
          },
          {
            op: 'update_todo',
            status: 'in_motion',
            todo_id: 'todo:work-map'
          }
        ]
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })
    expect(agentResponse.status).toBe(200)
    expect(await agentResponse.json()).toMatchObject({
      receipt: { previousRevision: 0, revision: 1 },
      revision: 1
    })

    const userResponse = await app.request('/agent-router/v1/pi/work-map/apply', {
      body: JSON.stringify({
        expectedRevision: 1,
        operations: [
          {
            op: 'place_chat',
            project_id: 'project:treatment',
            thread_id: thread.id
          },
          { op: 'archive_todo', todo_id: 'todo:work-map' }
        ]
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })
    expect(userResponse.status).toBe(200)

    const snapshotResponse = await app.request('/agent-router/v1/pi/work-map', {
      headers: AUTHORIZATION
    })
    expect(await snapshotResponse.json()).toMatchObject({
      placements: [{ manual: true, projectId: 'project:treatment', threadId: thread.id }],
      revision: 2,
      todos: [
        {
          archivedAt: expect.any(String),
          id: 'todo:work-map',
          status: 'in_motion'
        }
      ]
    })
  })

  test('forwards a bounded visible approval response to the resident Pi task', async () => {
    const traceEvidence = new TraceEvidencePins()
    let observed: unknown = null
    const app = appWithRoutes(
      agentRouter({
        respondToUiRequest: (threadId, requestId, response) => {
          observed = { requestId, response, threadId }
          return true
        }
      }),
      traceEvidence
    )

    const response = await app.request(
      '/agent-router/v1/pi/conversations/thread%3Amessages/ui/approval%3A1/respond',
      {
        body: JSON.stringify({ value: 'Allow once' }),
        headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
        method: 'POST'
      }
    )

    expect(response.status).toBe(200)
    expect(observed).toEqual({
      requestId: 'approval:1',
      response: { value: 'Allow once' },
      threadId: 'thread:messages'
    })
  })

  test('returns one bounded human-facing conversation preview', async () => {
    const traceEvidence = new TraceEvidencePins()
    const thread: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-22T11:00:00.000Z',
      effort: 'high',
      id: 'thread:preview',
      messages: [
        ...Array.from({ length: 8 }, (_, index) => ({
          createdAt: `2026-08-22T11:00:0${String(index)}.000Z`,
          id: `message:${String(index)}`,
          role: 'user' as const,
          text: `Message ${String(index)}`
        })),
        {
          createdAt: '2026-08-22T11:00:09.000Z',
          id: 'message:tool',
          parts: [
            {
              name: 'read',
              output: 'hidden tool output',
              state: 'success' as const,
              type: 'tool' as const
            }
          ],
          role: 'assistant',
          text: ''
        }
      ],
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Message 7',
      sessionId: 'session:preview',
      state: 'completed',
      task: 'Preview this conversation',
      updatedAt: '2026-08-22T11:00:09.000Z',
      workerId: 'worker:preview'
    }
    const app = appWithRoutes(
      agentRouter({
        conversation: (threadId) => (threadId === thread.id ? thread : null)
      }),
      traceEvidence
    )

    const response = await app.request(
      '/agent-router/v1/pi/conversations/thread%3Apreview/preview',
      { headers: AUTHORIZATION }
    )
    const payload = (await response.json()) as AgentConversationThread

    expect(response.status).toBe(200)
    expect(payload.messages.map((message) => message.text)).toEqual([
      'Message 2',
      'Message 3',
      'Message 4',
      'Message 5',
      'Message 6',
      'Message 7'
    ])
    expect(payload.lastUserMessageAt).toBe('2026-08-22T11:00:07.000Z')
    expect(JSON.stringify(payload)).not.toContain('hidden tool output')
  })

  test('requests a generated title for an existing conversation', async () => {
    const traceEvidence = new TraceEvidencePins()
    let requestedThreadId = ''
    const thread: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-22T11:00:00.000Z',
      effort: 'high',
      id: 'thread:title',
      messages: [],
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Completed.',
      sessionId: 'session:title',
      state: 'completed',
      task: 'Summarize this existing conversation',
      updatedAt: '2026-08-22T11:01:00.000Z',
      workerId: 'worker:title'
    }
    const app = appWithRoutes(
      agentRouter({
        conversation: (threadId) => (threadId === thread.id ? thread : null),
        ensureTitle(threadId) {
          requestedThreadId = threadId
          return true
        }
      }),
      traceEvidence
    )

    const response = await app.request('/agent-router/v1/pi/conversations/thread%3Atitle/title', {
      headers: AUTHORIZATION,
      method: 'POST'
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ accepted: true, title: null })
    expect(requestedThreadId).toBe(thread.id)
  })

  test('returns ranked workspace files for composer mentions', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-composer-files-'))
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    await writeFile(path.join(workspaceRoot, 'src', 'ChatComposer.vue'), '<template />')
    const app = appWithRoutes(
      agentRouter({
        status: async () => ({ active: 0, available: true, workspaceRoot })
      }),
      new TraceEvidencePins()
    )
    try {
      const response = await app.request('/agent-router/v1/pi/workspace-files?query=chat&limit=4', {
        headers: AUTHORIZATION
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        files: [{ path: 'src/ChatComposer.vue' }]
      })
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true })
    }
  })

  test('reads a real workspace file for the Files surface', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-files-surface-'))
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true })
    await writeFile(path.join(workspaceRoot, 'src', 'panel.ts'), 'export const panel = true\n')
    const app = appWithRoutes(
      agentRouter({
        status: async () => ({ active: 0, available: true, workspaceRoot })
      }),
      new TraceEvidencePins()
    )
    try {
      const response = await app.request('/agent-router/v1/pi/workspace-file?path=src%2Fpanel.ts', {
        headers: AUTHORIZATION
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        content: 'export const panel = true\n',
        path: 'src/panel.ts',
        truncated: false
      })
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true })
    }
  })

  test('pages a conversation tail without returning the full transcript', async () => {
    const traceEvidence = new TraceEvidencePins()
    const messages = Array.from({ length: 8 }, (_, index) => ({
      createdAt: `2026-08-22T11:${String(index).padStart(2, '0')}:00.000Z`,
      id: `user:${String(index)}`,
      role: 'user' as const,
      text: `Prompt ${String(index)}`
    }))
    const thread: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-22T11:00:00.000Z',
      effort: 'high',
      id: 'thread:page',
      messages,
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Prompt 7',
      sessionId: 'session:page',
      state: 'completed',
      task: 'Page this conversation',
      updatedAt: '2026-08-22T11:07:00.000Z',
      workerId: 'worker:page'
    }
    const app = appWithRoutes(
      agentRouter({
        conversation: (threadId) => (threadId === thread.id ? thread : null)
      }),
      traceEvidence
    )

    const tail = await app.request('/agent-router/v1/pi/conversations/thread%3Apage?page=1', {
      headers: AUTHORIZATION
    })
    const older = await app.request(
      '/agent-router/v1/pi/conversations/thread%3Apage/messages?before=user%3A3',
      { headers: AUTHORIZATION }
    )
    const tailPayload = (await tail.json()) as AgentConversationThread & {
      hasOlder?: boolean
      messageTotal?: number
    }
    const olderPayload = (await older.json()) as AgentConversationThread

    expect(tail.status).toBe(200)
    expect(older.status).toBe(200)
    expect(tailPayload.messageTotal).toBe(8)
    expect(tailPayload.hasOlder).toBe(true)
    expect(tailPayload.messages.map((message) => message.id)).toEqual([
      'user:3',
      'user:4',
      'user:5',
      'user:6',
      'user:7'
    ])
    expect(olderPayload.messages.map((message) => message.id)).toEqual([
      'user:0',
      'user:1',
      'user:2'
    ])
  })

  test('forks a resumable chat into a new native Pi thread', async () => {
    const traceEvidence = new TraceEvidencePins()
    let observed: {
      request: AgentDispatchRequest
      sourceThreadId: string
    } | null = null
    const app = appWithRoutes(
      agentRouter({
        fork: async (sourceThreadId, request) => {
          observed = { request, sourceThreadId }
          return {
            dispatchedAt: '2026-08-22T12:00:00.000Z',
            jobId: 'job:forked',
            state: 'running',
            threadId: 'thread:forked'
          }
        }
      }),
      traceEvidence
    )

    const response = await app.request('/agent-router/v1/pi/conversations/thread%3Asource/fork', {
      body: JSON.stringify({
        displayPrompt: 'Try the alternate layout.',
        effort: 'high',
        model: 'xai-auth/grok-4.6',
        prompt: '/skill:openpencil Try the alternate layout.'
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      jobId: 'job:forked',
      threadId: 'thread:forked'
    })
    expect(observed).toEqual({
      request: {
        displayPrompt: 'Try the alternate layout.',
        effort: 'high',
        imagePaths: [],
        model: 'xai-auth/grok-4.6',
        prompt: '/skill:openpencil Try the alternate layout.'
      },
      sourceThreadId: 'thread:source'
    })
  })

  test('forwards an explicit full history scope on fork', async () => {
    let observed: {
      request: AgentDispatchRequest
      sourceThreadId: string
    } | null = null
    const app = appWithRoutes(
      agentRouter({
        fork: async (sourceThreadId, request) => {
          observed = { request, sourceThreadId }
          return {
            dispatchedAt: '2026-08-22T12:00:00.000Z',
            jobId: 'job:forked',
            state: 'running',
            threadId: 'thread:forked'
          }
        }
      }),
      new TraceEvidencePins()
    )

    const response = await app.request('/agent-router/v1/pi/conversations/thread%3Asource/fork', {
      body: JSON.stringify({
        historyScope: 'full',
        prompt: 'Keep the whole parent.'
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(202)
    expect(observed).toMatchObject({
      request: { historyScope: 'full', prompt: 'Keep the whole parent.' },
      sourceThreadId: 'thread:source'
    })
  })

  test('routes a directory launch into its bound Work Map project before returning', async () => {
    const workMap = new WorkMapStore()
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Dental Chart',
          op: 'create_project',
          project_id: 'project:dental'
        },
        {
          op: 'set_project_workspace',
          project_id: 'project:dental',
          workspace_root: '/tmp/smylr-elite'
        }
      ]
    })
    let observed: AgentDispatchRequest | null = null
    const app = appWithRoutes(
      agentRouter({
        dispatch: async (request) => {
          observed = request
          return {
            dispatchedAt: '2026-08-26T12:00:00.000Z',
            jobId: 'job:dental',
            state: 'running',
            threadId: 'thread:dental'
          }
        }
      }),
      new TraceEvidencePins(),
      { workMap }
    )

    const response = await app.request('/agent-router/v1/pi/dispatch', {
      body: JSON.stringify({
        prompt: 'Update the chart.',
        workspaceRoot: '/tmp/smylr-elite/src/dental-chart'
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })

    expect(response.status).toBe(202)
    expect(observed).toMatchObject({
      projectId: 'project:dental',
      workspaceRoot: '/tmp/smylr-elite'
    })
    expect(workMap.snapshot().placements).toContainEqual(
      expect.objectContaining({
        manual: false,
        projectId: 'project:dental',
        threadId: 'thread:dental'
      })
    )
  })

  test('prepares a new Bot charter before dispatch and then inserts the Bot into Work Map', async () => {
    const authorityRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-new-bot-charter-'))
    const workMap = new WorkMapStore()
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          name: 'Dental Chart',
          op: 'create_project',
          project_id: 'project:dental'
        }
      ]
    })
    let botIdAtDispatch = ''
    let botsAtDispatch = workMap.snapshot().bots
    let charterAtDispatch = ''
    const app = appWithRoutes(
      agentRouter({
        dispatch: async (request) => {
          botIdAtDispatch = request.botId ?? ''
          botsAtDispatch = workMap.snapshot().bots
          charterAtDispatch = await readFile(botCharterPath(authorityRoot, botIdAtDispatch), 'utf8')
          return {
            dispatchedAt: '2026-08-26T12:00:00.000Z',
            jobId: 'job:dental-bot',
            state: 'running',
            threadId: 'thread:dental-bot'
          }
        }
      }),
      new TraceEvidencePins(),
      { authorityRoot, workMap }
    )

    try {
      const response = await app.request('/agent-router/v1/pi/dispatch', {
        body: JSON.stringify({
          createBot: true,
          projectId: 'project:dental',
          prompt: 'Start the Dental Chart Bot.'
        }),
        headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
        method: 'POST'
      })

      expect(response.status).toBe(202)
      expect(botIdAtDispatch).toMatch(/^bot:/)
      expect(botsAtDispatch).toEqual([])
      expect(charterAtDispatch).toContain(`Bot ${JSON.stringify(botIdAtDispatch)}`)
      expect(charterAtDispatch).toContain('Its directory is "Dental Chart".')
      expect(workMap.snapshot()).toMatchObject({
        bots: [
          {
            id: botIdAtDispatch,
            projectId: 'project:dental',
            threadId: 'thread:dental-bot'
          }
        ],
        placements: [{ projectId: 'project:dental', threadId: 'thread:dental-bot' }],
        projects: [{ botId: botIdAtDispatch, id: 'project:dental' }]
      })
    } finally {
      await rm(authorityRoot, { force: true, recursive: true })
    }
  })

  test('keeps an annotation evidence image on the visible conversation turn', async () => {
    const authorityRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-visible-evidence-'))
    const evidenceId = 'evidence:annotated-image'
    const evidencePath = localWorkspaceTraceEvidencePath(authorityRoot, evidenceId)
    await mkdir(path.dirname(evidencePath), { recursive: true })
    await writeFile(evidencePath, 'source image')
    let observedSelection: Parameters<AgentConversationRouter['followUp']>[2]
    const app = appWithRoutes(
      agentRouter({
        followUp: async (_threadId, _prompt, selection) => {
          observedSelection = selection
          return {
            dispatchedAt: '2026-08-22T12:00:00.000Z',
            jobId: 'job:image-edit',
            state: 'running',
            threadId: 'thread:image-edit'
          }
        }
      }),
      new TraceEvidencePins(),
      { authorityRoot }
    )

    try {
      const response = await app.request(
        '/agent-router/v1/pi/conversations/thread%3Aimage-edit/follow-up',
        {
          body: JSON.stringify({
            evidenceAlt: 'Image being edited',
            evidenceId,
            message: 'Apply the numbered annotations.'
          }),
          headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
          method: 'POST'
        }
      )

      expect(response.status).toBe(202)
      expect(observedSelection?.evidencePath).toBe(evidencePath)
      expect(observedSelection?.attachments).toEqual([
        {
          alt: 'Image being edited',
          type: 'image',
          url: `data:image/png;base64,${Buffer.from('source image').toString('base64')}`
        }
      ])
    } finally {
      await rm(authorityRoot, { force: true, recursive: true })
    }
  })

  test('transfers a dispatch pin to its task and releases it when the task is deleted', async () => {
    const traceEvidence = new TraceEvidencePins()
    const app = appWithRoutes(agentRouter(), traceEvidence)

    const dispatch = await app.request('/agent-router/v1/pi/dispatch', {
      body: JSON.stringify({
        evidenceId: 'evidence:dispatch',
        prompt: 'Inspect this image'
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })
    expect(dispatch.status).toBe(202)
    expect(traceEvidence.pinned).toHaveLength(2)
    expect(traceEvidence.pinned[0]?.pinId).toStartWith('agent-dispatch:')
    expect(traceEvidence.pinned[1]).toEqual({
      evidenceId: 'evidence:dispatch',
      pinId: 'agent-thread:thread:trace-retention'
    })
    expect(traceEvidence.unpinned[0]).toEqual({
      evidenceId: 'evidence:dispatch',
      pinId: traceEvidence.pinned[0]?.pinId
    })

    const deletion = await app.request('/agent-router/v1/pi/conversations/thread:trace-retention', {
      headers: AUTHORIZATION,
      method: 'DELETE'
    })
    expect(deletion.status).toBe(200)
    expect(traceEvidence.released).toEqual(['agent-thread:thread:trace-retention'])
  })

  test('removes a temporary dispatch pin when dispatch fails', async () => {
    const traceEvidence = new TraceEvidencePins()
    const app = appWithRoutes(
      agentRouter({
        dispatch: async () => {
          throw new Error('worker unavailable')
        }
      }),
      traceEvidence
    )

    const response = await app.request('/agent-router/v1/pi/dispatch', {
      body: JSON.stringify({
        evidenceId: 'evidence:failed',
        prompt: 'Inspect this image'
      }),
      headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
      method: 'POST'
    })
    expect(response.status).toBe(503)
    expect(traceEvidence.pinned).toHaveLength(1)
    expect(traceEvidence.unpinned).toEqual(traceEvidence.pinned)
  })

  test('removes newly uploaded attachment files when dispatch fails', async () => {
    const authorityRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-failed-attachment-'))
    const attachmentStore = new AgentAttachmentStore(authorityRoot)
    const directory = await attachmentStore.createBatchDirectory()
    const attachmentPath = path.join(directory, 'reference.txt')
    await writeFile(attachmentPath, 'reference')
    const traceEvidence = new TraceEvidencePins()
    const app = appWithRoutes(
      agentRouter({
        dispatch: async () => {
          throw new Error('worker unavailable')
        }
      }),
      traceEvidence,
      { attachmentStore, authorityRoot }
    )

    try {
      const response = await app.request('/agent-router/v1/pi/dispatch', {
        body: JSON.stringify({
          attachments: [
            {
              name: 'reference.txt',
              path: attachmentPath,
              size: 9,
              type: 'text/plain'
            }
          ],
          prompt: 'Inspect this file'
        }),
        headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
        method: 'POST'
      })

      expect(response.status).toBe(503)
      expect(await readFile(attachmentPath, 'utf8').catch(() => null)).toBeNull()
    } finally {
      await rm(authorityRoot, { force: true, recursive: true })
    }
  })

  test('returns the model meter rollup from the usage ledger', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-model-meter-route-'))
    const ledgerPath = path.join(root, 'turns.jsonl')
    const previous = process.env.OPENPENCIL_MODEL_METER_LOG
    process.env.OPENPENCIL_MODEL_METER_LOG = ledgerPath
    await writeFile(
      ledgerPath,
      `${JSON.stringify({
        at: new Date().toISOString(),
        cacheHitPercent: 82.9,
        cacheRead: 20_331,
        cacheWrite: 0,
        compacted: false,
        gapMs: null,
        input: 4_207,
        model: 'gemini-3-7-flash',
        output: 80,
        promptTokens: 24_538,
        provider: 'antigravity',
        reasoning: 20,
        source: 'live',
        threadId: 'session-1',
        toolsPresent: false,
        turnIndex: 2,
        usageSource: 'agy-sqlite'
      })}\n`
    )
    const app = appWithRoutes(agentRouter(), new TraceEvidencePins())
    try {
      const response = await app.request('/agent-router/v1/pi/model-meter?days=7', {
        headers: AUTHORIZATION
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        available: true,
        days: 7,
        rows: [
          {
            callHitPercent: 100,
            model: 'gemini-3-7-flash',
            provider: 'antigravity',
            tokenCachePercent: 82.9,
            turns: 1
          }
        ],
        turns: 1
      })
    } finally {
      if (previous === undefined) delete process.env.OPENPENCIL_MODEL_METER_LOG
      else process.env.OPENPENCIL_MODEL_METER_LOG = previous
      await rm(root, { force: true, recursive: true })
    }
  })

  test('rejects a sub-bot space that is not saved inside its parent Bot frame', async () => {
    const workMap = new WorkMapStore()
    const thread: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-26T12:00:00.000Z',
      effort: 'high',
      id: 'thread:history',
      messages: [],
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Working.',
      sessionId: 'session:history',
      state: 'running',
      task: 'Build patient history',
      updatedAt: '2026-08-26T12:00:00.000Z',
      workerId: 'worker:history'
    }
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        { name: 'Dental Chart', op: 'create_project', project_id: 'project:dental' },
        {
          name: 'Patient history',
          op: 'create_project',
          parent_id: 'project:dental',
          project_id: 'project:history'
        },
        {
          frame_id: 'frame:dental-space',
          op: 'set_project_space',
          page_id: 'page:dental',
          project_id: 'project:dental'
        },
        { op: 'place_chat', project_id: 'project:history', thread_id: thread.id }
      ]
    })
    const checks: Array<{ frameId: string; pageId: string; parentFrameId: string | null }> = []
    const app = appWithRoutes(
      agentRouter({
        conversation: (threadId) => (threadId === thread.id ? thread : null)
      }),
      new TraceEvidencePins(),
      {
        boardSpace: {
          async assertBoardSpaceParent(input) {
            checks.push(input)
            if (input.frameId === 'frame:history-at-page-root') {
              throw new TypeError(
                'Sub-bot Board frame "frame:history-at-page-root" must be a direct child of parent Bot frame "frame:dental-space".'
              )
            }
          }
        },
        workMap
      }
    )

    const request = (frameId: string) =>
      app.request('/agent-router/v1/pi/work-map/agent', {
        body: JSON.stringify({
          currentThreadId: thread.id,
          expectedRevision: 1,
          operations: [
            {
              frame_id: frameId,
              op: 'set_project_space',
              page_id: 'page:dental',
              project_id: 'project:history'
            }
          ]
        }),
        headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
        method: 'POST'
      })

    const rejected = await request('frame:history-at-page-root')
    expect(rejected.status).toBe(422)
    expect(await rejected.json()).toMatchObject({
      error: expect.stringContaining('must be a direct child of parent Bot frame')
    })
    expect(workMap.snapshot().revision).toBe(1)
    expect(checks[0]).toEqual({
      frameId: 'frame:history-at-page-root',
      pageId: 'page:dental',
      parentFrameId: 'frame:dental-space'
    })

    const accepted = await request('frame:history-space')
    expect(accepted.status).toBe(200)
    expect(workMap.snapshot().projects[1]).toMatchObject({
      spaceFrameId: 'frame:history-space',
      spacePageId: 'page:dental'
    })
  })
})
