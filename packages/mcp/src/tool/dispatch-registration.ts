import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fail, ok } from '#mcp/result'
import { agentAuth, authorityJson } from '#mcp/tool/authority-client'

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
  'available',
  'board',
  'boards',
  'chat',
  'chats',
  'completed',
  'conversation',
  'conversations',
  'current',
  'currently',
  'do',
  'existing',
  'have',
  'list',
  'me',
  'my',
  'on',
  'open',
  'opened',
  'please',
  'recent',
  'resident',
  'running',
  'show',
  'the',
  'up',
  'what',
  'which'
])

type DispatchWorkAction = 'continue' | 'fork' | 'new'

type AgentChatCandidate = {
  currentTask: string
  latestResult: string
  references: string[]
  resumable: boolean
  state: 'completed' | 'needs_attention' | 'running' | 'stopped'
  status: string
  threadId: string
  updatedAt: string
}

type AgentChatContext = AgentChatCandidate & {
  originTask: string
  recentMessages: Array<{ role: 'assistant' | 'user'; text: string }>
}

type AgentChatSearchRecord = {
  candidate: AgentChatCandidate
  originTask: string
  recentMessages: AgentChatContext['recentMessages']
}

type AgentChatPayload = {
  threads?: unknown
}

type AgentChatList = {
  boardPlacement: 'not_reported'
  candidates: AgentChatCandidate[]
  hasMore: boolean
  matched: number
  resumableCount: number
  runningCount: number
  scope: 'resident_pi_chats'
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
  action?: DispatchWorkAction
  continue_thread_id?: string
  done: string
  exact_words: string
  target_thread_id?: string
  turn_ended_at: string
  turn_started_at: string
}

type DispatchResponsePayload = {
  dispatchedAt?: string
  error?: string
  jobId?: string
  state?: string
  threadId?: string
}

const isoTimestamp = z
  .string()
  .trim()
  .refine((value) => Number.isFinite(Date.parse(value)), 'Expected an ISO timestamp')

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

function chatSearchRecord(value: unknown): AgentChatSearchRecord | null {
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
  const currentTask = boundedText(latestUser || originTask, MAX_CHAT_INTENT)
  const recentUpdate = boundedText(thread.recentUpdate, MAX_CHAT_STATUS)
  const latestResult = boundedText(
    latestAssistant || (state === 'completed' ? recentUpdate : ''),
    MAX_CHAT_RESULT
  )
  const status = state === 'completed' && latestResult ? '' : recentUpdate
  return {
    candidate: {
      currentTask,
      latestResult,
      references: contextReferences(currentTask, latestResult, status, originTask),
      resumable:
        thread.canFollowUp === true &&
        typeof thread.sessionId === 'string' &&
        thread.sessionId.trim().length > 0,
      state,
      status,
      threadId,
      updatedAt
    },
    originTask,
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

function queryScore(record: AgentChatSearchRecord, query: string): number {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return 1
  const fields = [
    { text: record.candidate.references.join(' '), weight: 10 },
    { text: record.candidate.currentTask, weight: 8 },
    { text: record.candidate.latestResult, weight: 5 },
    { text: record.candidate.status, weight: 3 },
    { text: record.originTask, weight: 2 }
  ].map((field) => ({
    normalized: field.text.toLowerCase(),
    tokens: new Set(searchTerms(field.text)),
    weight: field.weight
  }))
  const terms = searchTerms(normalized).filter((term) => !CHAT_QUERY_NOISE.has(term))
  if (!terms.length) return 1
  const exactPhrase = fields.some((field) => field.normalized.includes(normalized))
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
  limit = DEFAULT_CHAT_LIMIT
): AgentChatList {
  const boundedLimit = Math.min(MAX_CHAT_LIMIT, Math.max(1, Math.trunc(limit)))
  const scored = (Array.isArray(payload.threads) ? payload.threads : [])
    .flatMap((thread) => {
      const record = chatSearchRecord(thread)
      if (!record) return []
      const score = queryScore(record, query)
      return score > 0 ? [{ candidate: record.candidate, score }] : []
    })
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score
      const activity = activityRank(left.candidate.state) - activityRank(right.candidate.state)
      return activity || right.candidate.updatedAt.localeCompare(left.candidate.updatedAt)
    })
  return {
    boardPlacement: 'not_reported',
    candidates: scored.slice(0, boundedLimit).map(({ candidate }) => candidate),
    hasMore: scored.length > boundedLimit,
    matched: scored.length,
    resumableCount: scored.filter(({ candidate }) => candidate.resumable).length,
    runningCount: scored.filter(({ candidate }) => candidate.state === 'running').length,
    scope: 'resident_pi_chats'
  }
}

export function compactAgentChatContext(payload: Record<string, unknown>): AgentChatContext {
  const record = chatSearchRecord(payload)
  if (!record) throw new TypeError('Agent chat preview is invalid.')
  return {
    ...record.candidate,
    originTask:
      record.originTask && record.originTask !== record.candidate.currentTask
        ? record.originTask
        : '',
    recentMessages: record.recentMessages.slice(-MAX_FOCUSED_MESSAGES)
  }
}

export function composeDispatchWorkPrompt(args: DispatchWorkArgs): string {
  return [
    `/skill:openpencil ${args.exact_words.trim()}`,
    '',
    `Spoken turn: ${args.turn_started_at} to ${args.turn_ended_at}`,
    `Done: ${args.done.trim()}`
  ].join('\n')
}

