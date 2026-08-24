import type { AgentModelDefinition } from '#mcp/agent-models/catalog'
import type { AgentJobRecord } from '#mcp/agent-router/jobs'

type AgentConversationState = 'completed' | 'needs_attention' | 'running' | 'stopped'
type AgentToolState = 'approval' | 'error' | 'pending' | 'running' | 'success'
export type AgentToolScope = 'board-worker' | 'general'

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

export type AgentConversationAttachmentPart =
  | { mediaType?: string; name: string; size?: number; type: 'attachment' }
  | { alt?: string; type: 'image'; url: string }

type AgentConversationPart =
  | AgentConversationAttachmentPart
  | { state?: 'complete' | 'streaming'; text: string; type: 'commentary' }
  | { state?: 'complete' | 'streaming'; text: string; type: 'reasoning' }
  | {
      error?: string
      images?: Array<{ alt?: string; url: string }>
      input?: string
      name: string
      output?: string
      state: AgentToolState
      type: 'tool'
      videos?: Array<{ mimeType?: string; name?: string; url: string }>
    }

export type AgentConversationMessage = {
  completedAt?: string
  createdAt: string
  id: string
  parts?: AgentConversationPart[]
  role: 'assistant' | 'user'
  text: string
}

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

const AGENT_CONVERSATION_PREVIEW_LIMIT = 3

export type AgentConversationThread = {
  canFollowUp: boolean
  contextUsage?: AgentConversationContextUsage
  compactForkPending?: boolean
  createdAt: string
  effort: string
  forkedFromId?: string
  id: string
  lastPiEntryId?: string
  lastUserMessageAt?: string
  messages: AgentConversationMessage[]
  model: string
  pendingUiRequests?: AgentExtensionUiRequest[]
  piHistoryInitialized?: boolean
  recentUpdate: string
  sessionId: string | null
  state: AgentConversationState
  task: string
  toolScope?: AgentToolScope
  updatedAt: string
  workerId: string
}

export type AgentDispatchRequest = {
  attachments?: AgentConversationAttachmentPart[]
  displayPrompt?: string
  effort?: string
  evidencePath?: string
  historyScope?: 'effectiveContext' | 'full'
  imagePaths?: string[]
  model?: string
  prompt: string
  toolScope?: AgentToolScope
}

export type AgentDispatchReceipt = {
  dispatchedAt: string
  jobId: string
  state: 'queued' | 'running'
  threadId: string
}

export type AgentProviderUsage = {
  provider: string
  queriedAt: string
  remainingPercent: number
  resetAt?: string
  subscription?: string
  usedPercent: number
}

