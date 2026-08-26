import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { isLocalAgentChatContinuation } from '#mcp/pi/local-continuation'
import { fail, ok } from '#mcp/result'
import { agentAuth, authorityJson } from '#mcp/tool/authority-client'
import { workMapSnapshotFromPayload } from '#mcp/tool/work-map-registration'

const DISPATCH_TIMEOUT_MS = 15_000
const DEFAULT_CHAT_LIMIT = 6
const MAX_CHAT_LIMIT = 24
const MAX_CHAT_INTENT = 240
const MAX_CHAT_REFERENCE = 120
const MAX_CHAT_REFERENCES = 4
const MAX_CHAT_RESULT = 280
const MAX_CHAT_STATUS = 160
const MAX_FOCUSED_MESSAGE_TEXT = 480
const MAX_FOCUSED_MESSAGES = 6
const CHAT_QUERY_NOISE = new Set([
  'active',
  'agent',
  'agents',
  'all',
  'and',
  'available',
  'board',
  'boards',
  'carry',
  'chat',
  'chats',
  'completed',
  'continue',
  'conversation',
  'conversations',
  'current',
  'currently',
  'do',
  'doing',
  'existing',
  'figure',
  'figured',
  'figuring',
  'for',
  'go',
  'going',
  'have',
  'it',
  'keep',
  'list',
  'me',
  'my',
  'on',
  'open',
  'opened',
  'out',
  'please',
  'proceed',
  'recent',
  'resident',
  'resume',
  'running',
  'show',
  'still',
  'that',
  'the',
  'they',
  'this',
  'up',
  'we',
  'what',
  'which',
  'work',
  'working'
])

type DispatchWorkAction = 'continue' | 'fork' | 'new'

type AgentChatCandidate = {
  currentTask: string
  isCurrent: boolean
  resumable: boolean
  state: 'completed' | 'needs_attention' | 'running' | 'stopped'
  status: string
  threadId: string
  updatedAt: string
  workMap?: {
    projectId: string | null
    projectPath: string[]
    todos: Array<{ id: string; status: string; title: string }>
  }
}

type AgentChatContext = Omit<AgentChatCandidate, 'isCurrent'> & {
  latestResult: string
  originTask: string
  references: string[]
  recentMessages: Array<{ role: 'assistant' | 'user'; text: string }>
}

type AgentChatSearchRecord = {
  candidate: AgentChatCandidate
  latestResult: string
  latestUser: string
  originTask: string
  references: string[]
  recentMessages: AgentChatContext['recentMessages']
}

type AgentChatPayload = {
  threads?: unknown
}

type AgentChatList = {
  activeThreadId?: string
  boardPlacement: 'not_reported' | 'work_map_reported'
  candidates: AgentChatCandidate[]
  continuationPolicy?: 'cross_chat_available' | 'current_chat_only'
  hasMore: boolean
  matched: number
  resumableCount: number
  runningCount: number
  scope: 'resident_pi_chats'
}

function withWorkMapPlacement(
  list: AgentChatList,
  payload: Record<string, unknown> | null
): AgentChatList {
  const workMap = workMapSnapshotFromPayload(payload)
  if (!workMap) return list
  const projects = new Map(workMap.projects.map((project) => [project.id, project]))
  const projectPath = (projectId: string | null): string[] => {
    if (!projectId) return ['Misc']
    const project = projects.get(projectId)
    if (!project) return ['Misc']
    const parent = project.parentId ? projects.get(project.parentId) : null
    return parent ? [parent.name, project.name] : [project.name]
  }
  return {
    ...list,
    boardPlacement: 'work_map_reported',
    candidates: list.candidates.map((candidate) => {
      const placement = workMap.placements.find((value) => value.threadId === candidate.threadId)
      const projectId = placement?.projectId ?? null
      return {
        ...candidate,
        workMap: {
          projectId,
          projectPath: projectPath(projectId),
          todos: workMap.todos
            .filter((todo) => todo.threadId === candidate.threadId && todo.status !== 'finished')
            .map((todo) => ({ id: todo.id, status: todo.status, title: todo.title }))
            .slice(0, 6)
        }
      }
    })
  }
}

type AgentChatThread = {
  canFollowUp?: unknown
  id?: unknown
  messages?: unknown
  recentUpdate?: unknown
  sessionId?: unknown
  state?: unknown
  task?: unknown
  updatedAt?: unknown
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : ''
}

function conversationState(value: unknown): AgentChatCandidate['state'] | null {
  return value === 'completed' ||
    value === 'needs_attention' ||
    value === 'running' ||
    value === 'stopped'
    ? value
    : null
}

