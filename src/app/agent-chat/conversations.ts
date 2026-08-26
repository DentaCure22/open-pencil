import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

import type { AgentExtensionUiRequest } from './approval'
import type { AgentPromptAttachment } from './attachment-transfer'
import { boardWorkerLaunchFields } from './board-worker'
import type { AgentModelSelection } from './models'
import { boundLoadedTranscript } from './replay-buffer'
import { agentRouterResponseError } from './router-response'
import type { AiMessage } from './types'

export type AgentConversationState = 'completed' | 'needs_attention' | 'running' | 'stopped'

export type AgentConversationContextUsage = {
  autoCompactionEnabled: boolean
  cacheHitPercent?: number
  compacting: boolean
  compactionStalled?: boolean
  contextWindow: number
  lastCompactedAt?: string
  percent: number | null
  tokens: number | null
  tokensEstimated?: boolean
  tokensPerSecond?: number
  tokensPerSecondBasis?: 'streamed-output'
  tokensPerSecondEstimated?: boolean
}

export type AgentTodoDraft = {
  brief: {
    acceptance?: string[]
    constraints?: string[]
    context?: string
    desiredOutcome?: string
    goal: string
    knownFacts?: string[]
    openQuestions?: string[]
    references?: Array<{
      id: string
      kind: 'board_object' | 'chat' | 'file' | 'image' | 'trace_evidence' | 'url'
      label: string
      note?: string
    }>
    suggestedNextStep?: string
  }
  createdByThreadId?: string
  kind: 'todo'
  projectId: string
  todoId: string
}

export type AgentConversationThread = {
  activeTurnStartedAt?: string
  canFollowUp: boolean
  contextUsage?: AgentConversationContextUsage
  createdAt: string
  effort: string
  forkedFromId?: string
  hasNewer?: boolean
  hasOlder?: boolean
  id: string
  lastUserMessageAt?: string
  messageTotal?: number
  messages: AiMessage[]
  model: string
  nativeThreadId: string
  newerAfter?: string | null
  olderBefore?: string | null
  pendingUiRequests: AgentExtensionUiRequest[]
  recentUpdate: string
  state: AgentConversationState
  task: string
  title?: string
  todoDraft?: AgentTodoDraft
  turns?: AgentConversationTurn[]
  updatedAt: string
}

export type AgentConversationHistory = {
  threads: AgentConversationThread[]
}

export type AgentConversationTurn = {
  id: string
  prompt: string
  response: string
}

export type RemoteAgentConversation = {
  activeTurnStartedAt?: string
  canFollowUp: boolean
  contextUsage?: AgentConversationContextUsage
  createdAt: string
  effort: string
  forkedFromId?: string
  hasNewer?: boolean
  hasOlder?: boolean
  id: string
  lastUserMessageAt?: string
  messageTotal?: number
  messages: AiMessage[]
  model: string
  newerAfter?: string | null
  olderBefore?: string | null
  pendingUiRequests?: AgentExtensionUiRequest[]
  recentUpdate: string
  state: 'completed' | 'needs_attention' | 'running' | 'stopped'
  task: string
  title?: string
  todoDraft?: AgentTodoDraft
  turns?: AgentConversationTurn[]
  updatedAt: string
}

type AgentDispatchReceipt = {
  jobId: string
  threadId: string
}

type AgentJob = {
  response: string
  state: 'completed' | 'failed' | 'queued' | 'running' | 'stopped'
}

