import { randomUUID } from 'node:crypto'

import {
  compareAgentConversationsByLastUserMessage,
  previewAgentConversation,
  type AgentExtensionUiRequest,
  type AgentConversationThread,
  type AgentDispatchRequest,
  type AgentTodoDraftRequest
} from '#mcp/agent-router/contracts'
import {
  readAgentConversationHistory,
  writeAgentConversationHistory
} from '#mcp/agent-router/conversation-history'
import { AgentJobTracker, type AgentJobRecord } from '#mcp/agent-router/jobs'

import { ConversationMediaStore } from './conversation-media'
import { piEventText, piToolOutputFailed } from './events'
import { recoverDurableMediaResults } from './media-recovery'
import {
  DefaultPiProviderRuntime,
  type PiProviderRuntime,
  type PiProviderTurnCursor
} from './providers'
import { closingTextFromAssistantMessage } from './providers/closing'
import { migrateProviderActivityHistory } from './reasoning-history'
import type { PiRpcProcess, PiRpcRecord } from './rpc-process'
import { compactAgentThreadMemory } from './thread-memory'
import type { TurnWorkspaceSnapshot } from './turn-changes'
import {
  parseUsageTokens,
  usageTokensAreZero,
  type UsageSource,
  type UsageTokens
} from './usage-ledger'

const RUNNING_HEARTBEAT_MS = 8_000
const MAX_STATUS_TEXT = 160

export type ValidatedPiRequest = AgentDispatchRequest & {
  effort: string
  model: string
  prompt: string
}

export type PiLaunch =
  | { forkedFromId: string; kind: 'fork'; sessionId: string }
  | { forkedFromId?: string; kind: 'new'; sessionId?: string }
  | { kind: 'resume'; sessionId: string }