export function composeDispatchRequest(args: DispatchWorkArgs): {
  action: DispatchWorkAction
  body: Record<string, string>
  route: string
  targetThreadId?: string
} {
  const legacyThreadId = args.continue_thread_id?.trim()
  const targetThreadId = args.target_thread_id?.trim()
  if (legacyThreadId && targetThreadId && legacyThreadId !== targetThreadId) {
    throw new TypeError('continue_thread_id and target_thread_id must identify the same chat.')
  }
  const selectedThreadId = targetThreadId || legacyThreadId
  const action = args.action ?? (selectedThreadId ? 'continue' : 'new')
  if (action === 'new' && selectedThreadId) {
    throw new TypeError('A new chat must not include a target thread ID.')
  }
  if (action === 'fork' && legacyThreadId && !targetThreadId) {
    throw new TypeError(
      'fork requires target_thread_id; continue_thread_id is only for continuation.'
    )
  }
  if (action === 'continue') {
    if (!selectedThreadId) throw new TypeError('continue requires target_thread_id.')
    return {
      action,
      body: {
        displayPrompt: args.exact_words.trim(),
        message: composeDispatchWorkPrompt(args)
      },
      route: `/agent-router/v1/pi/conversations/${encodeURIComponent(selectedThreadId)}/follow-up`,
      targetThreadId: selectedThreadId
    }
  }
  if (action === 'fork') {
    if (!selectedThreadId) throw new TypeError('fork requires target_thread_id.')
    return {
      action,
      body: {
        displayPrompt: args.exact_words.trim(),
        effort: '',
        model: '',
        prompt: composeDispatchWorkPrompt(args)
      },
      route: `/agent-router/v1/pi/conversations/${encodeURIComponent(selectedThreadId)}/fork`,
      targetThreadId: selectedThreadId
    }
  }
  return {
    action,
    body: {
      displayPrompt: args.exact_words.trim(),
      effort: '',
      model: '',
      prompt: composeDispatchWorkPrompt(args)
    },
    route: '/agent-router/v1/pi/dispatch'
  }
}

function dispatchReason(action: DispatchWorkAction): string {
  if (action === 'continue') return 'Sent the instruction to the existing chat.'
  if (action === 'fork') return 'Forked the selected chat with its existing context.'
  return 'Started a new Board worker chat.'
}

async function listAgentChats(args: { limit?: number; query?: string }) {
  const response = await authorityJson('/agent-router/v1/pi/conversations?preview=1')
  if (!response.ok) {
    throw new Error(
      typeof response.payload?.error === 'string'
        ? response.payload.error
        : `Agent chats unavailable (${String(response.status)}).`
    )
  }
  return ok(
    compactAgentChatCandidates(
      response.payload ?? {},
      args.query?.trim() ?? '',
      args.limit ?? DEFAULT_CHAT_LIMIT
    ),
    'list_agent_chats'
  )
}

async function getAgentChatContext(args: { thread_id: string }) {
  const threadId = args.thread_id.trim()
  const response = await authorityJson(
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
  return ok(compactAgentChatContext(response.payload), 'get_agent_chat_context')
}

async function sendDispatch(args: DispatchWorkArgs) {
  if (Date.parse(args.turn_started_at) > Date.parse(args.turn_ended_at)) {
    throw new TypeError('turn_started_at must not be after turn_ended_at.')
  }
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

export function registerDispatchWorkTool(mcpServer: McpServer): void {
  const register = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void
  register(
    'list_agent_chats',
    {
      description:
        'List up to six compact resident Pi chats once. Omit query for inventory or status questions; otherwise use concrete subject terms. Lifecycle state and resumability are separate. This does not report which chat cards are visible or placed on the current Board. No transcripts or tool output. Read-only.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(MAX_CHAT_LIMIT).optional(),
        query: z
          .string()
          .trim()
          .max(240)
          .describe('Omit for inventory/status; otherwise use concrete task or object terms')
          .optional()
      })
    },
    async (args: { limit?: number; query?: string }) => {
      try {
        return await listAgentChats(args)
      } catch (error) {
        return fail(error)
      }
    }
  )
  register(
    'get_agent_chat_context',
    {
      description:
        'Read one bounded resident Pi chat preview only when two list_agent_chats candidates remain genuinely plausible. Returns at most six human-facing messages and no tool calls, tool output, reasoning, attachments, or session data. Read-only.',
      inputSchema: z.object({
        thread_id: z.string().trim().min(1).describe('Exact thread ID from list_agent_chats')
      })
    },
    async (args: { thread_id: string }) => {
      try {
        return await getAgentChatContext(args)
      } catch (error) {
        return fail(error)
      }
    }
  )
  register(
    'dispatch_work',
    {
      description:
        'Send exactly what the user said to a new, continued, or forked Board worker chat. List candidate chats first when prior context may matter. Continuing a running chat steers its active turn. Returns assignment, not completion.',
      inputSchema: z.object({
        action: z
          .enum(['continue', 'fork', 'new'])
          .describe('Continue a relevant chat, fork useful context, or start new')
          .optional(),
        continue_thread_id: z
          .string()
          .trim()
          .min(1)
          .describe('Deprecated continuation alias; prefer target_thread_id with action')
          .optional(),
        done: z.string().trim().min(1).describe('One sentence describing the finished result'),
        exact_words: z.string().trim().min(1).describe('What the user said, verbatim'),
        target_thread_id: z
          .string()
          .trim()
          .min(1)
          .describe('Exact candidate thread ID for continue or fork')
          .optional(),
        turn_ended_at: isoTimestamp.describe('End of the spoken turn'),
        turn_started_at: isoTimestamp.describe('Start of the spoken turn')
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
