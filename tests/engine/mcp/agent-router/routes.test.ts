import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    delete: () => true,
    dispatch: async () => receipt,
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
  options: { attachmentStore?: AgentAttachmentStore; authorityRoot?: string } = {}
): Hono {
  const app = new Hono()
  registerAgentRoutes(app, {
    ...(options.attachmentStore ? { attachmentStore: options.attachmentStore } : {}),
    authorityRoot: options.authorityRoot ?? '/tmp/openpencil-trace-retention-test',
    getAuthToken: () => AUTH_TOKEN,
    router,
    traceEvidence
  })
  return app
}

describe('agent Trace evidence retention', () => {
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
    expect(JSON.stringify(payload)).not.toContain('hidden tool output')
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
})