export type PiSession = {
  aborting: 'stop' | null
  activeJobId: string | null
  configuredEffort: string
  configuredModel: string
  eventTurnKey: string | null
  finalResponse: string
  firstTokenAt: number | null
  generatedCharacters: number
  generationBaseTokens: number | null
  generationElapsedMs: number
  lastEventAt: number
  lastError: string
  lastProbeAt: number | null
  lastToolError: string
  lastTurnUsage: { source: UsageSource; tokens: UsageTokens } | null
  pendingUiRequests: Map<string, AgentExtensionUiRequest>
  providerTurnCursor: PiProviderTurnCursor | null
  probeInFlight: boolean
  process: PiRpcProcess
  recovering: boolean
  settling: boolean
  turnPromptMessageId: string | null
  turnWorkspaceSnapshot: TurnWorkspaceSnapshot | null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function safeStatusText(value: unknown): string {
  return piEventText(value)
    .replace(/(bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(
      /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[=:]\s*)[^\s,"']+/gi,
      '$1[redacted]'
    )
    .trim()
    .slice(0, MAX_STATUS_TEXT)
}

function latestUserMessage(thread: AgentConversationThread) {
  return [...thread.messages].reverse().find((message) => message.role === 'user')
}

export function completePendingUserMessages(
  thread: AgentConversationThread,
  completedAt: string
): void {
  for (const message of thread.messages) {
    if (message.role === 'user' && !message.completedAt) message.completedAt = completedAt
  }
}

function heartbeatOriginMs(thread: AgentConversationThread, now: number): number {
  const source =
    [...thread.messages].reverse().find((message) => message.role === 'assistant')?.createdAt ??
    latestUserMessage(thread)?.createdAt ??
    thread.updatedAt
  const parsed = Date.parse(source)
  return Number.isFinite(parsed) ? parsed : now
}

function refreshPiHeartbeat(thread: AgentConversationThread, now = Date.now()): boolean {
  if (thread.state !== 'running') return false
  const activity = thread.recentUpdate.replace(/ · \d+s$/, '')
  const seconds = Math.max(1, Math.round((now - heartbeatOriginMs(thread, now)) / 1_000))
  const placeholder = !activity || activity === 'Starting Pi.' || activity === 'Pi is running.'
  let next = `${activity} · ${String(seconds)}s`
  if (placeholder) next = seconds < 12 ? 'Pi is running.' : `Still working… ${String(seconds)}s`
  if (thread.recentUpdate === next) return false
  thread.recentUpdate = next
  thread.updatedAt = new Date(now).toISOString()
  return true
}

function assistantMessage(event: PiRpcRecord): Record<string, unknown> | null {
  return isRecord(event.message) && event.message.role === 'assistant' ? event.message : null
}

function hasToolCall(message: Record<string, unknown>): boolean {
  return Boolean(
    Array.isArray(message.content) &&
    message.content.some((part) => isRecord(part) && part.type === 'toolCall')
  )
}

function captureToolOutcome(session: PiSession, event: PiRpcRecord): void {
  if (event.type !== 'tool_execution_end') return
  const output = piEventText(event.result)
  if (event.isError !== true && !piToolOutputFailed(output)) return
  const toolName = typeof event.toolName === 'string' ? event.toolName : 'Tool'
  session.lastToolError = safeStatusText(output) || `${toolName} failed.`
}

function captureSessionError(session: PiSession, event: PiRpcRecord): void {
  if (event.type === 'extension_error') {
    session.lastError = safeStatusText(event.error) || 'A Pi extension failed.'
    return
  }
  if (event.type === 'auto_retry_end' && event.success === false) {
    session.lastError = safeStatusText(event.finalError) || 'Pi exhausted its retries.'
  }
}

function captureTurnUsage(session: PiSession, event: PiRpcRecord): void {
  if (event.type !== 'message_end') return
  const message = assistantMessage(event)
  if (!message || !isRecord(message.usage)) return
  const tokens = parseUsageTokens(message.usage)
  const previous = session.lastTurnUsage
  session.lastTurnUsage = {
    source:
      previous?.source === 'pi-event' || !usageTokensAreZero(tokens) ? 'pi-event' : 'estimated',
    tokens: previous
      ? {
          cacheRead: previous.tokens.cacheRead + tokens.cacheRead,
          cacheWrite: previous.tokens.cacheWrite + tokens.cacheWrite,
          input: previous.tokens.input + tokens.input,
          output: previous.tokens.output + tokens.output,
          reasoning: previous.tokens.reasoning + tokens.reasoning
        }
      : tokens
  }
}

function captureAssistantOutcome(session: PiSession, event: PiRpcRecord): void {
  const message = assistantMessage(event)
  if (!message) return
  const stopReason = typeof message.stopReason === 'string' ? message.stopReason : ''
  const text = piEventText(message).trim()
  if (stopReason === 'error' || stopReason === 'aborted') {
    const label = stopReason === 'aborted' ? 'stopped' : 'failed'
    session.lastError = safeStatusText(message.errorMessage ?? text) || `Pi ${label}.`
    return
  }
  if (stopReason === 'toolUse' || hasToolCall(message)) return
  const closing = closingTextFromAssistantMessage(message)
  if (closing) session.finalResponse = closing
  else if (text) session.finalResponse = text
}

export function capturePiOutcome(session: PiSession, event: PiRpcRecord): void {
  captureToolOutcome(session, event)
  captureSessionError(session, event)
  captureTurnUsage(session, event)
  captureAssistantOutcome(session, event)
}

export function processExitDetail(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `Pi session exited before completion (${signal}).`
  if (code !== null) return `Pi session exited before completion (code ${String(code)}).`
  return 'Pi session exited before completion.'
}

const IMAGE_EXTENSION = '(?:png|jpe?g|webp|gif)'
const CAPTURE_FILENAME = new RegExp(
  `^(?:chrome-selection-.+|screenshots?[\\s._-].+|screen[\\s_-]?shot[\\s._-].+)\\.${IMAGE_EXTENSION}$`,
  'i'
)
const IMAGE_FILENAME = new RegExp(`^[^,\\n/\\\\]+\\.${IMAGE_EXTENSION}$`, 'i')

function isImageFilename(value: string): boolean {
  return IMAGE_FILENAME.test(value)
}

function isCaptureFilename(value: string): boolean {
  return CAPTURE_FILENAME.test(value)
}

/** Keep in sync with humanizeImageOnlyConversationTitle in src/app/agent-chat/presentation.ts */
function humanizeImageOnlyConversationTitle(title: string): string {
  const parts = title
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length || !parts.every(isImageFilename)) return title
  if (parts.every(isCaptureFilename)) return 'Screenshot'
  return parts.length === 1 ? 'Image' : `${String(parts.length)} images`
}

function currentTask(request: ValidatedPiRequest): string {
  const visiblePrompt = request.displayPrompt?.trim()
  if (visiblePrompt) return humanizeImageOnlyConversationTitle(visiblePrompt).slice(0, 160)
  if (request.attachments?.length) {
    const joined = request.attachments
      .map((part) => (part.type === 'image' ? part.alt || 'Image' : part.name))
      .join(', ')
    return humanizeImageOnlyConversationTitle(joined).slice(0, 160)
  }
  return humanizeImageOnlyConversationTitle(request.prompt).slice(0, 160)
}

export function createPiUserMessage(
  request: ValidatedPiRequest,
  createdAt: string,
  id = randomUUID()
): AgentConversationThread['messages'][number] {
  const text = request.displayPrompt === undefined ? request.prompt : request.displayPrompt.trim()
  return {
    createdAt,
    id,
    ...(request.attachments?.length
      ? { parts: request.attachments.map((attachment) => ({ ...attachment })) }
      : {}),
    role: 'user',
    text
  }
}

export function createPiSession(
  process: PiRpcProcess,
  selection: { effort: string; model: string }
): PiSession {
  return {
    aborting: null,
    activeJobId: null,
    configuredEffort: selection.effort,
    configuredModel: selection.model,
    eventTurnKey: null,
    finalResponse: '',
    firstTokenAt: null,
    generatedCharacters: 0,
    generationBaseTokens: null,
    generationElapsedMs: 0,
    lastEventAt: Date.now(),
    lastError: '',
    lastProbeAt: null,
    lastToolError: '',
    lastTurnUsage: null,
    pendingUiRequests: new Map(),
    providerTurnCursor: null,
    probeInFlight: false,
    process,
    recovering: false,
    settling: false,
    turnPromptMessageId: null,
    turnWorkspaceSnapshot: null
  }
}

export function createIdleForkThread(input: {
  compactForkPending?: boolean
  effort: string
  forkedFromId: string
  messages: AgentConversationThread['messages']
  model: string
  now: string
  recentUpdate: string
  sessionId: string | null
  task: string
  title?: string
  toolScope?: AgentConversationThread['toolScope']
  workerId: string
}): AgentConversationThread {
  const id = randomUUID()
  return {
    canFollowUp: true,
    ...(input.compactForkPending ? { compactForkPending: true } : {}),
    createdAt: input.now,
    effort: input.effort,
    forkedFromId: input.forkedFromId,
    id,
    messages: input.messages,
    model: input.model,
    recentUpdate: input.recentUpdate,
    sessionId: input.sessionId,
    state: 'completed',
    task: input.task,
    ...(input.title ? { title: input.title } : {}),
    toolScope: input.toolScope ?? 'general',
    updatedAt: input.now,
    workerId: input.workerId
  }
}

export function createPiTodoDraftThread(
  request: AgentTodoDraftRequest & { effort: string; model: string },
  now: string,
  workerId: string
): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: now,
    effort: request.effort,
    id: request.threadId?.trim() || randomUUID(),
    messages: [],
    model: request.model,
    recentUpdate: 'Ready to plan.',
    sessionId: null,
    state: 'completed',
    task: request.brief.goal.trim(),
    title: request.title.trim(),
    todoDraft: {
      brief: structuredClone(request.brief),
      ...(request.createdByThreadId?.trim()
        ? { createdByThreadId: request.createdByThreadId.trim() }
        : {}),
      kind: 'todo',
      projectId: request.projectId.trim(),
      todoId: request.todoId.trim()
    },
    toolScope: 'board-worker',
    updatedAt: now,
    workerId
  }
}

