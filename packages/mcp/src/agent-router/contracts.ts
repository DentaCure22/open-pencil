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

export type AgentConversationFileChange = {
  additions: number
  deletions: number
  patch?: string
  path: string
  previousPath?: string
  status: 'added' | 'copied' | 'deleted' | 'modified' | 'renamed'
}

export type AgentConversationTurnChanges = {
  additions: number
  capturedAt: string
  deletions: number
  files: AgentConversationFileChange[]
  truncated?: boolean
}

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
  changes?: AgentConversationTurnChanges
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

export type AgentTodoBriefReference = {
  id: string
  kind: 'board_object' | 'chat' | 'file' | 'image' | 'trace_evidence' | 'url'
  label: string
  note?: string
}

export type AgentTodoBrief = {
  acceptance?: string[]
  constraints?: string[]
  context?: string
  desiredOutcome?: string
  goal: string
  knownFacts?: string[]
  openQuestions?: string[]
  references?: AgentTodoBriefReference[]
  suggestedNextStep?: string
}

export type AgentTodoDraft = {
  brief: AgentTodoBrief
  createdByThreadId?: string
  kind: 'todo'
  projectId: string
  todoId: string
}

const AGENT_CONVERSATION_PREVIEW_LIMIT = 3

export type AgentConversationThread = {
  activeTurnStartedAt?: string
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
  title?: string
  todoDraft?: AgentTodoDraft
  toolScope?: AgentToolScope
  updatedAt: string
  workerId: string
}

export type AgentTodoDraftRequest = {
  brief: AgentTodoBrief
  createdByThreadId?: string
  effort?: string
  model?: string
  projectId: string
  threadId?: string
  title: string
  todoId: string
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
  createTodoDraft(request: AgentTodoDraftRequest): AgentConversationThread
  delete(threadId: string): boolean
  dispatch(request: AgentDispatchRequest): Promise<AgentDispatchReceipt>
  ensureTitle(threadId: string): boolean
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

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isTodoBriefReference(value: unknown): value is AgentTodoBriefReference {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    ['board_object', 'chat', 'file', 'image', 'trace_evidence', 'url'].includes(
      String(value.kind)
    ) &&
    typeof value.label === 'string' &&
    isOptionalString(value.note)
  )
}

function isTodoBrief(value: unknown): value is AgentTodoBrief {
  if (!isRecord(value) || typeof value.goal !== 'string') return false
  return (
    (value.acceptance === undefined || isStringArray(value.acceptance)) &&
    (value.constraints === undefined || isStringArray(value.constraints)) &&
    isOptionalString(value.context) &&
    isOptionalString(value.desiredOutcome) &&
    (value.knownFacts === undefined || isStringArray(value.knownFacts)) &&
    (value.openQuestions === undefined || isStringArray(value.openQuestions)) &&
    (value.references === undefined ||
      (Array.isArray(value.references) && value.references.every(isTodoBriefReference))) &&
    isOptionalString(value.suggestedNextStep)
  )
}

function isTodoDraft(value: unknown): value is AgentTodoDraft {
  return (
    isRecord(value) &&
    isTodoBrief(value.brief) &&
    isOptionalString(value.createdByThreadId) &&
    value.kind === 'todo' &&
    typeof value.projectId === 'string' &&
    typeof value.todoId === 'string'
  )
}

function isConversationMedia(value: unknown): value is { alt?: string; url: string } {
  return isRecord(value) && typeof value.url === 'string' && isOptionalString(value.alt)
}

function isConversationVideo(
  value: unknown
): value is { mimeType?: string; name?: string; url: string } {
  return (
    isRecord(value) &&
    typeof value.url === 'string' &&
    isOptionalString(value.mimeType) &&
    isOptionalString(value.name)
  )
}

