import { readFileSync } from 'node:fs'

import type { AgentModelDefinition } from '#mcp/agent-models/catalog'
import type { AgentJobRecord } from '#mcp/agent-router/jobs'

type AgentConversationState = 'completed' | 'needs_attention' | 'running' | 'stopped'
type AgentToolState = 'approval' | 'error' | 'pending' | 'running' | 'success'

type AgentConversationPart =
  | { state?: 'complete' | 'streaming'; text: string; type: 'reasoning' }
  | { alt?: string; type: 'image'; url: string }
  | {
      error?: string
      images?: Array<{ alt?: string; url: string }>
      input?: string
      name: string
      output?: string
      state: AgentToolState
      type: 'tool'
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
  createdAt: string
  effort: string
  id: string
  messages: AgentConversationMessage[]
  model: string
  recentUpdate: string
  sessionId: string | null
  state: AgentConversationState
  task: string
  updatedAt: string
  workerId: string
}

export type AgentDispatchRequest = {
  displayPrompt?: string
  effort?: string
  evidencePath?: string
  model?: string
  prompt: string
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
      displayPrompt?: string
      effort?: string
      evidencePath?: string
      model?: string
    }
  ): Promise<AgentDispatchReceipt>
  fork(threadId: string, request: AgentDispatchRequest): Promise<AgentDispatchReceipt>
  job(jobId: string): AgentJobRecord | null
  models(): AgentModelDefinition[]
  providerUsage(provider: string): Promise<AgentProviderUsage | null>
  resetWorkers(): { deleted: number }
  status(): Promise<{ active: number; available: boolean; workspaceRoot: string }>
  steer(
    threadId: string,
    prompt: string,
    selection?: {
      displayPrompt?: string
      effort?: string
      evidencePath?: string
      model?: string
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

function isConversationThread(value: unknown): value is AgentConversationThread {
  return (
    isRecord(value) &&
    typeof value.canFollowUp === 'boolean' &&
    typeof value.createdAt === 'string' &&
    typeof value.effort === 'string' &&
    typeof value.id === 'string' &&
    Array.isArray(value.messages) &&
    value.messages.every(isConversationMessage) &&
    typeof value.model === 'string' &&
    typeof value.recentUpdate === 'string' &&
    (value.sessionId === null || typeof value.sessionId === 'string') &&
    isConversationState(value.state) &&
    typeof value.task === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof value.workerId === 'string'
  )
}

export function previewAgentConversation(thread: AgentConversationThread): AgentConversationThread {
  return {
    canFollowUp: thread.canFollowUp,
    ...(thread.contextUsage ? { contextUsage: thread.contextUsage } : {}),
    createdAt: thread.createdAt,
    effort: thread.effort,
    id: thread.id,
    messages: thread.messages
      .filter((message) => message.text.trim())
      .slice(-AGENT_CONVERSATION_PREVIEW_LIMIT)
      .map((message) => ({
        ...(message.completedAt ? { completedAt: message.completedAt } : {}),
        createdAt: message.createdAt,
        id: message.id,
        role: message.role,
        text: message.text
      })),
    model: thread.model,
    recentUpdate: thread.recentUpdate,
    sessionId: thread.sessionId,
    state: thread.state,
    task: thread.task,
    updatedAt: thread.updatedAt,
    workerId: thread.workerId
  }
}

export function readAgentConversationHistory(historyPath?: string): AgentConversationThread[] {
  if (!historyPath) return []
  try {
    const value: unknown = JSON.parse(readFileSync(historyPath, 'utf8'))
    return Array.isArray(value) ? value.filter(isConversationThread) : []
  } catch {
    return []
  }
}