export function createPiThread(
  request: ValidatedPiRequest,
  recentUpdate: string,
  now: string,
  workerId: string
): AgentConversationThread {
  const id = randomUUID()
  return {
    activeTurnStartedAt: now,
    canFollowUp: true,
    createdAt: now,
    effort: request.effort,
    id,
    messages: [createPiUserMessage(request, now)],
    model: request.model,
    recentUpdate,
    sessionId: id,
    state: 'running',
    task: currentTask(request),
    toolScope: request.toolScope ?? 'general',
    updatedAt: now,
    workerId
  }
}

export class PiRouterState {
  readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>()
  readonly idleUnloads = new Map<string, ReturnType<typeof setTimeout>>()
  readonly jobs = new AgentJobTracker()
  readonly sessions = new Map<string, PiSession>()
  readonly threads: AgentConversationThread[]
  private lastMediaRecoveryAt = 0
  private mediaMaintenance: Promise<void> | null = null
  private mediaMaintenanceRequested = false
  private readonly mediaStore: ConversationMediaStore
  private nextWorkerNumber: number
  private persistenceTimer: ReturnType<typeof setTimeout> | null = null
  private readonly persistedSignatures = new Map<string, string>()

  constructor(
    private readonly historyPath: string | undefined,
    providers: PiProviderRuntime = new DefaultPiProviderRuntime()
  ) {
    this.mediaStore = new ConversationMediaStore(historyPath)
    this.threads = readAgentConversationHistory(historyPath).map((thread) => {
      migrateProviderActivityHistory(thread)
      compactAgentThreadMemory(thread)
      providers.hydrateThread(thread)
      return thread.state === 'running'
        ? {
            ...thread,
            recentUpdate: 'Previous Pi process stopped before completion.',
            state: 'needs_attention'
          }
        : thread
    })
    this.nextWorkerNumber =
      this.threads.reduce((maximum, thread) => {
        const value = /^worker-(\d+)$/.exec(thread.workerId)?.[1]
        return value ? Math.max(maximum, Number.parseInt(value, 10)) : maximum
      }, 0) + 1
    this.recoverMediaResults(true)
    this.persist()
  }

