import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import type { Context, Hono } from 'hono'

import {
  resolveAgentAttachmentImagePaths,
  resolveAgentConversationAttachments
} from '#mcp/agent-attachments/paths'
import type { AgentAttachmentStore } from '#mcp/agent-attachments/store'
import { localWorkspaceTraceEvidencePath } from '#mcp/local-workspace-authority/agent-context'
import type { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

import { botCharterForThread, ensureBotCharter } from './bot-charter'
import type {
  AgentConversationAttachmentPart,
  AgentConversationRouter,
  AgentDispatchRequest,
  AgentToolScope
} from './contracts'
import type { WorkMapStore } from './work-map'

const ROUTE = '/agent-router/v1/pi'

type ConversationSelection = NonNullable<Parameters<AgentConversationRouter['followUp']>[2]>

type ConversationActionRouteOptions = {
  attachmentStore: AgentAttachmentStore
  authorityRoot: string
  router: AgentConversationRouter
  traceEvidence: Pick<LocalWorkspaceAuthorityStore, 'pinTraceEvidence' | 'unpinTraceEvidence'>
  workMap: WorkMapStore
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function errorResponse(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const status = message.includes('unavailable') || message.includes('could not start') ? 503 : 422
  return context.json({ code: 'agent_dispatch_error', error: message }, status)
}

function toolScope(value: unknown): AgentToolScope | undefined {
  return value === 'board-worker' || value === 'general' ? value : undefined
}

export function threadEvidencePinId(threadId: string): string {
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

function conversationSelection(
  body: Record<string, unknown>,
  attachments: AgentConversationAttachmentPart[],
  authorityRoot: string,
  evidenceId: string,
  botId?: string | null
): ConversationSelection {
  const botSelection: Pick<ConversationSelection, 'botId'> = {}
  if (botId === null) botSelection.botId = null
  else if (botId) botSelection.botId = botId
  return {
    ...(attachments.length ? { attachments } : {}),
    ...botSelection,
    displayPrompt: typeof body.displayPrompt === 'string' ? body.displayPrompt : undefined,
    effort: typeof body.effort === 'string' ? body.effort : undefined,
    ...(evidenceId
      ? { evidencePath: localWorkspaceTraceEvidencePath(authorityRoot, evidenceId) }
      : {}),
    imagePaths: resolveAgentAttachmentImagePaths(authorityRoot, body.attachmentImagePaths),
    model: typeof body.model === 'string' ? body.model : undefined,
    toolScope: toolScope(body.toolScope)
  }
}

function prepareBotLaunch(
  createBot: boolean,
  launchContext: { projectId?: string | null },
  authorityRoot: string,
  workMap: WorkMapStore
): string | undefined {
  if (!createBot) return undefined
  if (!launchContext.projectId) {
    throw new TypeError('Create a Bot directory before starting its persistent Bot chat.')
  }
  const botId = `bot:${randomUUID()}`
  const directoryName = workMap.project(launchContext.projectId)?.name
  ensureBotCharter(authorityRoot, { botId, directoryName })
  return botId
}

function conversationLaunchRequest(
  body: Record<string, unknown>,
  attachments: AgentConversationAttachmentPart[],
  authorityRoot: string,
  evidenceId: string,
  context: { projectId?: string | null; workspaceRoot?: string },
  botId?: string
): AgentDispatchRequest {
  const historyScope =
    body.historyScope === 'full' || body.historyScope === 'effectiveContext'
      ? body.historyScope
      : undefined
  return {
    ...(attachments.length ? { attachments } : {}),
    ...(botId ? { botId } : {}),
    displayPrompt: typeof body.displayPrompt === 'string' ? body.displayPrompt : undefined,
    effort: typeof body.effort === 'string' ? body.effort : '',
    ...(evidenceId
      ? { evidencePath: localWorkspaceTraceEvidencePath(authorityRoot, evidenceId) }
      : {}),
    ...(historyScope ? { historyScope } : {}),
    imagePaths: resolveAgentAttachmentImagePaths(authorityRoot, body.attachmentImagePaths),
    model: typeof body.model === 'string' ? body.model : '',
    ...(context.projectId !== undefined ? { projectId: context.projectId } : {}),
    prompt: typeof body.prompt === 'string' ? body.prompt : '',
    toolScope: toolScope(body.toolScope),
    ...(context.workspaceRoot ? { workspaceRoot: context.workspaceRoot } : {})
  }
}

function requestedLaunchContext(
  body: Record<string, unknown>,
  workMap: WorkMapStore
): { projectId: string | null; workspaceRoot?: string } {
  const suppliedWorkspace = typeof body.workspaceRoot === 'string' ? body.workspaceRoot.trim() : ''
  const hasExplicitProject = Object.hasOwn(body, 'projectId')
  if (hasExplicitProject) {
    if (body.projectId === null) {
      return { projectId: null, ...(suppliedWorkspace ? { workspaceRoot: suppliedWorkspace } : {}) }
    }
    if (typeof body.projectId !== 'string' || !body.projectId.trim()) {
      throw new TypeError('projectId must name a Work Map project or be null.')
    }
    const project = workMap.project(body.projectId.trim())
    if (!project) throw new TypeError(`Work Map project "${body.projectId.trim()}" was not found.`)
    return {
      projectId: project.id,
      ...(project.workspaceRoot || suppliedWorkspace
        ? { workspaceRoot: project.workspaceRoot ?? suppliedWorkspace }
        : {})
    }
  }
  if (suppliedWorkspace) {
    const project = workMap.projectForWorkspaceRoot(suppliedWorkspace)
    return {
      projectId: project?.id ?? null,
      workspaceRoot: project?.workspaceRoot ?? suppliedWorkspace
    }
  }
  return { projectId: null }
}

function inheritedForkContext(
  sourceThreadId: string,
  router: AgentConversationRouter,
  workMap: WorkMapStore
): { projectId?: string | null; workspaceRoot?: string } {
  const source = router.conversation(sourceThreadId)
  if (!source) return {}
  const placement = workMap
    .snapshot()
    .placements.find((candidate) => candidate.threadId === sourceThreadId)
  const projectId = placement ? placement.projectId : source.projectId
  const project = projectId ? workMap.project(projectId) : null
  return {
    ...(projectId !== undefined ? { projectId } : {}),
    ...(project?.workspaceRoot || source.workspaceRoot
      ? { workspaceRoot: project?.workspaceRoot ?? source.workspaceRoot }
      : {})
  }
}

export function registerConversationActionRoutes(
  app: Hono,
  options: ConversationActionRouteOptions
): void {
  const { attachmentStore, authorityRoot, router, traceEvidence, workMap } = options

  async function acceptConversationMessage(context: Context, action: 'followUp' | 'steer') {
    const body = await context.req.json().catch(() => null)
    const threadId = context.req.param('threadId')
    if (!isRecord(body) || !threadId) {
      return context.json({ code: 'invalid_request', error: 'Invalid request body' }, 400)
    }
    const evidenceId = typeof body.evidenceId === 'string' ? body.evidenceId.trim() : ''
    const attachmentReferences = [body.attachments, body.attachmentImagePaths]
    const attachments = await visibleConversationAttachments(
      authorityRoot,
      body.attachments,
      evidenceId,
      body.evidenceAlt
    )
    const pinId = threadEvidencePinId(threadId)
    const pinResult = evidenceId
      ? await traceEvidence.pinTraceEvidence(evidenceId, pinId)
      : 'already_pinned'
    if (pinResult === 'missing') {
      await attachmentStore.discardPending(attachmentReferences)
      return context.json(
        { code: 'trace_evidence_not_found', error: 'Trace evidence not found' },
        404
      )
    }
    try {
      const botContext = botCharterForThread(authorityRoot, workMap.snapshot(), threadId)
      const receipt = await router[action](
        threadId,
        typeof body.message === 'string' ? body.message : '',
        conversationSelection(
          body,
          attachments,
          authorityRoot,
          evidenceId,
          botContext?.botId ?? null
        )
      )
      await attachmentStore.claim(threadId, attachmentReferences).catch(() => undefined)
      return context.json(receipt, 202)
    } catch (error) {
      if (evidenceId && pinResult === 'pinned') {
        await traceEvidence.unpinTraceEvidence(evidenceId, pinId)
      }
      await attachmentStore.discardPending(attachmentReferences)
      return errorResponse(context, error)
    }
  }

  async function acceptConversationLaunch(context: Context, sourceThreadId?: string) {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid request body' }, 400)
    }
    const evidenceId = typeof body.evidenceId === 'string' ? body.evidenceId.trim() : ''
    const attachmentReferences = [body.attachments, body.attachmentImagePaths]
    const attachments = await visibleConversationAttachments(
      authorityRoot,
      body.attachments,
      evidenceId,
      body.evidenceAlt
    )
    const pendingPinId = `agent-dispatch:${randomUUID()}`
    const pinResult = evidenceId
      ? await traceEvidence.pinTraceEvidence(evidenceId, pendingPinId)
      : 'already_pinned'
    if (pinResult === 'missing') {
      await attachmentStore.discardPending(attachmentReferences)
      return context.json(
        { code: 'trace_evidence_not_found', error: 'Trace evidence not found' },
        404
      )
    }
    try {
      const forkSourceThreadId = sourceThreadId ?? ''
      const inheritsFork =
        Boolean(forkSourceThreadId) &&
        !Object.hasOwn(body, 'projectId') &&
        !(typeof body.workspaceRoot === 'string' && body.workspaceRoot.trim())
      const launchContext = inheritsFork
        ? inheritedForkContext(forkSourceThreadId, router, workMap)
        : requestedLaunchContext(body, workMap)
      const botId = prepareBotLaunch(body.createBot === true, launchContext, authorityRoot, workMap)
      const request = conversationLaunchRequest(
        body,
        attachments,
        authorityRoot,
        evidenceId,
        launchContext,
        botId
      )
      const receipt = sourceThreadId
        ? await router.fork(sourceThreadId, request)
        : await router.dispatch(request)
      const projectId = launchContext.projectId ?? null
      const operations = [
        { op: 'place_chat' as const, project_id: projectId, thread_id: receipt.threadId },
        ...(body.createBot === true
          ? ([
              {
                bot_id: botId,
                op: 'create_bot' as const,
                project_id: projectId,
                thread_id: receipt.threadId
              }
            ] as const)
          : [])
      ]
      workMap.apply({
        actor: { kind: 'system' },
        expectedRevision: workMap.snapshot().revision,
        operations,
        requestId: `chat-launch:${receipt.threadId}`
      })
      await attachmentStore.claim(receipt.threadId, attachmentReferences).catch(() => undefined)
      if (evidenceId) {
        const threadPin = await traceEvidence.pinTraceEvidence(
          evidenceId,
          threadEvidencePinId(receipt.threadId)
        )
        if (threadPin !== 'missing') {
          await traceEvidence.unpinTraceEvidence(evidenceId, pendingPinId)
        }
      }
      return context.json(receipt, 202)
    } catch (error) {
      if (evidenceId && pinResult === 'pinned') {
        await traceEvidence.unpinTraceEvidence(evidenceId, pendingPinId)
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
  app.post(`${ROUTE}/conversations/:threadId/fork`, (context) =>
    acceptConversationLaunch(context, context.req.param('threadId'))
  )
  app.post(`${ROUTE}/dispatch`, (context) => acceptConversationLaunch(context))
}