export async function dispatchAgentPrompt(
  message: string,
  selection: AgentModelSelection,
  media: AgentPromptMedia = {}
): Promise<AgentDispatchReceipt> {
  const response = await localWorkspaceAuthorityFetch('/agent-router/v1/pi/dispatch', {
    body: JSON.stringify({
      attachmentImagePaths: media.imagePaths,
      attachments: media.attachments,
      displayPrompt: media.displayPrompt,
      effort: selection.effort,
      model: selection.model,
      ...boardWorkerLaunchFields(message)
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const detail =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Pi prompt was rejected'
    throw new Error(detail)
  }
  return (await response.json()) as AgentDispatchReceipt
}

export async function waitForAgentJob(
  jobId: string,
  timeoutMs = 10 * 60 * 1_000
): Promise<AgentJob> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await localWorkspaceAuthorityFetch(
      `/agent-router/v1/pi/jobs/${encodeURIComponent(jobId)}`
    )
    if (!response.ok) throw new Error('Pi job status is unavailable')
    const job = (await response.json()) as AgentJob
    if (job.state !== 'queued' && job.state !== 'running') return job
    await new Promise((resolve) => {
      setTimeout(resolve, 750)
    })
  }
  throw new Error('Pi did not finish within 10 minutes')
}

export async function stopAgentThread(threadId: string): Promise<void> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}/stop`,
    { method: 'POST' }
  )
  if (!response.ok) throw new Error('The active Pi task could not be stopped')
}

export async function ensureAgentConversationTitle(threadId: string): Promise<void> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}/title`,
    { method: 'POST' }
  )
  if (!response.ok) throw new Error('The conversation title could not be generated')
}

async function sendAgentConversationMessage(
  threadId: string,
  message: string,
  selection: AgentModelSelection,
  action: 'follow-up' | 'steer',
  media: AgentPromptMedia = {}
): Promise<AgentDispatchReceipt> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}/${action}`,
    {
      body: JSON.stringify({
        attachmentImagePaths: media.imagePaths,
        attachments: media.attachments,
        displayPrompt: media.displayPrompt,
        effort: selection.effort,
        message,
        model: selection.model
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    }
  )
  if (!response.ok) {
    const fallback = action === 'steer' ? 'Pi steering was rejected' : 'Pi follow-up was rejected'
    throw await agentRouterResponseError(response, fallback)
  }
  return (await response.json()) as AgentDispatchReceipt
}

export async function forkAgentConversation(
  threadId: string,
  message: string,
  selection: AgentModelSelection,
  media: AgentPromptMedia = {},
  historyScope: 'effectiveContext' | 'full' = 'effectiveContext'
): Promise<AgentDispatchReceipt> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}/fork`,
    {
      body: JSON.stringify({
        attachmentImagePaths: media.imagePaths,
        attachments: media.attachments,
        displayPrompt: media.displayPrompt ?? message,
        effort: selection.effort,
        historyScope,
        model: selection.model,
        ...boardWorkerLaunchFields(message)
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    }
  )
  if (!response.ok) {
    throw await agentRouterResponseError(
      response,
      historyScope === 'full' ? 'Fork was rejected' : 'Compact-fork was rejected'
    )
  }
  return (await response.json()) as AgentDispatchReceipt
}

export function followUpAgentConversation(
  threadId: string,
  message: string,
  selection: AgentModelSelection,
  media: AgentPromptMedia = {}
): Promise<AgentDispatchReceipt> {
  return sendAgentConversationMessage(threadId, message, selection, 'follow-up', media)
}

export function steerAgentConversation(
  threadId: string,
  message: string,
  selection: AgentModelSelection,
  media: AgentPromptMedia = {}
): Promise<AgentDispatchReceipt> {
  return sendAgentConversationMessage(threadId, message, selection, 'steer', media)
}

type AgentPromptMedia = {
  attachments?: AgentPromptAttachment[]
  displayPrompt?: string
  imagePaths?: string[]
}

export function agentConversationMessageId(threadId: string, messageId: string): string {
  const prefix = `agent:${threadId}:`
  return messageId.startsWith(prefix) ? messageId : `${prefix}${messageId}`
}

export function nativeAgentConversationMessageId(threadId: string, messageId: string): string {
  const prefix = `agent:${threadId}:`
  return messageId.startsWith(prefix) ? messageId.slice(prefix.length) : messageId
}

export function agentConversationMessages(thread: RemoteAgentConversation): AiMessage[] {
  return thread.messages.map((message) => ({
    ...message,
    id: agentConversationMessageId(thread.id, message.id)
  }))
}

function agentConversationTurns(
  threadId: string,
  turns: AgentConversationTurn[] | undefined
): AgentConversationTurn[] | undefined {
  if (!turns?.length) return undefined
  return turns.map((turn) => ({
    ...turn,
    id: agentConversationMessageId(threadId, turn.id)
  }))
}

