import process from 'node:process'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { isLocalAgentChatContinuation } from '#mcp/pi/local-continuation'
import { fail, ok } from '#mcp/result'
import { agentAuth, authorityJson } from '#mcp/tool/authority-client'
import { workMapSnapshotFromPayload } from '#mcp/tool/work-map-registration'

import {
  chatSearchRecord,
  compactAgentChatCandidates,
  compactAgentChatContext,
  concreteSearchTerms,
  DEFAULT_CHAT_LIMIT,
  MAX_CHAT_LIMIT,
  queryScore,
  type AgentChatList,
  type AgentChatSearchRecord
} from './dispatch-chat-directory'

export { compactAgentChatCandidates, compactAgentChatContext } from './dispatch-chat-directory'

const DISPATCH_TIMEOUT_MS = 15_000

type DispatchWorkAction = 'continue' | 'fork' | 'new'

function withWorkMapPlacement(
  list: AgentChatList,
  payload: Record<string, unknown> | null
): AgentChatList {
  const workMap = workMapSnapshotFromPayload(payload)
  if (!workMap) return list
  const activeTodoThreadIds = new Set(
    workMap.todos.flatMap((todo) => (todo.threadId && !todo.archivedAt ? [todo.threadId] : []))
  )
  const archivedTodoThreadIds = new Set(
    workMap.todos.flatMap((todo) =>
      todo.threadId && todo.archivedAt && !activeTodoThreadIds.has(todo.threadId)
        ? [todo.threadId]
        : []
    )
  )
  const projects = new Map(workMap.projects.map((project) => [project.id, project]))
  const projectPath = (projectId: string | null): string[] => {
    if (!projectId) return ['Misc']
    const project = projects.get(projectId)
    if (!project) return ['Misc']
    const parent = project.parentId ? projects.get(project.parentId) : null
    return parent ? [parent.name, project.name] : [project.name]
  }
  const candidates = list.candidates
    .filter((candidate) => !archivedTodoThreadIds.has(candidate.threadId))
    .map((candidate) => {
      const placement = workMap.placements.find((value) => value.threadId === candidate.threadId)
      const projectId = placement?.projectId ?? null
      const directoryPath = projectPath(projectId)
      return {
        ...candidate,
        workMap: {
          directoryId: projectId,
          directoryPath,
          projectId,
          projectPath: directoryPath,
          todos: workMap.todos
            .filter((todo) => todo.threadId === candidate.threadId && !todo.archivedAt)
            .map((todo) => ({ id: todo.id, status: todo.status, title: todo.title }))
            .slice(0, 6)
        }
      }
    })
  return {
    ...list,
    boardPlacement: 'work_map_reported',
    candidates,
    matched: Math.max(0, list.matched - (list.candidates.length - candidates.length)),
    resumableCount: candidates.filter((candidate) => candidate.resumable).length,
    runningCount: candidates.filter((candidate) => candidate.state === 'running').length
  }
}

type AuthorityRequest = typeof authorityJson

export type DispatchWorkToolOptions = {
  authorityRequest?: AuthorityRequest
  currentThreadId?: string
}

function connectionFailure(error: unknown, port: number): Error {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new Error(
      `The worker launcher did not answer within ${String(DISPATCH_TIMEOUT_MS / 1000)}s; the assignment may still exist — check worker conversations before retrying.`
    )
  }
  const cause =
    error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
  return new Error(
    `Could not reach the OpenPencil local authority at 127.0.0.1:${String(port)}${cause}. ` +
      'The OpenPencil dev server is not running and agent-auth.json is stale. Start the dev server, then retry.'
  )
}

export type DispatchWorkArgs = {
  action: DispatchWorkAction
  exact_words: string
  intention: string
  target_thread_id?: string
}

type DispatchResponsePayload = {
  dispatchedAt?: string
  error?: string
  jobId?: string
  state?: string
  threadId?: string
}

export function composeDispatchWorkPrompt(args: DispatchWorkArgs): string {
  return [
    `/skill:openpencil ${args.exact_words.trim()}`,
    '',
    `Intention: ${args.intention.trim()}`
  ].join('\n')
}