  close(): void {
    this.persist()
    for (const timer of this.heartbeats.values()) clearInterval(timer)
    this.heartbeats.clear()
    for (const timer of this.idleUnloads.values()) clearTimeout(timer)
    this.idleUnloads.clear()
    for (const session of this.sessions.values()) session.process.close()
    this.sessions.clear()
  }

  job(jobId: string): AgentJobRecord | null {
    return this.jobs.job(jobId)
  }

  requireThread(
    threadId: string,
    options: { allowTodoDraft?: boolean } = {}
  ): AgentConversationThread {
    const thread = this.threads.find((candidate) => candidate.id === threadId)
    if (
      !thread?.canFollowUp ||
      (!thread.sessionId && !(options.allowTodoDraft && thread.todoDraft))
    ) {
      throw new Error('This Pi conversation cannot preserve context yet.')
    }
    return thread
  }

  conversations(): AgentConversationThread[] {
    this.recoverMediaResults()
    return this.threads
      .map((thread) => this.mediaStore.materialize(thread))
      .sort(compareAgentConversationsByLastUserMessage)
  }

  conversationPreviews(): AgentConversationThread[] {
    this.recoverMediaResults()
    return [...this.threads]
      .sort(compareAgentConversationsByLastUserMessage)
      .map(previewAgentConversation)
  }

  conversation(threadId: string): AgentConversationThread | null {
    this.recoverMediaResults()
    const thread = this.threads.find((candidate) => candidate.id === threadId)
    return thread ? this.mediaStore.materialize(thread) : null
  }

  continuationImagePaths(thread: AgentConversationThread): string[] {
    return this.mediaStore.inputImagePaths(thread)
  }