export function mapRemoteAgentConversation(thread: RemoteAgentConversation): Omit<
  AgentConversationThread,
  'id' | 'nativeThreadId'
> & {
  messages: AiMessage[]
} {
  return {
    ...(thread.activeTurnStartedAt ? { activeTurnStartedAt: thread.activeTurnStartedAt } : {}),
    canFollowUp: thread.canFollowUp,
    ...(thread.contextUsage ? { contextUsage: thread.contextUsage } : {}),
    createdAt: thread.createdAt,
    effort: thread.effort,
    ...(thread.forkedFromId ? { forkedFromId: thread.forkedFromId } : {}),
    ...(thread.hasNewer === undefined ? {} : { hasNewer: thread.hasNewer }),
    ...(thread.hasOlder === undefined ? {} : { hasOlder: thread.hasOlder }),
    lastUserMessageAt: remoteLastUserMessageAt(thread),
    ...(thread.messageTotal === undefined ? {} : { messageTotal: thread.messageTotal }),
    messages: boundLoadedTranscript(agentConversationMessages(thread)),
    model: thread.model,
    ...(thread.newerAfter === undefined
      ? {}
      : {
          newerAfter: thread.newerAfter
            ? agentConversationMessageId(thread.id, thread.newerAfter)
            : null
        }),
    ...(thread.olderBefore === undefined
      ? {}
      : {
          olderBefore: thread.olderBefore
            ? agentConversationMessageId(thread.id, thread.olderBefore)
            : null
        }),
    pendingUiRequests: thread.pendingUiRequests?.map((request) => ({ ...request })) ?? [],
    recentUpdate: thread.recentUpdate,
    state: thread.state,
    task: thread.task,
    ...(thread.title ? { title: thread.title } : {}),
    ...(thread.todoDraft ? { todoDraft: structuredClone(thread.todoDraft) } : {}),
    ...(agentConversationTurns(thread.id, thread.turns)
      ? { turns: agentConversationTurns(thread.id, thread.turns) }
      : {}),
    updatedAt: thread.updatedAt
  }
}

function remoteLastUserMessageAt(thread: RemoteAgentConversation): string {
  return (
    thread.lastUserMessageAt ??
    thread.messages.findLast((message) => message.role === 'user')?.createdAt ??
    thread.createdAt
  )
}

export function agentConversationHistory(
  remoteThreads: RemoteAgentConversation[]
): AgentConversationHistory {
  const sorted = [...remoteThreads].sort((left, right) => {
    const byUser = remoteLastUserMessageAt(right).localeCompare(remoteLastUserMessageAt(left))
    return byUser || right.updatedAt.localeCompare(left.updatedAt)
  })
  const threads: AgentConversationThread[] = sorted.map((thread) => ({
    ...mapRemoteAgentConversation(thread),
    id: `agent:${thread.id}`,
    nativeThreadId: thread.id
  }))
  return { threads }
}

export async function listAgentConversations(options?: {
  preview?: boolean
}): Promise<AgentConversationHistory> {
  const preview = options?.preview === true
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations${preview ? '?preview=1' : ''}`
  )
  if (!response.ok) throw new Error('Pi conversations unavailable')
  const payload = (await response.json()) as { threads?: RemoteAgentConversation[] }
  return agentConversationHistory(payload.threads ?? [])
}

export async function getAgentConversation(threadId: string): Promise<RemoteAgentConversation> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}`
  )
  if (!response.ok) throw new Error('Pi conversation unavailable')
  return (await response.json()) as RemoteAgentConversation
}

export type AgentConversationPageQuery = {
  after?: string
  before?: string
}

function conversationPageSearch(query: AgentConversationPageQuery = {}): string {
  const params = new URLSearchParams()
  if (query.after) params.set('after', query.after)
  if (query.before) params.set('before', query.before)
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export async function getAgentConversationPage(
  threadId: string,
  query: AgentConversationPageQuery = {}
): Promise<RemoteAgentConversation> {
  const search = conversationPageSearch(query)
  const response = await localWorkspaceAuthorityFetch(
    search
      ? `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}/messages${search}`
      : `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}?page=1`
  )
  if (!response.ok) throw new Error('Pi conversation unavailable')
  return (await response.json()) as RemoteAgentConversation
}
