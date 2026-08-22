import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

import type { AgentModelSelection } from './models'
import type { AiMessage } from './types'

export type AgentConversationState = 'completed' | 'needs_attention' | 'running' | 'stopped'

export type AgentConversationContextUsage = {
  autoCompactionEnabled: boolean
  cacheHitPercent?: number
  compacting: boolean
  contextWindow: number
  lastCompactedAt?: string
  percent: number | null
  tokens: number | null
  tokensEstimated?: boolean
  tokensPerSecond?: number
  tokensPerSecondBasis?: 'streamed-output'
  tokensPerSecondEstimated?: boolean
}

export type AgentConversationThread = {
  canFollowUp: boolean
  contextUsage?: AgentConversationContextUsage
  createdAt: string
  effort: string
  id: string
  messages: AiMessage[]
  model: string
  nativeThreadId: string
  recentUpdate: string
  state: AgentConversationState
  task: string
  updatedAt: string
}

export type AgentConversationHistory = {
  threads: AgentConversationThread[]
}

export type RemoteAgentConversation = {
  canFollowUp: boolean
  contextUsage?: AgentConversationContextUsage
  createdAt: string
  effort: string
  id: string
  messages: AiMessage[]
  model: string
  recentUpdate: string
  state: 'completed' | 'needs_attention' | 'running' | 'stopped'
  task: string
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
  selection: AgentModelSelection
): Promise<AgentDispatchReceipt> {
  const response = await localWorkspaceAuthorityFetch('/agent-router/v1/pi/dispatch', {
    body: JSON.stringify({
      effort: selection.effort,
      model: selection.model,
      prompt: message
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

async function sendAgentConversationMessage(
  threadId: string,
  message: string,
  selection: AgentModelSelection,
  action: 'follow-up' | 'steer'
): Promise<AgentDispatchReceipt> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}/${action}`,
    {
      body: JSON.stringify({
        effort: selection.effort,
        message,
        model: selection.model
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    }
  )
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null
    const fallback = action === 'steer' ? 'Pi steering was rejected' : 'Pi follow-up was rejected'
    throw new Error(typeof payload?.error === 'string' ? payload.error : fallback)
  }
  return (await response.json()) as AgentDispatchReceipt
}

export function followUpAgentConversation(
  threadId: string,
  message: string,
  selection: AgentModelSelection
): Promise<AgentDispatchReceipt> {
  return sendAgentConversationMessage(threadId, message, selection, 'follow-up')
}

export function steerAgentConversation(
  threadId: string,
  message: string,
  selection: AgentModelSelection
): Promise<AgentDispatchReceipt> {
  return sendAgentConversationMessage(threadId, message, selection, 'steer')
}

type AgentPromptAttachment = {
  name: string
  path: string
}

export async function uploadAgentAttachments(files: File[]): Promise<AgentPromptAttachment[]> {
  if (!files.length) return []
  const body = new FormData()
  for (const file of files) body.append('files', file)
  const response = await localWorkspaceAuthorityFetch('/agent-router/v1/attachments', {
    body,
    method: 'POST'
  })
  const payload = (await response.json().catch(() => null)) as {
    attachments?: AgentPromptAttachment[]
    error?: string
  } | null
  if (!response.ok || !payload?.attachments) {
    throw new Error(payload?.error || 'Attachments could not be uploaded')
  }
  return payload.attachments
}

export function promptWithAttachments(message: string, attachments: AgentPromptAttachment[]) {
  if (!attachments.length) return message
  return `${message}\n\nAttached files:\n${attachments.map((file) => `- ${file.name}: ${file.path}`).join('\n')}`
}

export function agentConversationMessages(thread: RemoteAgentConversation): AiMessage[] {
  return thread.messages.map((message) => ({
    ...message,
    id: `agent:${thread.id}:${message.id}`
  }))
}

export function agentConversationHistory(
  remoteThreads: RemoteAgentConversation[]
): AgentConversationHistory {
  const sorted = [...remoteThreads].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )
  const threads: AgentConversationThread[] = sorted.map((thread) => ({
    canFollowUp: thread.canFollowUp,
    ...(thread.contextUsage ? { contextUsage: thread.contextUsage } : {}),
    createdAt: thread.createdAt,
    effort: thread.effort,
    id: `agent:${thread.id}`,
    messages: agentConversationMessages(thread),
    model: thread.model,
    nativeThreadId: thread.id,
    recentUpdate: thread.recentUpdate,
    state: thread.state,
    task: thread.task,
    updatedAt: thread.updatedAt
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
