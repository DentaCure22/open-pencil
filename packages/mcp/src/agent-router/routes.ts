import { createHash, randomUUID } from 'node:crypto'
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
import { defaultUsageLedgerPath, readUsageTurns, rollupUsageSnapshot } from '#mcp/pi/usage-ledger'

import {
  previewAgentConversation,
  type AgentConversationAttachmentPart,
  type AgentConversationRouter,
  type AgentTodoBrief,
  type AgentToolScope
} from './contracts'
import { pageAgentConversation, type AgentConversationPageQuery } from './conversation-page'
import { AGENT_MEDIA_ROUTE, agentMediaFileName, agentMediaMimeType } from './media'
import { WorkspaceTerminalSessions } from './terminal-sessions'
import {
  parseWorkMapOperations,
  WorkMapStore,
  type WorkMapActor,
  type WorkMapOperation
} from './work-map'
import { readAgentWorkspaceFile, searchAgentWorkspaceFiles } from './workspace-files'

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
  workMap?: WorkMapStore
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function optionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function toolScope(value: unknown): AgentToolScope | undefined {
  return value === 'board-worker' || value === 'general' ? value : undefined
}

function conversationPageQuery(context: Context): AgentConversationPageQuery {
  const after = context.req.query('after')?.trim()
  const before = context.req.query('before')?.trim()
  return {
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
    byteBudget: optionalPositiveInt(context.req.query('bytes')),
    itemLimit: optionalPositiveInt(context.req.query('limit')),
    turnLimit: optionalPositiveInt(context.req.query('turns'))
  }
}

function errorResponse(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const status = message.includes('unavailable') || message.includes('could not start') ? 503 : 422
  return context.json({ code: 'agent_dispatch_error', error: message }, status)
}

function workMapErrorResponse(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const status = message.includes('revision conflict') ? 409 : 422
  return context.json({ code: 'work_map_update_error', error: message }, status)
}

function workMapActor(value: unknown): WorkMapActor {
  if (!isRecord(value)) return { kind: 'agent' }
  const currentThreadId =
    typeof value.currentThreadId === 'string' ? value.currentThreadId.trim() : ''
  return { ...(currentThreadId ? { currentThreadId } : {}), kind: 'agent' }
}

function requiredText(value: unknown, field: string, maximum: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) throw new TypeError(`${field} is required.`)
  if (text.length > maximum) throw new TypeError(`${field} is too long.`)
  return text
}

function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > maximum) throw new TypeError(`${field} is too long.`)
  return text || undefined
}

function optionalTextList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 24) {
    throw new TypeError(`${field} must contain at most 24 items.`)
  }
  return value.map((item, index) => requiredText(item, `${field}[${String(index)}]`, 1_000))
}

function todoBrief(value: unknown): AgentTodoBrief {
  if (!isRecord(value)) throw new TypeError('Todo brief is required.')
  const references = value.references
  if (references !== undefined && (!Array.isArray(references) || references.length > 24)) {
    throw new TypeError('Todo references must contain at most 24 items.')
  }
  return {
    ...(optionalTextList(value.acceptance, 'acceptance')
      ? { acceptance: optionalTextList(value.acceptance, 'acceptance') }
      : {}),
    ...(optionalTextList(value.constraints, 'constraints')
      ? { constraints: optionalTextList(value.constraints, 'constraints') }
      : {}),
    ...(optionalText(value.context, 'context', 4_000)
      ? { context: optionalText(value.context, 'context', 4_000) }
      : {}),
    ...(optionalText(value.desiredOutcome, 'desiredOutcome', 2_000)
      ? { desiredOutcome: optionalText(value.desiredOutcome, 'desiredOutcome', 2_000) }
      : {}),
    goal: requiredText(value.goal, 'Todo goal', 2_000),
    ...(optionalTextList(value.knownFacts, 'knownFacts')
      ? { knownFacts: optionalTextList(value.knownFacts, 'knownFacts') }
      : {}),
    ...(optionalTextList(value.openQuestions, 'openQuestions')
      ? { openQuestions: optionalTextList(value.openQuestions, 'openQuestions') }
      : {}),
    ...(Array.isArray(references)
      ? {
          references: references.map((reference, index) => {
            if (!isRecord(reference)) {
              throw new TypeError(`references[${String(index)}] is invalid.`)
            }
            const kind = requiredText(reference.kind, 'Reference kind', 40)
            if (!['board_object', 'chat', 'file', 'image', 'trace_evidence', 'url'].includes(kind)) {
              throw new TypeError(`references[${String(index)}] has an invalid kind.`)
            }
            return {
              id: requiredText(reference.id, 'Reference ID', 1_000),
              kind: kind as NonNullable<AgentTodoBrief['references']>[number]['kind'],
              label: requiredText(reference.label, 'Reference label', 240),
              ...(optionalText(reference.note, 'Reference note', 1_000)
                ? { note: optionalText(reference.note, 'Reference note', 1_000) }
                : {})
            }
          })
        }
      : {}),
    ...(optionalText(value.suggestedNextStep, 'suggestedNextStep', 2_000)
      ? { suggestedNextStep: optionalText(value.suggestedNextStep, 'suggestedNextStep', 2_000) }
      : {})
  }
}

