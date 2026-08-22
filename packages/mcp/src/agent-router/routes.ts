import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Context, Hono, Next } from 'hono'

import {
  resolveAgentAttachmentImagePaths,
  resolveAgentConversationAttachments
} from '#mcp/agent-attachments/paths'
import { AgentAttachmentStore } from '#mcp/agent-attachments/store'
import { bearerToken, isAuthorized } from '#mcp/auth'
import { localWorkspaceTraceEvidencePath } from '#mcp/local-workspace-authority/agent-context'
import type { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

import { previewAgentConversation, type AgentConversationRouter } from './contracts'
import { AGENT_MEDIA_ROUTE, agentMediaFileName, agentMediaMimeType } from './media'

const ROUTE = '/agent-router/v1/pi'
const FOCUSED_CONVERSATION_PREVIEW_LIMIT = 6

type RouteOptions = {
  attachmentStore?: AgentAttachmentStore
  authorityRoot: string
  getAuthToken(): string | null
  router: AgentConversationRouter
  traceEvidence: Pick<
    LocalWorkspaceAuthorityStore,
    'pinTraceEvidence' | 'releaseTraceEvidencePins' | 'unpinTraceEvidence'
  >
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function errorResponse(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const status = message.includes('unavailable') || message.includes('could not start') ? 503 : 422
  return context.json({ code: 'agent_dispatch_error', error: message }, status)
}

function threadEvidencePinId(threadId: string): string {
  return `agent-thread:${threadId}`
}

export function registerAgentRoutes(app: Hono, options: RouteOptions): void {
  const attachmentStore = options.attachmentStore ?? new AgentAttachmentStore(options.authorityRoot)
  app.use(`${ROUTE}/*`, async (context: Context, next: Next) => {
    const expected = options.getAuthToken()
    if (!expected) {
      return context.json({ code: 'router_auth_unavailable', error: 'Router unavailable' }, 503)
    }
    const provided = bearerToken(context.req.header('authorization'))
    if (!isAuthorized(provided, expected)) {
      return context.json({ code: 'unauthorized', error: 'Unauthorized' }, 401)
    }
    return next()
  })

  app.get(`${ROUTE}/status`, async (context) => context.json(await options.router.status()))
  app.get(`${ROUTE}/models`, (context) => context.json({ models: options.router.models() }))
  app.get(`${ROUTE}/provider-usage/:provider`, async (context) =>
    context.json({ usage: await options.router.providerUsage(context.req.param('provider')) })
  )
  app.get(`${AGENT_MEDIA_ROUTE}/:name`, async (context) => {
    const name = agentMediaFileName(context.req.param('name'))
    const mimeType = name ? agentMediaMimeType(name) : null
    if (!name || !mimeType?.startsWith('video/')) {
      return context.json({ code: 'agent_media_not_found', error: 'Agent media not found' }, 404)
    }
    try {
      const bytes = await readFile(path.join(options.authorityRoot, 'pi-conversations-media', name))
      return new Response(bytes, {
        headers: {
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Content-Type': mimeType
        }
      })
    } catch {
      return context.json({ code: 'agent_media_not_found', error: 'Agent media not found' }, 404)
    }
  })
  app.get(`${ROUTE}/conversations`, (context) =>
    context.json({
      threads:
        context.req.query('preview') === '1'
          ? options.router.conversationPreviews()
          : options.router.conversations()
    })
  )
  app.get(`${ROUTE}/conversations/:threadId/preview`, (context) => {
    const thread = options.router.conversation(context.req.param('threadId'))
    return thread
      ? context.json(previewAgentConversation(thread, FOCUSED_CONVERSATION_PREVIEW_LIMIT))
      : context.json({ code: 'agent_thread_not_found', error: 'Agent conversation not found' }, 404)
  })
  app.get(`${ROUTE}/conversations/:threadId`, (context) => {
    const thread = options.router.conversation(context.req.param('threadId'))
    return thread
      ? context.json(thread)
      : context.json({ code: 'agent_thread_not_found', error: 'Agent conversation not found' }, 404)
  })

  app.get(`${ROUTE}/jobs/:jobId`, (context) => {
    const job = options.router.job(context.req.param('jobId'))
    return job
      ? context.json(job)
      : context.json({ code: 'agent_job_not_found', error: 'Agent job not found' }, 404)
  })

  app.post(`${ROUTE}/conversations/:threadId/stop`, (context) =>
    options.router.stop(context.req.param('threadId'))
      ? context.json({ stopped: true })
      : context.json(
          { code: 'agent_thread_not_running', error: 'Agent conversation is not running' },
          409
        )
  )

  app.post(`${ROUTE}/conversations/:threadId/ui/:requestId/respond`, async (context) => {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid request body' }, 400)
    }
    try {
      const accepted = options.router.respondToUiRequest(
        context.req.param('threadId'),
        context.req.param('requestId'),
        {
          ...(body.cancelled === true ? { cancelled: true } : {}),
          ...(typeof body.confirmed === 'boolean' ? { confirmed: body.confirmed } : {}),
          ...(typeof body.value === 'string' ? { value: body.value } : {})
        }
      )
      return accepted
        ? context.json({ accepted: true })
        : context.json(
            { code: 'agent_ui_request_not_found', error: 'Approval no longer pending' },
            404
          )
    } catch (error) {
      return errorResponse(context, error)
    }
  })

  app.delete(`${ROUTE}/conversations/:threadId`, async (context) => {
    const threadId = context.req.param('threadId')
    if (!options.router.delete(threadId)) {
      return context.json(
        { code: 'agent_thread_not_found', error: 'Agent conversation not found' },
        404
      )
    }
    await options.traceEvidence.releaseTraceEvidencePins(threadEvidencePinId(threadId))
    await attachmentStore.releaseThread(threadId)
    return context.json({ deleted: true })
  })

  app.post(`${ROUTE}/reset-workers`, async (context) => {
    const threadIds = options.router.conversations().map((thread) => thread.id)
    const receipt = options.router.resetWorkers()
    await Promise.all(
      threadIds.map((threadId) =>
        Promise.all([
          options.traceEvidence.releaseTraceEvidencePins(threadEvidencePinId(threadId)),
          attachmentStore.releaseThread(threadId)
        ])
      )
    )
    return context.json(receipt)
  })

  async function acceptConversationMessage(context: Context, action: 'followUp' | 'steer') {
    const body = await context.req.json().catch(() => null)
    const threadId = context.req.param('threadId')
    if (!isRecord(body) || !threadId) {
      return context.json({ code: 'invalid_request', error: 'Invalid request body' }, 400)
    }
    const evidenceId = typeof body.evidenceId === 'string' ? body.evidenceId.trim() : ''
    const attachmentReferences = [body.attachments, body.attachmentImagePaths]
    const attachments = await resolveAgentConversationAttachments(
      options.authorityRoot,
      body.attachments
    )
    const pinId = threadEvidencePinId(threadId)
    const pinResult = evidenceId
      ? await options.traceEvidence.pinTraceEvidence(evidenceId, pinId)
      : 'already_pinned'
    if (pinResult === 'missing') {
      await attachmentStore.discardPending(attachmentReferences)
      return context.json(
        { code: 'trace_evidence_not_found', error: 'Trace evidence not found' },
        404
      )
    }
    try {
      const receipt = await options.router[action](
        threadId,
        typeof body.message === 'string' ? body.message : '',
        {
          ...(attachments.length ? { attachments } : {}),
          displayPrompt: typeof body.displayPrompt === 'string' ? body.displayPrompt : undefined,
          effort: typeof body.effort === 'string' ? body.effort : undefined,
          ...(evidenceId
            ? {
                evidencePath: localWorkspaceTraceEvidencePath(options.authorityRoot, evidenceId)
              }
            : {}),
          imagePaths: resolveAgentAttachmentImagePaths(
            options.authorityRoot,
            body.attachmentImagePaths
          ),
          model: typeof body.model === 'string' ? body.model : undefined
        }
      )
      await attachmentStore.claim(threadId, attachmentReferences).catch(() => undefined)
      return context.json(receipt, 202)
    } catch (error) {
      if (evidenceId && pinResult === 'pinned') {
        await options.traceEvidence.unpinTraceEvidence(evidenceId, pinId)
      }
      await attachmentStore.discardPending(attachmentReferences)
      return errorResponse(context, error)
    }
  }

  app.post(`${ROUTE}/conversations/:threadId/follow-up`, (context) =>
    acceptConversationMessage(context, 'followUp')
  )
  app.post(`${ROUTE}/conversations/:threadId/steer`, (context) =>
    acceptConversationMessage(context, 'steer')
  )

  async function acceptConversationLaunch(context: Context, sourceThreadId?: string) {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid request body' }, 400)
    }
    const evidenceId = typeof body.evidenceId === 'string' ? body.evidenceId.trim() : ''
    const attachmentReferences = [body.attachments, body.attachmentImagePaths]
    const attachments = await resolveAgentConversationAttachments(
      options.authorityRoot,
      body.attachments
    )
    const pendingPinId = `agent-dispatch:${randomUUID()}`
    const pinResult = evidenceId
      ? await options.traceEvidence.pinTraceEvidence(evidenceId, pendingPinId)
      : 'already_pinned'
    if (pinResult === 'missing') {
      await attachmentStore.discardPending(attachmentReferences)
      return context.json(
        { code: 'trace_evidence_not_found', error: 'Trace evidence not found' },
        404
      )
    }
    try {
      const request = {
        ...(attachments.length ? { attachments } : {}),
        displayPrompt: typeof body.displayPrompt === 'string' ? body.displayPrompt : undefined,
        effort: typeof body.effort === 'string' ? body.effort : '',
        ...(evidenceId
          ? {
              evidencePath: localWorkspaceTraceEvidencePath(options.authorityRoot, evidenceId)
            }
          : {}),
        imagePaths: resolveAgentAttachmentImagePaths(
          options.authorityRoot,
          body.attachmentImagePaths
        ),
        model: typeof body.model === 'string' ? body.model : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : ''
      }
      const receipt = sourceThreadId
        ? await options.router.fork(sourceThreadId, request)
        : await options.router.dispatch(request)
      await attachmentStore.claim(receipt.threadId, attachmentReferences).catch(() => undefined)
      if (evidenceId) {
        const threadPin = await options.traceEvidence.pinTraceEvidence(
          evidenceId,
          threadEvidencePinId(receipt.threadId)
        )
        if (threadPin !== 'missing') {
          await options.traceEvidence.unpinTraceEvidence(evidenceId, pendingPinId)
        }
      }
      return context.json(receipt, 202)
    } catch (error) {
      if (evidenceId && pinResult === 'pinned') {
        await options.traceEvidence.unpinTraceEvidence(evidenceId, pendingPinId)
      }
      await attachmentStore.discardPending(attachmentReferences)
      return errorResponse(context, error)
    }
  }

  app.post(`${ROUTE}/conversations/:threadId/fork`, (context) =>
    acceptConversationLaunch(context, context.req.param('threadId'))
  )
  app.post(`${ROUTE}/dispatch`, (context) => acceptConversationLaunch(context))
}