function isConversationToolState(value: unknown): value is AgentToolState {
  return (
    value === 'approval' ||
    value === 'error' ||
    value === 'pending' ||
    value === 'running' ||
    value === 'success'
  )
}

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isConversationFileChange(value: unknown): value is AgentConversationFileChange {
  if (!isRecord(value)) return false
  return (
    isNonNegativeInteger(value.additions) &&
    isNonNegativeInteger(value.deletions) &&
    typeof value.path === 'string' &&
    isOptionalString(value.previousPath) &&
    isOptionalString(value.patch) &&
    ['added', 'copied', 'deleted', 'modified', 'renamed'].includes(String(value.status))
  )
}

function isConversationTurnChanges(value: unknown): value is AgentConversationTurnChanges {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.additions) &&
    typeof value.capturedAt === 'string' &&
    isNonNegativeInteger(value.deletions) &&
    Array.isArray(value.files) &&
    value.files.every(isConversationFileChange) &&
    (value.truncated === undefined || typeof value.truncated === 'boolean')
  )
}

function isOptionalArray<T>(
  value: unknown,
  predicate: (candidate: unknown) => candidate is T
): boolean {
  return value === undefined || (Array.isArray(value) && value.every(predicate))
}

function isConversationPart(value: unknown): value is AgentConversationPart {
  if (!isRecord(value)) return false
  if (value.type === 'attachment') {
    return (
      typeof value.name === 'string' &&
      isOptionalString(value.mediaType) &&
      (value.size === undefined || typeof value.size === 'number')
    )
  }
  if (value.type === 'image') return isConversationMedia(value)
  if (value.type === 'commentary' || value.type === 'reasoning') {
    return (
      typeof value.text === 'string' &&
      (value.state === undefined || value.state === 'complete' || value.state === 'streaming')
    )
  }
  return (
    value.type === 'tool' &&
    typeof value.name === 'string' &&
    isConversationToolState(value.state) &&
    isOptionalString(value.error) &&
    isOptionalString(value.input) &&
    isOptionalString(value.output) &&
    isOptionalArray(value.images, isConversationMedia) &&
    isOptionalArray(value.videos, isConversationVideo)
  )
}

function isConversationMessage(value: unknown): value is AgentConversationMessage {
  return (
    isRecord(value) &&
    (value.changes === undefined || isConversationTurnChanges(value.changes)) &&
    isOptionalString(value.completedAt) &&
    typeof value.createdAt === 'string' &&
    typeof value.id === 'string' &&
    (value.role === 'assistant' || value.role === 'user') &&
    typeof value.text === 'string' &&
    (value.parts === undefined ||
      (Array.isArray(value.parts) && value.parts.every(isConversationPart)))
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

function hasRequiredConversationFields(value: Record<string, unknown>): boolean {
  return (
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

function hasValidConversationOptions(value: Record<string, unknown>): boolean {
  return (
    isOptionalString(value.activeTurnStartedAt) &&
    (value.lastPiEntryId === undefined || typeof value.lastPiEntryId === 'string') &&
    (value.toolScope === undefined ||
      value.toolScope === 'board-worker' ||
      value.toolScope === 'general') &&
    (value.compactForkPending === undefined || typeof value.compactForkPending === 'boolean') &&
    (value.forkedFromId === undefined || typeof value.forkedFromId === 'string') &&
    (value.piHistoryInitialized === undefined || typeof value.piHistoryInitialized === 'boolean') &&
    isOptionalString(value.title) &&
    (value.todoDraft === undefined || isTodoDraft(value.todoDraft))
  )
}

export function isConversationThread(value: unknown): value is AgentConversationThread {
  return (
    isRecord(value) && hasRequiredConversationFields(value) && hasValidConversationOptions(value)
  )
}

export function previewAgentConversation(
  thread: AgentConversationThread,
  messageLimit = AGENT_CONVERSATION_PREVIEW_LIMIT
): AgentConversationThread {
  return {
    ...(thread.activeTurnStartedAt ? { activeTurnStartedAt: thread.activeTurnStartedAt } : {}),
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
    ...(thread.title ? { title: thread.title } : {}),
    ...(thread.todoDraft ? { todoDraft: structuredClone(thread.todoDraft) } : {}),
    ...(thread.toolScope ? { toolScope: thread.toolScope } : {}),
    updatedAt: thread.updatedAt,
    workerId: thread.workerId
  }
}