export function composeDispatchRequest(args: DispatchWorkArgs): {
  action: DispatchWorkAction
  body: Record<string, string>
  route: string
  targetThreadId?: string
} {
  const targetThreadId = args.target_thread_id?.trim()
  const action = args.action
  if (action === 'new' && targetThreadId) {
    throw new TypeError('A new chat must not include a target thread ID.')
  }
  if (action === 'continue') {
    if (!targetThreadId) throw new TypeError('continue requires target_thread_id.')
    return {
      action,
      body: {
        displayPrompt: args.exact_words.trim(),
        message: composeDispatchWorkPrompt(args),
        toolScope: 'board-worker'
      },
      route: `/agent-router/v1/pi/conversations/${encodeURIComponent(targetThreadId)}/follow-up`,
      targetThreadId
    }
  }
  if (action === 'fork') {
    if (!targetThreadId) throw new TypeError('fork requires target_thread_id.')
    return {
      action,
      body: {
        displayPrompt: args.exact_words.trim(),
        effort: '',
        model: '',
        prompt: composeDispatchWorkPrompt(args),
        toolScope: 'board-worker'
      },
      route: `/agent-router/v1/pi/conversations/${encodeURIComponent(targetThreadId)}/fork`,
      targetThreadId
    }
  }
  return {
    action,
    body: {
      displayPrompt: args.exact_words.trim(),
      effort: '',
      model: '',
      prompt: composeDispatchWorkPrompt(args),
      toolScope: 'board-worker',
      workspaceRoot: process.cwd()
    },
    route: '/agent-router/v1/pi/dispatch'
  }
}

function dispatchReason(action: DispatchWorkAction): string {
  if (action === 'continue') return 'Sent the instruction to the existing chat.'
  if (action === 'fork') return 'Compact-forked the selected chat with its stored tail.'
  return 'Started a new Board worker chat.'
}

async function listAgentChats(
  args: { limit?: number; query?: string },
  options: DispatchWorkToolOptions
) {
  const query = args.query?.trim() ?? ''
  if (query && concreteSearchTerms(query).length === 0) {
    throw new TypeError(
      'Chat search needs concrete subject terms or an exact thread ID. Omit query only when the user explicitly asks for a chat inventory.'
    )
  }
  const authorityRequest = options.authorityRequest ?? authorityJson
  const [response, workMapResponse] = await Promise.all([
    authorityRequest('/agent-router/v1/pi/conversations?preview=1'),
    authorityRequest('/agent-router/v1/pi/work-map').catch(() => null)
  ])
  if (!response.ok) {
    throw new Error(
      typeof response.payload?.error === 'string'
        ? response.payload.error
        : `Agent chats unavailable (${String(response.status)}).`
    )
  }
  const list = compactAgentChatCandidates(
    response.payload ?? {},
    query,
    args.limit ?? DEFAULT_CHAT_LIMIT,
    options.currentThreadId?.trim() ?? ''
  )
  return ok(
    withWorkMapPlacement(
      list,
      workMapResponse?.ok && workMapResponse.payload ? workMapResponse.payload : null
    ),
    'list_agent_chats'
  )
}

async function activeReferenceRecord(
  authorityRequest: AuthorityRequest,
  currentThreadId: string,
  targetThreadId: string,
  query: string
): Promise<AgentChatSearchRecord | null> {
  if (!currentThreadId || currentThreadId === targetThreadId) return null
  const activeResponse = await authorityRequest(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(currentThreadId)}/preview`
  )
  if (!activeResponse.ok || !activeResponse.payload) {
    throw new Error('The active worker chat could not be verified, so external context is blocked.')
  }
  const activeRecord = chatSearchRecord(activeResponse.payload, currentThreadId)
  if (!activeRecord) {
    throw new Error('The active worker chat preview is invalid, so external context is blocked.')
  }
  if (isLocalAgentChatContinuation(activeRecord.latestUser)) {
    throw new TypeError(
      `“${activeRecord.latestUser}” continues the active chat. Use its existing history; do not open another chat.`
    )
  }
  if (!query || concreteSearchTerms(query).length === 0) {
    throw new TypeError(
      'Reading another chat requires concrete subject terms or its exact thread ID in query.'
    )
  }
  return activeRecord
}

async function getAgentChatContext(
  args: { query?: string; thread_id: string },
  options: DispatchWorkToolOptions
) {
  const threadId = args.thread_id.trim()
  const currentThreadId = options.currentThreadId?.trim() ?? ''
  const authorityRequest = options.authorityRequest ?? authorityJson
  const query = args.query?.trim() ?? ''
  const activeRecord = await activeReferenceRecord(
    authorityRequest,
    currentThreadId,
    threadId,
    query
  )
  const response = await authorityRequest(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}/preview`
  )
  if (!response.ok) {
    throw new Error(
      typeof response.payload?.error === 'string'
        ? response.payload.error
        : `Agent chat unavailable (${String(response.status)}).`
    )
  }
  if (!response.payload) throw new Error('Agent chat preview was empty.')
  const targetRecord = chatSearchRecord(response.payload)
  if (!targetRecord) throw new TypeError('Agent chat preview is invalid.')
  if (activeRecord && queryScore(targetRecord, query) === 0) {
    throw new TypeError('The selected chat does not match the concrete subject in query.')
  }
  const context = compactAgentChatContext(response.payload)
  return ok(
    {
      ...(activeRecord
        ? {
            activeThread: {
              currentTask: activeRecord.candidate.currentTask,
              threadId: currentThreadId
            }
          }
        : {}),
      contextRole: activeRecord ? 'external_reference' : 'chat_preview',
      ...context
    },
    'get_agent_chat_context'
  )
}