export interface AgentConversationRouter {
  close(): void
  conversation(threadId: string): AgentConversationThread | null
  conversationPreviews(): AgentConversationThread[]
  conversations(): AgentConversationThread[]
  delete(threadId: string): boolean
  dispatch(request: AgentDispatchRequest): Promise<AgentDispatchReceipt>
  followUp(
    threadId: string,
    prompt: string,
    selection?: {
      attachments?: AgentConversationAttachmentPart[]
      displayPrompt?: string
      effort?: string
      evidencePath?: string
      imagePaths?: string[]
      model?: string
      toolScope?: AgentToolScope
    }
  ): Promise<AgentDispatchReceipt>
  fork(threadId: string, request: AgentDispatchRequest): Promise<AgentDispatchReceipt>
  job(jobId: string): AgentJobRecord | null
  models(): AgentModelDefinition[]
  providerUsage(provider: string): Promise<AgentProviderUsage | null>
  resetWorkers(): { deleted: number }
  respondToUiRequest(
    threadId: string,
    requestId: string,
    response: AgentExtensionUiResponse
  ): boolean
  status(): Promise<{ active: number; available: boolean; workspaceRoot: string }>
  steer(
    threadId: string,
    prompt: string,
    selection?: {
      attachments?: AgentConversationAttachmentPart[]
      displayPrompt?: string
      effort?: string
      evidencePath?: string
      imagePaths?: string[]
      model?: string
      toolScope?: AgentToolScope
    }
  ): Promise<AgentDispatchReceipt>
  stop(threadId: string): boolean
  waitForJob(jobId: string, timeoutMs?: number): Promise<AgentJobRecord | null>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isConversationState(value: unknown): value is AgentConversationState {
  return (
    value === 'completed' ||
    value === 'needs_attention' ||
    value === 'running' ||
    value === 'stopped'
  )
}

function isConversationMessage(value: unknown): value is AgentConversationMessage {
  return (
    isRecord(value) &&
    typeof value.createdAt === 'string' &&
    typeof value.id === 'string' &&
    (value.role === 'assistant' || value.role === 'user') &&
    typeof value.text === 'string' &&
    (value.parts === undefined || Array.isArray(value.parts))
  )
}

export function agentConversationLastUserMessageAt(
  thread: Pick<AgentConversationThread, 'createdAt' | 'messages'>
): string {
  return (
    thread.messages.findLast((message) => message.role === 'user')?.createdAt ?? thread.createdAt
  )
}

export function compareAgentConversationsByLastUserMessage(
  left: Pick<AgentConversationThread, 'createdAt' | 'messages' | 'updatedAt'> & {
    lastUserMessageAt?: string
  },
  right: Pick<AgentConversationThread, 'createdAt' | 'messages' | 'updatedAt'> & {
    lastUserMessageAt?: string
  }
): number {
  const leftAt = left.lastUserMessageAt ?? agentConversationLastUserMessageAt(left)
  const rightAt = right.lastUserMessageAt ?? agentConversationLastUserMessageAt(right)
  return rightAt.localeCompare(leftAt) || right.updatedAt.localeCompare(left.updatedAt)
}

export function isConversationThread(value: unknown): value is AgentConversationThread {
  return (
    isRecord(value) &&
    typeof value.canFollowUp === 'boolean' &&
    typeof value.createdAt === 'string' &&
    typeof value.effort === 'string' &&
    typeof value.id === 'string' &&
    (value.lastPiEntryId === undefined || typeof value.lastPiEntryId === 'string') &&
    Array.isArray(value.messages) &&
    value.messages.every(isConversationMessage) &&
    typeof value.model === 'string' &&
    typeof value.recentUpdate === 'string' &&
    (value.sessionId === null || typeof value.sessionId === 'string') &&
    isConversationState(value.state) &&
    typeof value.task === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.workerId === 'string' &&
    (value.toolScope === undefined ||
      value.toolScope === 'board-worker' ||
      value.toolScope === 'general') &&
    (value.compactForkPending === undefined || typeof value.compactForkPending === 'boolean') &&
    (value.forkedFromId === undefined || typeof value.forkedFromId === 'string') &&
    (value.piHistoryInitialized === undefined || typeof value.piHistoryInitialized === 'boolean')
  )
}

export function previewAgentConversation(
  thread: AgentConversationThread,
  messageLimit = AGENT_CONVERSATION_PREVIEW_LIMIT
): AgentConversationThread {
  return {
    canFollowUp: thread.canFollowUp,
    ...(thread.contextUsage ? { contextUsage: thread.contextUsage } : {}),
    createdAt: thread.createdAt,
    effort: thread.effort,
    ...(thread.forkedFromId ? { forkedFromId: thread.forkedFromId } : {}),
    id: thread.id,
    lastUserMessageAt: agentConversationLastUserMessageAt(thread),
    messages: thread.messages
      .filter((message) => message.text.trim())
      .slice(-Math.max(1, Math.trunc(messageLimit)))
      .map((message) => ({
        ...(message.completedAt ? { completedAt: message.completedAt } : {}),
        createdAt: message.createdAt,
        id: message.id,
        role: message.role,
        text: message.text
      })),
    model: thread.model,
    ...(thread.pendingUiRequests?.length
      ? { pendingUiRequests: thread.pendingUiRequests.map((request) => ({ ...request })) }
      : {}),
    recentUpdate: thread.recentUpdate,
    sessionId: thread.sessionId,
    state: thread.state,
    task: thread.task,
    ...(thread.toolScope ? { toolScope: thread.toolScope } : {}),
    updatedAt: thread.updatedAt,
    workerId: thread.workerId
  }
}