  async waitForJob(jobId: string, timeoutMs: number): Promise<AgentJobRecord | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const job = this.jobs.job(jobId)
      if (!job || (job.state !== 'queued' && job.state !== 'running')) return job
      if (Date.now() >= deadline) return job
      await new Promise((resolve) => {
        setTimeout(resolve, 250)
      })
    }
  }

  availableWorkerId(): string {
    const workerId = `worker-${String(this.nextWorkerNumber)}`
    this.nextWorkerNumber += 1
    return workerId
  }

  disposeSession(threadId: string, options?: { graceMs?: number }): void {
    const session = this.sessions.get(threadId)
    if (!session) return
    this.sessions.delete(threadId)
    this.clearHeartbeat(threadId)
    this.clearIdleUnload(threadId)
    session.process.close(options)
  }

  clearHeartbeat(threadId: string): void {
    const timer = this.heartbeats.get(threadId)
    if (timer) clearInterval(timer)
    this.heartbeats.delete(threadId)
  }

  clearIdleUnload(threadId: string): void {
    const timer = this.idleUnloads.get(threadId)
    if (timer) clearTimeout(timer)
    this.idleUnloads.delete(threadId)
  }

  armIdleUnload(threadId: string, delayMs: number, onIdle: () => void): void {
    this.clearIdleUnload(threadId)
    if (delayMs <= 0) {
      onIdle()
      return
    }
    const timer = setTimeout(() => {
      this.idleUnloads.delete(threadId)
      onIdle()
    }, delayMs)
    timer.unref?.()
    this.idleUnloads.set(threadId, timer)
  }

  armHeartbeat(
    thread: AgentConversationThread,
    onTick: (now: number) => void,
    intervalMs = RUNNING_HEARTBEAT_MS
  ): void {
    this.clearHeartbeat(thread.id)
    const timer = setInterval(
      () => {
        const session = this.sessions.get(thread.id)
        if (thread.state !== 'running' || !session?.activeJobId) {
          this.clearHeartbeat(thread.id)
          return
        }
        onTick(Date.now())
        if (!refreshPiHeartbeat(thread)) return
        this.schedulePersist()
      },
      Math.max(5, intervalMs)
    )
    timer.unref()
    this.heartbeats.set(thread.id, timer)
  }

  persist(): void {
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer)
    this.persistenceTimer = null
    if (!this.historyPath) return
    for (const thread of this.threads) {
      compactAgentThreadMemory(thread)
      this.mediaStore.externalize(thread)
    }
    this.writeHistory()
    this.requestMediaMaintenance()
  }

  private writeHistory(): void {
    if (!this.historyPath) return
    writeAgentConversationHistory(this.historyPath, this.threads, this.persistedSignatures)
  }

  private requestMediaMaintenance(): void {
    if (!this.historyPath) return
    this.mediaMaintenanceRequested = true
    if (this.mediaMaintenance) return
    this.mediaMaintenance = this.runMediaMaintenance()
      .catch(() => undefined)
      .finally(() => {
        this.mediaMaintenance = null
        if (this.mediaMaintenanceRequested) this.requestMediaMaintenance()
      })
  }

  private async runMediaMaintenance(): Promise<void> {
    while (this.mediaMaintenanceRequested) {
      this.mediaMaintenanceRequested = false
      let changed = false
      const threads = this.threads.slice()
      for (const thread of threads) {
        if (await this.mediaStore.externalizeVideos(thread)) changed = true
      }
      if (changed) this.writeHistory()
      await this.mediaStore.prune(this.threads)
    }
  }

  schedulePersist(): void {
    if (!this.historyPath || this.persistenceTimer) return
    this.persistenceTimer = setTimeout(() => this.persist(), 100)
    this.persistenceTimer.unref()
  }

  private recoverMediaResults(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastMediaRecoveryAt < 1_000) return
    this.lastMediaRecoveryAt = now
    let changed = false
    if (recoverDurableMediaResults(this.threads)) {
      for (const thread of this.threads) this.mediaStore.externalize(thread)
      changed = true
    }
    if (changed) this.schedulePersist()
  }
}
