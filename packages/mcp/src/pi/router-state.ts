import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  previewAgentConversation,
  type AgentExtensionUiRequest,
  type AgentConversationThread,
  readAgentConversationHistory,
  type AgentDispatchRequest
} from '#mcp/agent-router/contracts'
import { AgentJobTracker, type AgentJobRecord } from '#mcp/agent-router/jobs'

import type { AntigravityUsageCursor } from './antigravity-usage'
import { ConversationMediaStore } from './conversation-media'
import { piEventText, piToolOutputFailed } from './events'
import { recoverDurableMediaResults } from './media-recovery'
import type { PiRpcProcess, PiRpcRecord } from './rpc-process'
import { hydrateEstimatedAntigravityTelemetry } from './telemetry'

const RUNNING_HEARTBEAT_MS = 8_000
const MAX_STATUS_TEXT = 160

export type ValidatedPiRequest = AgentDispatchRequest & {
  effort: string
  model: string
  prompt: string
}

export type PiLaunch =
  | { kind: 'fork'; sessionId: string }
  | { kind: 'new' }
  | { kind: 'resume'; sessionId: string }

export type PiSession = {
  aborting: 'stop' | null
  activeJobId: string | null
  antigravityUsageCursor: AntigravityUsageCursor | null
  finalResponse: string
  firstTokenAt: number | null
  generatedCharacters: number
  generationBaseTokens: number | null
  generationElapsedMs: number
  lastEventAt: number
  lastError: string
  lastProbeAt: number | null
  lastToolError: string
  pendingUiRequests: Map<string, AgentExtensionUiRequest>
  probeInFlight: boolean
  process: PiRpcProcess
  recovering: boolean
  settling: boolean
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
  if (text && stopReason !== 'toolUse' && !hasToolCall(message)) session.finalResponse = text
}

export function capturePiOutcome(session: PiSession, event: PiRpcRecord): void {
  captureToolOutcome(session, event)
  captureSessionError(session, event)
  captureAssistantOutcome(session, event)
}

export function processExitDetail(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `Pi session exited before completion (${signal}).`
  if (code !== null) return `Pi session exited before completion (code ${String(code)}).`
  return 'Pi session exited before completion.'
}

function currentTask(request: ValidatedPiRequest): string {
  const visiblePrompt = request.displayPrompt?.trim()
  if (visiblePrompt) return visiblePrompt.slice(0, 160)
  if (request.attachments?.length) {
    return request.attachments
      .map((part) => (part.type === 'image' ? part.alt || 'Image' : part.name))
      .join(', ')
      .slice(0, 160)
  }
  return request.prompt.slice(0, 160)
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

export function createPiThread(
  request: ValidatedPiRequest,
  recentUpdate: string,
  now: string,
  workerId: string
): AgentConversationThread {
  const id = randomUUID()
  return {
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
    updatedAt: now,
    workerId
  }
}

export class PiRouterState {
  readonly heartbeats = new Map<string, ReturnType<typeof setInterval>>()
  readonly jobs = new AgentJobTracker()
  readonly sessions = new Map<string, PiSession>()
  readonly threads: AgentConversationThread[]
  private lastMediaRecoveryAt = 0
  private mediaMaintenance: Promise<void> | null = null
  private mediaMaintenanceRequested = false
  private readonly mediaStore: ConversationMediaStore
  private nextWorkerNumber: number
  private persistenceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly historyPath: string | undefined) {
    this.mediaStore = new ConversationMediaStore(historyPath)
    this.threads = readAgentConversationHistory(historyPath).map((thread) => {
      hydrateEstimatedAntigravityTelemetry(thread)
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
    for (const session of this.sessions.values()) session.process.close()
    this.sessions.clear()
  }

  job(jobId: string): AgentJobRecord | null {
    return this.jobs.job(jobId)
  }

  requireThread(threadId: string): AgentConversationThread {
    const thread = this.threads.find((candidate) => candidate.id === threadId)
    if (!thread?.canFollowUp || !thread.sessionId) {
      throw new Error('This Pi conversation cannot preserve context yet.')
    }
    return thread
  }

  conversations(): AgentConversationThread[] {
    this.recoverMediaResults()
    return this.threads
      .map((thread) => this.mediaStore.materialize(thread))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  conversationPreviews(): AgentConversationThread[] {
    this.recoverMediaResults()
    return this.threads
      .map(previewAgentConversation)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  conversation(threadId: string): AgentConversationThread | null {
    this.recoverMediaResults()
    const thread = this.threads.find((candidate) => candidate.id === threadId)
    return thread ? this.mediaStore.materialize(thread) : null
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

  disposeSession(threadId: string): void {
    const session = this.sessions.get(threadId)
    if (!session) return
    this.sessions.delete(threadId)
    this.clearHeartbeat(threadId)
    session.process.close()
  }

  clearHeartbeat(threadId: string): void {
    const timer = this.heartbeats.get(threadId)
    if (timer) clearInterval(timer)
    this.heartbeats.delete(threadId)
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
    for (const thread of this.threads) this.mediaStore.externalize(thread)
    this.writeHistory()
    this.requestMediaMaintenance()
  }

  private writeHistory(): void {
    if (!this.historyPath) return
    mkdirSync(path.dirname(this.historyPath), { recursive: true })
    const temporary = `${this.historyPath}.tmp`
    writeFileSync(temporary, JSON.stringify(this.threads, null, 2))
    renameSync(temporary, this.historyPath)
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
