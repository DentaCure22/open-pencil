import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Hono } from 'hono'

import { AgentAttachmentStore } from '#mcp/agent-attachments/store'
import type {
  AgentConversationRouter,
  AgentConversationThread,
  AgentDispatchRequest
} from '#mcp/agent-router/contracts'
import { registerAgentRoutes } from '#mcp/agent-router/routes'
import { WorkMapStore } from '#mcp/agent-router/work-map'
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
    workMap?: WorkMapStore
  } = {}
): Hono {
  const app = new Hono()
  registerAgentRoutes(app, {
    ...(options.attachmentStore ? { attachmentStore: options.attachmentStore } : {}),
    authorityRoot: options.authorityRoot ?? '/tmp/openpencil-trace-retention-test',
    getAuthToken: () => AUTH_TOKEN,
    router,
    traceEvidence,
    ...(options.workMap ? { workMap: options.workMap } : {})
  })
  return app
}

describe('agent Trace evidence retention', () => {
  test('creates a prepared Todo chat without dispatching a worker', async () => {
    const workMap = new WorkMapStore()
    workMap.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [{ name: 'Dental Chart', op: 'create_project', project_id: 'project:dental' }]
    })
    let draft: AgentConversationThread | null = null
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
        requestId: 'request:patient-history',
        title: 'Add patient history shortcuts'
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
      title: 'Add patient history shortcuts',
      todoDraft: { brief: { goal: 'Shape patient history shortcuts' } }
    })
    expect(payload.todo).toMatchObject({ status: 'todo', threadId: payload.thread.id })

    const startResponse = await app.request(
      `/agent-router/v1/pi/conversations/${encodeURIComponent(payload.thread.id)}/follow-up`,
      {
        body: JSON.stringify({ message: 'Start with the interaction states.' }),
        headers: { ...AUTHORIZATION, 'Content-Type': 'application/json' },
        method: 'POST'
      }
    )
    expect(startResponse.status).toBe(202)
    expect(workMap.snapshot().todos[0]).toMatchObject({ status: 'in_motion' })
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
      agentRouter({ conversation: (threadId) => (threadId === thread.id ? thread : null) }),
      new TraceEvidencePins(),
      { workMap }
    )

    const agentResponse = await app.request('/agent-router/v1/pi/work-map/agent', {
      body: JSON.stringify({
        currentThreadId: thread.id,
        expectedRevision: 0,
        operations: [
          { name: 'Treatment plan', op: 'create_project', project_id: 'project:treatment' },
          { op: 'place_chat', project_id: 'project:treatment', thread_id: thread.id }
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
        operations: [{ op: 'place_chat', project_id: 'project:treatment', thread_id: thread.id }]
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
      revision: 2
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
      agentRouter({ conversation: (threadId) => (threadId === thread.id ? thread : null) }),
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
      expect(await response.json()).toEqual({ files: [{ path: 'src/ChatComposer.vue' }] })
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
      agentRouter({ conversation: (threadId) => (threadId === thread.id ? thread : null) }),
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
    let observed: { request: AgentDispatchRequest; sourceThreadId: string } | null = null
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
    expect(await response.json()).toMatchObject({ jobId: 'job:forked', threadId: 'thread:forked' })
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
    let observed: { request: AgentDispatchRequest; sourceThreadId: string } | null = null
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
      body: JSON.stringify({ evidenceId: 'evidence:dispatch', prompt: 'Inspect this image' }),
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
      body: JSON.stringify({ evidenceId: 'evidence:failed', prompt: 'Inspect this image' }),
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
            { name: 'reference.txt', path: attachmentPath, size: 9, type: 'text/plain' }
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
})