async function sendDispatch(args: DispatchWorkArgs) {
  const auth = await agentAuth()
  const request = composeDispatchRequest(args)
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${String(auth.port)}${request.route}`, {
      body: JSON.stringify(request.body),
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json'
      },
      method: 'POST',
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS)
    })
  } catch (error) {
    throw connectionFailure(error, auth.port)
  }
  const payload = (await response.json().catch(() => null)) as DispatchResponsePayload | null
  if (!response.ok) {
    throw new Error(payload?.error ?? `Worker dispatch failed (${String(response.status)}).`)
  }
  return ok(
    {
      action: request.action,
      dispatchedAt: payload?.dispatchedAt ?? new Date().toISOString(),
      jobId: payload?.jobId ?? '',
      reason: dispatchReason(request.action),
      state: payload?.state ?? 'queued',
      targetThreadId: payload?.threadId ?? request.targetThreadId ?? ''
    },
    'dispatch_work'
  )
}

export function registerDispatchWorkTool(
  mcpServer: McpServer,
  options: DispatchWorkToolOptions = {}
): void {
  const register = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void
  register(
    'list_agent_chats',
    {
      description:
        'List the resident Pi chat directory when the user asks about other chats or the active task genuinely needs one. Bare continuations such as “continue” or “figure it out” always refer to the active chat and must not trigger chat lookup. Omit query only for an explicit inventory request; otherwise use concrete subject terms or an exact thread ID. It does not report chat results, transcripts, or tool output—only task labels and status. Read-only.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(MAX_CHAT_LIMIT).optional(),
        query: z
          .string()
          .trim()
          .min(1)
          .max(240)
          .describe('Omit for inventory/status; otherwise use concrete task or object terms')
          .optional()
      })
    },
    async (args: { limit?: number; query?: string }) => {
      try {
        return await listAgentChats(args, options)
      } catch (error) {
        return fail(error)
      }
    }
  )
  register(
    'get_agent_chat_context',
    {
      description:
        'Read one bounded resident Pi chat as external reference after list_agent_chats identifies a concrete match. In a worker, never use this for “continue”, “go on”, “figure it out”, or another local follow-up; those use the active chat history. A worker must provide the same concrete subject or exact thread ID in query. External context never replaces the active task. Returns at most six human-facing messages and no tool calls, tool output, reasoning, attachments, or session data. Read-only.',
      inputSchema: z.object({
        query: z
          .string()
          .trim()
          .min(1)
          .max(240)
          .describe('Concrete subject terms or exact thread ID used to select this chat')
          .optional(),
        thread_id: z.string().trim().min(1).describe('Exact thread ID from list_agent_chats')
      })
    },
    async (args: { query?: string; thread_id: string }) => {
      try {
        return await getAgentChatContext(args, options)
      } catch (error) {
        return fail(error)
      }
    }
  )
  register(
    'dispatch_work',
    {
      description:
        'Send exactly what the user said plus a resolved intention to a new, continued, or forked Board worker chat. Continuing a running chat steers its active turn. Returns assignment, not completion.',
      inputSchema: z.object({
        action: z
          .enum(['continue', 'fork', 'new'])
          .describe('Continue a relevant chat, compact-fork its stored tail, or start new'),
        exact_words: z.string().trim().min(1).describe('What the user said, verbatim'),
        intention: z
          .string()
          .trim()
          .min(1)
          .describe('Resolved target and intended result in one bounded sentence'),
        target_thread_id: z
          .string()
          .trim()
          .min(1)
          .describe('Exact candidate thread ID for continue or fork')
          .optional()
      })
    },
    async (args: DispatchWorkArgs) => {
      try {
        return await sendDispatch(args)
      } catch (error) {
        return fail(error)
      }
    }
  )
}
