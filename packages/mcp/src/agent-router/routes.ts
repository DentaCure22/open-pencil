import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Context, Hono, Next } from 'hono'

import { AgentAttachmentStore } from '#mcp/agent-attachments/store'
import { bearerToken, isAuthorized } from '#mcp/auth'
import type { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'
import { defaultUsageLedgerPath, readUsageTurns, rollupUsageSnapshot } from '#mcp/pi/usage-ledger'

import {
  previewAgentConversation,
  type AgentConversationRouter,
  type AgentTodoBrief
} from './contracts'
import { registerConversationActionRoutes, threadEvidencePinId } from './conversation-actions'
import { pageAgentConversation, type AgentConversationPageQuery } from './conversation-page'
import { AGENT_MEDIA_ROUTE, agentMediaFileName, agentMediaMimeType } from './media'
import { isRecord, optionalText, requiredText, todoBrief } from './route-input'
import { WorkspaceTerminalSessions } from './terminal-sessions'
import { normalizeTodoCodeObjectBrief } from './todo-document'
import {
  parseWorkMapOperations,
  WorkMapStore,
  type WorkMapActor,
  type WorkMapOperation
} from './work-map'
import type { WorkMapRoutineScheduler } from './work-map-routine-scheduler'
import { readAgentWorkspaceFile, searchAgentWorkspaceFiles } from './workspace-files'

const ROUTE = '/agent-router/v1/pi'
const FOCUSED_CONVERSATION_PREVIEW_LIMIT = 6

type RouteOptions = {
  attachmentStore?: AgentAttachmentStore
  authorityRoot: string
  boardSpace?: {
    assertBoardSpaceParent(input: {
      frameId: string
      pageId: string
      parentFrameId: string | null
    }): Promise<void>
  }
  getAuthToken(): string | null
  router: AgentConversationRouter
  traceEvidence: Pick<
    LocalWorkspaceAuthorityStore,
    'pinTraceEvidence' | 'releaseTraceEvidencePins' | 'unpinTraceEvidence'
  >
  routineScheduler?: Pick<WorkMapRoutineScheduler, 'runNow'>
  workMap?: WorkMapStore
}

function optionalPositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
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

function workMapActor(value: unknown): Extract<WorkMapActor, { kind: 'agent' }> {
  if (!isRecord(value)) return { kind: 'agent' }
  const currentThreadId =
    typeof value.currentThreadId === 'string' ? value.currentThreadId.trim() : ''
  return { ...(currentThreadId ? { currentThreadId } : {}), kind: 'agent' }
}

type WorkMapBoardSpaceProject = {
  id: string
  parentId?: string
  spaceFrameId?: string
  spacePageId?: string
}

async function assertWorkMapBoardSpaceParents(
  workMap: WorkMapStore,
  operations: readonly WorkMapOperation[],
  boardSpace: RouteOptions['boardSpace']
): Promise<void> {
  if (!boardSpace) return
  const projects = new Map<string, WorkMapBoardSpaceProject>(
    workMap.snapshot().projects.map((project) => [project.id, { ...project }])
  )

  for (const operation of operations) {
    if (operation.op === 'create_project' && operation.project_id) {
      projects.set(operation.project_id, {
        id: operation.project_id,
        ...(operation.parent_id ? { parentId: operation.parent_id } : {})
      })
      continue
    }
    if (
      operation.op !== 'set_project_space' ||
      operation.frame_id === null ||
      operation.page_id === null
    ) {
      continue
    }

    const project = projects.get(operation.project_id)
    if (!project) continue
    const parentFrameId = project.parentId
      ? (projects.get(project.parentId)?.spaceFrameId ?? null)
      : null
    if (project.parentId && !parentFrameId) continue
    await boardSpace.assertBoardSpaceParent({
      frameId: operation.frame_id,
      pageId: operation.page_id,
      parentFrameId
    })
    project.spaceFrameId = operation.frame_id
    project.spacePageId = operation.page_id
  }
}

function stableTodoChatId(prefix: string, seed: string): string {
  return `${prefix}:${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`
}

function todoChatCreatorThreadId(
  body: Record<string, unknown>,
  actorKind: 'agent' | 'user'
): string | undefined {
  return actorKind === 'agent'
    ? requiredText(body.currentThreadId, 'Current thread ID', 240)
    : undefined
}

function todoChatActor(
  actorKind: 'agent' | 'user',
  creatorThreadId: string | undefined,
  createdThreadId: string
): WorkMapActor {
  return actorKind === 'agent'
    ? {
        createdThreadIds: [createdThreadId],
        currentThreadId: creatorThreadId,
        kind: 'agent'
      }
    : { kind: 'user' }
}

type PreparedTodoChat = {
  brief: AgentTodoBrief
  creatorThreadId?: string
  effort?: string
  explicitTitle?: string
  model?: string
  projectId: string
  requestId: string
  threadId: string
  title: string
  todoId: string
}

function prepareTodoChat(
  body: Record<string, unknown>,
  actorKind: 'agent' | 'user',
  router: AgentConversationRouter
): PreparedTodoChat | null {
  const projectId = requiredText(body.projectId, 'Project ID', 240)
  const requestId = requiredText(body.requestId, 'Request ID', 240)
  const parsedBrief = todoBrief(body.brief)
  const explicitTitle = optionalText(body.title, 'Todo title', 240)
  const title = explicitTitle ?? parsedBrief.goal.trim().replace(/\s+/g, ' ').slice(0, 240)
  const brief = normalizeTodoCodeObjectBrief(parsedBrief, title)
  const creatorThreadId = todoChatCreatorThreadId(body, actorKind)
  const creator = creatorThreadId ? router.conversation(creatorThreadId) : null
  if (creatorThreadId && !creator) return null
  const seed = [actorKind, creatorThreadId ?? 'user', projectId, requestId].join(':')
  return {
    brief,
    ...(creatorThreadId ? { creatorThreadId } : {}),
    effort: typeof body.effort === 'string' ? body.effort : creator?.effort,
    ...(explicitTitle ? { explicitTitle } : {}),
    model: typeof body.model === 'string' ? body.model : creator?.model,
    projectId,
    requestId,
    threadId: stableTodoChatId('todo-chat', seed),
    title,
    todoId: stableTodoChatId('todo', seed)
  }
}

function operationThreadIds(operations: readonly WorkMapOperation[]): string[] {
  return [
    ...new Set(
      operations.flatMap((operation) => {
        if (operation.op === 'place_chat') return [operation.thread_id]
        if (operation.op === 'create_bot') return [operation.thread_id]
        if (operation.op === 'create_todo' && operation.thread_id) return [operation.thread_id]
        if (operation.op === 'update_todo' && operation.thread_id) return [operation.thread_id]
        return []
      })
    )
  ]
}

export function registerAgentRoutes(app: Hono, options: RouteOptions): void {
  const attachmentStore = options.attachmentStore ?? new AgentAttachmentStore(options.authorityRoot)
  const terminalSessions = new WorkspaceTerminalSessions()
  const workMap = options.workMap ?? new WorkMapStore()
  const ensureBotDirectories = () =>
    workMap.ensureBotDirectories((threadId) => {
      const thread = options.router.conversation(threadId)
      return thread?.title?.trim() || thread?.task?.trim()
    })
  ensureBotDirectories()
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
  app.get(`${ROUTE}/work-map`, (context) => {
    ensureBotDirectories()
    return context.json(workMap.snapshot())
  })

  async function createTodoChat(context: Context, actorKind: 'agent' | 'user') {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid Todo chat request body' }, 400)
    }
    let createdThreadId = ''
    let threadExisted = false
    try {
      const prepared = prepareTodoChat(body, actorKind, options.router)
      if (!prepared) {
        return context.json(
          { code: 'agent_thread_not_found', error: 'Active agent conversation not found' },
          404
        )
      }
      createdThreadId = prepared.threadId
      threadExisted = Boolean(options.router.conversation(createdThreadId))
      const project = workMap.project(prepared.projectId)
      const thread = options.router.createTodoDraft({
        brief: prepared.brief,
        ...(prepared.creatorThreadId ? { createdByThreadId: prepared.creatorThreadId } : {}),
        effort: prepared.effort,
        model: prepared.model,
        projectId: prepared.projectId,
        threadId: createdThreadId,
        title: prepared.explicitTitle ?? '',
        todoId: prepared.todoId,
        ...(project?.workspaceRoot ? { workspaceRoot: project.workspaceRoot } : {})
      })
      const receipt = workMap.apply({
        actor: todoChatActor(actorKind, prepared.creatorThreadId, createdThreadId),
        expectedRevision: body.expectedRevision as number,
        operations: [
          {
            description: thread.todoDraft?.brief.context || thread.todoDraft?.brief.goal,
            op: 'create_todo',
            project_id: prepared.projectId,
            thread_id: createdThreadId,
            title: prepared.title,
            todo_id: prepared.todoId
          }
        ],
        requestId: `todo-chat:${prepared.requestId}`
      })
      await attachmentStore.claim(createdThreadId, body.attachments).catch(() => undefined)
      if (!prepared.explicitTitle) options.router.ensureTitle(createdThreadId)
      const snapshot = workMap.snapshot()
      return context.json(
        {
          ...snapshot,
          receipt,
          thread,
          todo: snapshot.todos.find((todo) => todo.id === prepared.todoId) ?? null
        },
        threadExisted ? 200 : 201
      )
    } catch (error) {
      if (createdThreadId && !threadExisted) options.router.delete(createdThreadId)
      await attachmentStore.discardPending(body.attachments)
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
      await assertWorkMapBoardSpaceParents(workMap, operations, options.boardSpace)
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
      await assertWorkMapBoardSpaceParents(workMap, operations, options.boardSpace)
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
  app.post(`${ROUTE}/work-map/routines/:routineId/run`, (context) => {
    if (!options.routineScheduler) {
      return context.json(
        { code: 'routine_scheduler_unavailable', error: 'Bot scheduler unavailable' },
        503
      )
    }
    try {
      const inboxItem = options.routineScheduler.runNow(context.req.param('routineId'))
      return context.json({ inboxItem, ...workMap.snapshot() }, 202)
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

  app.patch(`${ROUTE}/conversations/:threadId/todo-draft`, async (context) => {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid Todo update body' }, 400)
    }
    const threadId = context.req.param('threadId')
    try {
      const current = options.router.conversation(threadId)
      if (!current?.todoDraft) {
        await attachmentStore.discardPending(body.attachments)
        return context.json(
          { code: 'agent_todo_not_found', error: 'Todo conversation not found' },
          404
        )
      }
      const parsedBrief = isRecord(body.brief)
        ? todoBrief(body.brief)
        : normalizeTodoCodeObjectBrief(
            {
              ...current.todoDraft.brief,
              documentHtml: requiredText(body.documentHtml, 'Todo document HTML', 200_000),
              ...(optionalText(body.title, 'Todo title', 240)
                ? { title: optionalText(body.title, 'Todo title', 240) }
                : {})
            },
            optionalText(body.title, 'Todo title', 240) ||
              current.title ||
              current.todoDraft.brief.goal
          )
      const brief = normalizeTodoCodeObjectBrief(
        parsedBrief,
        parsedBrief.title || current.title || parsedBrief.goal
      )
      const thread = options.router.updateTodoDraft(threadId, brief)
      if (!thread) {
        await attachmentStore.discardPending(body.attachments)
        return context.json(
          { code: 'agent_todo_not_found', error: 'Todo conversation not found' },
          404
        )
      }
      await attachmentStore.claim(threadId, body.attachments)
      return context.json({ thread })
    } catch (error) {
      await attachmentStore.discardPending(body.attachments)
      return errorResponse(context, error)
    }
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

  registerConversationActionRoutes(app, {
    attachmentStore,
    authorityRoot: options.authorityRoot,
    router: options.router,
    traceEvidence: options.traceEvidence,
    workMap
  })
}