function stableTodoChatId(prefix: string, seed: string): string {
  return `${prefix}:${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`
}

function operationThreadIds(operations: readonly WorkMapOperation[]): string[] {
  return [
    ...new Set(
      operations.flatMap((operation) => {
        if (operation.op === 'place_chat') return [operation.thread_id]
        if (operation.op === 'create_todo' && operation.thread_id) return [operation.thread_id]
        if (operation.op === 'update_todo' && operation.thread_id) return [operation.thread_id]
        return []
      })
    )
  ]
}

function threadEvidencePinId(threadId: string): string {
  return `agent-thread:${threadId}`
}

function evidenceImageAlt(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 255) : 'Attached image'
}

async function visibleEvidenceAttachment(
  authorityRoot: string,
  evidenceId: string,
  alt: unknown
): Promise<AgentConversationAttachmentPart | null> {
  const bytes = await readFile(localWorkspaceTraceEvidencePath(authorityRoot, evidenceId)).catch(
    () => null
  )
  return bytes
    ? {
        alt: evidenceImageAlt(alt),
        type: 'image',
        url: `data:image/png;base64,${bytes.toString('base64')}`
      }
    : null
}

async function visibleConversationAttachments(
  authorityRoot: string,
  value: unknown,
  evidenceId: string,
  evidenceAlt: unknown
): Promise<AgentConversationAttachmentPart[]> {
  const attachments = await resolveAgentConversationAttachments(authorityRoot, value)
  if (!evidenceId) return attachments
  const evidence = await visibleEvidenceAttachment(authorityRoot, evidenceId, evidenceAlt)
  return evidence ? [evidence, ...attachments] : attachments
}

