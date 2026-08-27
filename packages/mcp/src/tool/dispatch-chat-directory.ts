import { isLocalAgentChatContinuation } from '#mcp/pi/local-continuation'

export const DEFAULT_CHAT_LIMIT = 6
export const MAX_CHAT_LIMIT = 24
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

export type AgentChatCandidate = {
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

export type AgentChatContext = Omit<AgentChatCandidate, 'isCurrent'> & {
  latestResult: string
  originTask: string
  references: string[]
  recentMessages: Array<{ role: 'assistant' | 'user'; text: string }>
}

export type AgentChatSearchRecord = {
  candidate: AgentChatCandidate
  latestResult: string
  latestUser: string
  originTask: string
  references: string[]
  recentMessages: AgentChatContext['recentMessages']
}

export type AgentChatPayload = {
  threads?: unknown
}

export type AgentChatList = {
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

export function chatSearchRecord(
  value: unknown,
  currentThreadId = ''
): AgentChatSearchRecord | null {
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

export function concreteSearchTerms(value: string): string[] {
  return searchTerms(value).filter((term) => !CHAT_QUERY_NOISE.has(term))
}

export function queryScore(record: AgentChatSearchRecord, query: string): number {
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