function humanMessages(value: unknown, maximum: number): AgentChatContext['recentMessages'] {
  const messages = Array.isArray(value) ? value : []
  return messages.flatMap<AgentChatContext['recentMessages'][number]>((message) => {
    if (!isRecord(message) || (message.role !== 'assistant' && message.role !== 'user')) return []
    const text = boundedText(message.text, maximum)
    return text ? [{ role: message.role, text }] : []
  })
}

function contextReferences(...values: string[]): string[] {
  const references: string[] = []
  const source = values.join('\n')
  for (const match of source.matchAll(/`([^`\r\n]{2,160})`|file:\/\/\/([^\s)]+)|\b\d+:\d+\b/gu)) {
    const raw = (match[1] || (match[2] ? `/${match[2]}` : match[0])).trim()
    const reference =
      raw.length > MAX_CHAT_REFERENCE ? `…${raw.slice(1 - MAX_CHAT_REFERENCE)}` : raw
    if (!references.includes(reference)) references.push(reference)
    if (references.length === MAX_CHAT_REFERENCES) break
  }
  return references
}

function lastMessageText(
  messages: AgentChatContext['recentMessages'],
  role: 'assistant' | 'user'
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === role) return message.text
  }
  return ''
}

function lastSubstantiveUserTask(
  messages: AgentChatContext['recentMessages'],
  originTask: string
): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user' || isLocalAgentChatContinuation(message.text)) continue
    return message.text
  }
  return originTask || lastMessageText(messages, 'user')
}

function chatSearchRecord(value: unknown, currentThreadId = ''): AgentChatSearchRecord | null {
  if (!isRecord(value)) return null
  const thread = value as AgentChatThread
  const state = conversationState(thread.state)
  const threadId = boundedText(thread.id, 160)
  const updatedAt = boundedText(thread.updatedAt, 80)
  if (!state || !threadId || !updatedAt) return null
  const recentMessages = humanMessages(thread.messages, MAX_FOCUSED_MESSAGE_TEXT)
  const latestUser = lastMessageText(recentMessages, 'user')
  const latestAssistant = lastMessageText(recentMessages, 'assistant')
  const originTask = boundedText(thread.task, MAX_CHAT_INTENT)
  const currentTask = boundedText(
    lastSubstantiveUserTask(recentMessages, originTask),
    MAX_CHAT_INTENT
  )
  const recentUpdate = boundedText(thread.recentUpdate, MAX_CHAT_STATUS)
  const latestResult = boundedText(
    latestAssistant || (state === 'completed' ? recentUpdate : ''),
    MAX_CHAT_RESULT
  )
  const status = state === 'completed' && latestResult ? '' : recentUpdate
  const references = contextReferences(currentTask, latestResult, status, originTask)
  return {
    candidate: {
      currentTask,
      isCurrent: Boolean(currentThreadId && threadId === currentThreadId),
      resumable:
        thread.canFollowUp === true &&
        typeof thread.sessionId === 'string' &&
        thread.sessionId.trim().length > 0,
      state,
      status,
      threadId,
      updatedAt
    },
    latestResult,
    latestUser,
    originTask,
    references,
    recentMessages
  }
}

function searchTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length > 1)
    )
  ]
}

function concreteSearchTerms(value: string): string[] {
  return searchTerms(value).filter((term) => !CHAT_QUERY_NOISE.has(term))
}

function queryScore(record: AgentChatSearchRecord, query: string): number {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return 1
  const fields = [
    { text: record.candidate.threadId, weight: 12 },
    { text: record.references.join(' '), weight: 10 },
    { text: record.candidate.currentTask, weight: 8 },
    { text: record.latestResult, weight: 5 },
    { text: record.candidate.status, weight: 3 },
    { text: record.originTask, weight: 2 }
  ].map((field) => ({
    normalized: field.text.toLowerCase(),
    tokens: new Set(searchTerms(field.text)),
    weight: field.weight
  }))
  const terms = concreteSearchTerms(normalized)
  if (!terms.length) return 0
  const concretePhrase = terms.join(' ')
  const exactPhrase = fields.some(
    (field) => field.normalized.includes(normalized) || field.normalized.includes(concretePhrase)
  )
  const matchedTerms = terms.filter((term) => fields.some((field) => field.tokens.has(term)))
  const requiredTerms = terms.length <= 1 ? terms.length : 2
  if (!exactPhrase && matchedTerms.length < requiredTerms) return 0
  let score = exactPhrase ? 20 : 0
  for (const field of fields) {
    for (const term of terms) {
      if (field.tokens.has(term)) score += field.weight
    }
  }
  if (record.candidate.state === 'needs_attention') score -= 2
  if (record.candidate.state === 'stopped') score -= 4
  return Math.max(1, score)
}

function activityRank(state: AgentChatCandidate['state']): number {
  if (state === 'running') return 0
  if (state === 'completed') return 1
  if (state === 'needs_attention') return 2
  return 3
}

export function compactAgentChatCandidates(
  payload: AgentChatPayload,
  query = '',
  limit = DEFAULT_CHAT_LIMIT,
  currentThreadId = ''
): AgentChatList {
  const boundedLimit = Math.min(MAX_CHAT_LIMIT, Math.max(1, Math.trunc(limit)))
  const records = (Array.isArray(payload.threads) ? payload.threads : []).flatMap((thread) => {
    const record = chatSearchRecord(thread, currentThreadId)
    return record ? [record] : []
  })
  const scored = records
    .flatMap((thread) => {
      const score = queryScore(thread, query)
      return score > 0 ? [{ candidate: thread.candidate, score }] : []
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      if (left.candidate.isCurrent !== right.candidate.isCurrent) {
        return left.candidate.isCurrent ? -1 : 1
      }
      const activity = activityRank(left.candidate.state) - activityRank(right.candidate.state)
      return activity || right.candidate.updatedAt.localeCompare(left.candidate.updatedAt)
    })
  const activeRecord = currentThreadId
    ? records.find((record) => record.candidate.threadId === currentThreadId)
    : undefined
  const currentChatOnly = Boolean(
    activeRecord && isLocalAgentChatContinuation(activeRecord.latestUser)
  )
  const visible =
    currentChatOnly && activeRecord
      ? [{ candidate: activeRecord.candidate, score: Number.POSITIVE_INFINITY }]
      : scored
  return {
    ...(currentThreadId ? { activeThreadId: currentThreadId } : {}),
    boardPlacement: 'not_reported',
    candidates: visible.slice(0, boundedLimit).map(({ candidate }) => candidate),
    ...(activeRecord
      ? {
          continuationPolicy: currentChatOnly
            ? ('current_chat_only' as const)
            : ('cross_chat_available' as const)
        }
      : {}),
    hasMore: visible.length > boundedLimit,
    matched: visible.length,
    resumableCount: visible.filter(({ candidate }) => candidate.resumable).length,
    runningCount: visible.filter(({ candidate }) => candidate.state === 'running').length,
    scope: 'resident_pi_chats'
  }
}

export function compactAgentChatContext(payload: Record<string, unknown>): AgentChatContext {
  const record = chatSearchRecord(payload)
  if (!record) throw new TypeError('Agent chat preview is invalid.')
  const { isCurrent: _isCurrent, ...candidate } = record.candidate
  return {
    ...candidate,
    latestResult: record.latestResult,
    originTask:
      record.originTask && record.originTask !== record.candidate.currentTask
        ? record.originTask
        : '',
    references: record.references,
    recentMessages: record.recentMessages.slice(-MAX_FOCUSED_MESSAGES)
  }
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
      toolScope: 'board-worker'
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

async function getAgentChatContext(
  args: { query?: string; thread_id: string },
  options: DispatchWorkToolOptions
) {
  const threadId = args.thread_id.trim()
  const currentThreadId = options.currentThreadId?.trim() ?? ''
  const authorityRequest = options.authorityRequest ?? authorityJson
  let activeRecord: AgentChatSearchRecord | null = null
  if (currentThreadId && currentThreadId !== threadId) {
    const activeResponse = await authorityRequest(
      `/agent-router/v1/pi/conversations/${encodeURIComponent(currentThreadId)}/preview`
    )
    if (!activeResponse.ok || !activeResponse.payload) {
      throw new Error(
        'The active worker chat could not be verified, so external context is blocked.'
      )
    }
    activeRecord = chatSearchRecord(activeResponse.payload, currentThreadId)
    if (!activeRecord) {
      throw new Error('The active worker chat preview is invalid, so external context is blocked.')
    }
    if (isLocalAgentChatContinuation(activeRecord.latestUser)) {
      throw new TypeError(
        `“${activeRecord.latestUser}” continues the active chat. Use its existing history; do not open another chat.`
      )
    }
    const query = args.query?.trim() ?? ''
    if (!query || concreteSearchTerms(query).length === 0) {
      throw new TypeError(
        'Reading another chat requires concrete subject terms or its exact thread ID in query.'
      )
    }
  }
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
  const query = args.query?.trim() ?? ''
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