export function registerAgentRoutes(app: Hono, options: RouteOptions): void {
  const attachmentStore = options.attachmentStore ?? new AgentAttachmentStore(options.authorityRoot)
  const terminalSessions = new WorkspaceTerminalSessions()
  const workMap = options.workMap ?? new WorkMapStore()
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
  app.get(`${ROUTE}/workspace-files`, async (context) => {
    const status = await options.router.status()
    const query = context.req.query('query') ?? ''
    const limit = optionalPositiveInt(context.req.query('limit')) ?? 24
    return context.json({
      files: await searchAgentWorkspaceFiles(status.workspaceRoot, query, limit)
    })
  })
  app.get(`${ROUTE}/workspace-file`, async (context) => {
    const status = await options.router.status()
    const relativePath = context.req.query('path') ?? ''
    try {
      return context.json(await readAgentWorkspaceFile(status.workspaceRoot, relativePath))
    } catch (error) {
      return context.json(
        {
          code: 'workspace_file_unavailable',
          error: error instanceof Error ? error.message : 'Workspace file unavailable'
        },
        422
      )
    }
  })
  app.post(`${ROUTE}/terminal-sessions`, async (context) => {
    const status = await options.router.status()
    try {
      return context.json(terminalSessions.create(status.workspaceRoot), 201)
    } catch (error) {
      return errorResponse(context, error)
    }
  })
  app.get(`${ROUTE}/terminal-sessions/:sessionId`, (context) => {
    try {
      const after = optionalPositiveInt(context.req.query('after')) ?? 0
      return context.json(terminalSessions.read(context.req.param('sessionId'), after))
    } catch (error) {
      return context.json({ code: 'terminal_session_not_found', error: String(error) }, 404)
    }
  })
  app.post(`${ROUTE}/terminal-sessions/:sessionId/input`, async (context) => {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body) || typeof body.data !== 'string' || body.data.length > 16_384) {
      return context.json({ code: 'invalid_request', error: 'Invalid terminal input' }, 400)
    }
    try {
      return context.json(terminalSessions.write(context.req.param('sessionId'), body.data))
    } catch (error) {
      return context.json({ code: 'terminal_session_unavailable', error: String(error) }, 409)
    }
  })
  app.delete(`${ROUTE}/terminal-sessions/:sessionId`, (context) =>
    terminalSessions.close(context.req.param('sessionId'))
      ? context.json({ closed: true })
      : context.json({ code: 'terminal_session_not_found', error: 'Terminal not found' }, 404)
  )
  app.get(`${ROUTE}/model-meter`, async (context) => {
    const days = optionalPositiveInt(context.req.query('days')) ?? 7
    const turns = await readUsageTurns(defaultUsageLedgerPath())
    return context.json({ available: true, ...rollupUsageSnapshot(turns, days) })
  })
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
  app.get(`${ROUTE}/work-map`, (context) => context.json(workMap.snapshot()))

  async function createTodoChat(context: Context, actorKind: 'agent' | 'user') {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid Todo chat request body' }, 400)
    }
    let createdThreadId = ''
    let threadExisted = false
    try {
      const projectId = requiredText(body.projectId, 'Project ID', 240)
      const title = requiredText(body.title, 'Todo title', 240)
      const requestId = requiredText(body.requestId, 'Request ID', 240)
      const creatorThreadId =
        actorKind === 'agent'
          ? requiredText(body.currentThreadId, 'Current thread ID', 240)
          : undefined
      const creator = creatorThreadId
        ? options.router.conversation(creatorThreadId)
        : null
      if (creatorThreadId && !creator) {
        return context.json(
          { code: 'agent_thread_not_found', error: 'Active agent conversation not found' },
          404
        )
      }
      const seed = [actorKind, creatorThreadId ?? 'user', projectId, requestId].join(':')
      const todoId = stableTodoChatId('todo', seed)
      createdThreadId = stableTodoChatId('todo-chat', seed)
      threadExisted = Boolean(options.router.conversation(createdThreadId))
      const thread = options.router.createTodoDraft({
        brief: todoBrief(body.brief),
        ...(creatorThreadId ? { createdByThreadId: creatorThreadId } : {}),
        effort:
          typeof body.effort === 'string' ? body.effort : creator?.effort,
        model: typeof body.model === 'string' ? body.model : creator?.model,
        projectId,
        threadId: createdThreadId,
        title,
        todoId
      })
      const actor: WorkMapActor =
        actorKind === 'agent'
          ? {
              createdThreadIds: [createdThreadId],
              currentThreadId: creatorThreadId,
              kind: 'agent'
            }
          : { kind: 'user' }
      const receipt = workMap.apply({
        actor,
        expectedRevision: body.expectedRevision as number,
        operations: [
          {
            description: thread.todoDraft?.brief.context || thread.todoDraft?.brief.goal,
            op: 'create_todo',
            project_id: projectId,
            thread_id: createdThreadId,
            title,
            todo_id: todoId
          }
        ],
        requestId: `todo-chat:${requestId}`
      })
      const snapshot = workMap.snapshot()
      return context.json(
        {
          ...snapshot,
          receipt,
          thread,
          todo: snapshot.todos.find((todo) => todo.id === todoId) ?? null
        },
        threadExisted ? 200 : 201
      )
    } catch (error) {
      if (createdThreadId && !threadExisted) options.router.delete(createdThreadId)
      return workMapErrorResponse(context, error)
    }
  }

  app.post(`${ROUTE}/work-map/todo-chats`, (context) => createTodoChat(context, 'user'))
  app.post(`${ROUTE}/work-map/todo-chats/agent`, (context) => createTodoChat(context, 'agent'))
  app.post(`${ROUTE}/work-map/apply`, async (context) => {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid Work Map request body' }, 400)
    }
    try {
      const operations = parseWorkMapOperations(body.operations)
      const missingThreadId = operationThreadIds(operations).find(
        (threadId) => !options.router.conversation(threadId)
      )
      if (missingThreadId) {
        return context.json(
          {
            code: 'agent_thread_not_found',
            error: `Agent conversation "${missingThreadId}" not found`
          },
          404
        )
      }
      const receipt = workMap.apply({
        actor: { kind: 'user' },
        expectedRevision: body.expectedRevision as number,
        operations,
        requestId: typeof body.requestId === 'string' ? body.requestId : undefined
      })
      return context.json({ ...workMap.snapshot(), receipt })
    } catch (error) {
      return workMapErrorResponse(context, error)
    }
  })
  app.post(`${ROUTE}/work-map/agent`, async (context) => {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid Work Map request body' }, 400)
    }
    try {
      const operations = parseWorkMapOperations(body.operations)
      const actor = workMapActor(body)
      if (actor.currentThreadId && !options.router.conversation(actor.currentThreadId)) {
        return context.json(
          { code: 'agent_thread_not_found', error: 'Active agent conversation not found' },
          404
        )
      }
      const missingThreadId = operationThreadIds(operations).find(
        (threadId) => !options.router.conversation(threadId)
      )
      if (missingThreadId) {
        return context.json(
          {
            code: 'agent_thread_not_found',
            error: `Agent conversation "${missingThreadId}" not found`
          },
          404
        )
      }
      const receipt = workMap.apply({
        actor,
        expectedRevision: body.expectedRevision as number,
        operations,
        requestId: typeof body.requestId === 'string' ? body.requestId : undefined
      })
      return context.json({ ...workMap.snapshot(), receipt })
    } catch (error) {
      return workMapErrorResponse(context, error)
    }
  })
  app.get(`${ROUTE}/conversations/:threadId/preview`, (context) => {
    const thread = options.router.conversation(context.req.param('threadId'))
    return thread
      ? context.json(previewAgentConversation(thread, FOCUSED_CONVERSATION_PREVIEW_LIMIT))
      : context.json({ code: 'agent_thread_not_found', error: 'Agent conversation not found' }, 404)
  })
  app.get(`${ROUTE}/conversations/:threadId/messages`, (context) => {
    const thread = options.router.conversation(context.req.param('threadId'))
    return thread
      ? context.json(pageAgentConversation(thread, conversationPageQuery(context)))
      : context.json({ code: 'agent_thread_not_found', error: 'Agent conversation not found' }, 404)
  })
  app.get(`${ROUTE}/conversations/:threadId`, (context) => {
    const thread = options.router.conversation(context.req.param('threadId'))
    if (!thread) {
      return context.json(
        { code: 'agent_thread_not_found', error: 'Agent conversation not found' },
        404
      )
    }
    return context.json(
      context.req.query('page') === '1'
        ? pageAgentConversation(thread, conversationPageQuery(context))
        : thread
    )
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

  app.post(`${ROUTE}/conversations/:threadId/title`, (context) => {
    const threadId = context.req.param('threadId')
    const thread = options.router.conversation(threadId)
    if (!thread) {
      return context.json(
        { code: 'agent_thread_not_found', error: 'Agent conversation not found' },
        404
      )
    }
    const accepted = options.router.ensureTitle(threadId)
    return context.json({ accepted, title: thread.title ?? null }, accepted ? 202 : 503)
  })

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
    const attachments = await visibleConversationAttachments(
      options.authorityRoot,
      body.attachments,
      evidenceId,
      body.evidenceAlt
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
      const startingTodoId =
        action === 'followUp'
          ? options.router.conversation(threadId)?.todoDraft?.todoId
          : undefined
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
          model: typeof body.model === 'string' ? body.model : undefined,
          toolScope: toolScope(body.toolScope)
        }
      )
      if (startingTodoId) {
        const todo = workMap.snapshot().todos.find((candidate) => candidate.id === startingTodoId)
        if (todo?.status === 'todo') {
          try {
            workMap.apply({
              actor: { kind: 'user' },
              expectedRevision: workMap.snapshot().revision,
              operations: [{ op: 'update_todo', status: 'in_motion', todo_id: todo.id }],
              requestId: `todo-start:${receipt.jobId}`
            })
          } catch {
            // The chat already started; the worker can reconcile a concurrent Work Map edit.
          }
        }
      }
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
    const attachments = await visibleConversationAttachments(
      options.authorityRoot,
      body.attachments,
      evidenceId,
      body.evidenceAlt
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
        prompt: typeof body.prompt === 'string' ? body.prompt : '',
        toolScope: toolScope(body.toolScope),
        ...(body.historyScope === 'full' || body.historyScope === 'effectiveContext'
          ? { historyScope: body.historyScope }
          : {})
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
