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

export type AgentExtensionUiRequest = {
  id: string
  message?: string
  method: 'confirm' | 'select'
  options?: string[]
  requestedAt: string
  title: string
}

export type AgentExtensionUiResponse = {
  cancelled?: boolean
  confirmed?: boolean
  value?: string
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
  pendingUiRequests: AgentExtensionUiRequest[]
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
  pendingUiRequests?: AgentExtensionUiRequest[]
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

export async function respondToAgentUiRequest(
  threadId: string,
  requestId: string,
  decision: AgentExtensionUiResponse
): Promise<void> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/conversations/${encodeURIComponent(threadId)}/ui/${encodeURIComponent(requestId)}/respond`,
    {
      body: JSON.stringify(decision),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    }
  )
  if (!response.ok) {
    throw await agentRouterResponseError(response, 'The approval response was rejected')
  }
}

async function agentRouterResponseError(response: Response, fallback: string): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null
  return new Error(typeof payload?.error === 'string' ? payload.error : fallback)
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

export type AgentPromptAttachment = {
  name: string
  path: string
  size?: number
  type?: string
  visual?: {
    durationSeconds?: number
    frameCount?: number
    imagePaths: string[]
    intervalSeconds?: number
    kind: 'image' | 'video-frames'
    summary: string
  }
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
  const prefix = message.trim() ? `${message}\n\n` : ''
  const files = `${prefix}Attached files:\n${attachments
    .map((file) => `- ${JSON.stringify(file.name)}: ${file.path}`)
    .join('\n')}`
  const visualNotes = attachments
    .filter((file) => file.visual)
    .map((file) => `- ${JSON.stringify(file.name)}: ${file.visual?.summary ?? ''}`)
  if (!visualNotes.length) return files
  const hasVideo = attachments.some((file) => file.visual?.kind === 'video-frames')
  const videoCaveat = hasVideo
    ? '\nVideo filmstrips are an overview, not frame-exact proof. Use the original video for denser or timestamp-specific inspection; audio is not represented in the filmstrip.'
    : ''
  return `${files}\n\nVisual review inputs:\n${visualNotes.join('\n')}${videoCaveat}`
}

export function attachmentImagePaths(attachments: AgentPromptAttachment[]): string[] {
  return [...new Set(attachments.flatMap((attachment) => attachment.visual?.imagePaths ?? []))]
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
    pendingUiRequests: thread.pendingUiRequests?.map((request) => ({ ...request })) ?? [],
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
