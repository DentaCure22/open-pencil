import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  previewAgentConversation,
  type AgentConversationThread,
  readAgentConversationHistory,
  type AgentDispatchRequest
} from '#mcp/agent-router/contracts'
import { AgentJobTracker, type AgentJobRecord } from '#mcp/agent-router/jobs'

import { piEventText, piToolOutputFailed } from './events'
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
  finalResponse: string
  firstTokenAt: number | null
  generatedCharacters: number
  generationBaseTokens: number | null
  lastError: string
  lastToolError: string
  process: PiRpcProcess
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
  return (request.displayPrompt?.trim() || request.prompt).slice(0, 160)
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
    messages: [
      {
        createdAt: now,
        id: randomUUID(),
        role: 'user',
        text: request.displayPrompt?.trim() || request.prompt
      }
    ],
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
  readonly workerCount: number

  constructor(
    private readonly historyPath: string | undefined,
    workerCount: number | undefined
  ) {
    this.workerCount = Math.max(1, Math.floor(workerCount ?? 4))
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
    this.persist()
  }

  close(): void {
    for (const timer of this.heartbeats.values()) clearInterval(timer)
    this.heartbeats.clear()
    for (const session of this.sessions.values()) session.process.close()
    this.sessions.clear()
  }

  job(jobId: string): AgentJobRecord | null {
    return this.jobs.job(jobId)
  }

  conversations(): AgentConversationThread[] {
    return structuredClone(this.threads).sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  }

  conversationPreviews(): AgentConversationThread[] {
    return this.threads
      .map(previewAgentConversation)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  conversation(threadId: string): AgentConversationThread | null {
    const thread = this.threads.find((candidate) => candidate.id === threadId)
    return thread ? structuredClone(thread) : null
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
    const active = new Set(
      this.threads.filter((thread) => thread.state === 'running').map((thread) => thread.workerId)
    )
    const slots = Array.from(
      { length: this.workerCount },
      (_, index) => `worker-${String(index + 1)}`
    )
    const available = slots.filter((slot) => !active.has(slot))
    if (available.length === 0) {
      let overflow = this.workerCount + 1
      while (active.has(`worker-${String(overflow)}`)) overflow += 1
      return `worker-${String(overflow)}`
    }
    return available.sort((left, right) => {
      const latest = (workerId: string) =>
        this.threads
          .filter((thread) => thread.workerId === workerId)
          .reduce((value, thread) => (thread.updatedAt > value ? thread.updatedAt : value), '')
      return latest(left).localeCompare(latest(right))
    })[0]
  }

  releaseIdleWorkerSession(workerId: string, exceptThreadId: string): void {
    for (const thread of this.threads) {
      if (
        thread.id === exceptThreadId ||
        thread.workerId !== workerId ||
        thread.state === 'running'
      ) {
        continue
      }
      this.disposeSession(thread.id)
    }
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

  armHeartbeat(thread: AgentConversationThread): void {
    this.clearHeartbeat(thread.id)
    const timer = setInterval(() => {
      const session = this.sessions.get(thread.id)
      if (thread.state !== 'running' || !session?.activeJobId) {
        this.clearHeartbeat(thread.id)
        return
      }
      if (!refreshPiHeartbeat(thread)) return
      this.persist()
    }, RUNNING_HEARTBEAT_MS)
    timer.unref()
    this.heartbeats.set(thread.id, timer)
  }

  persist(): void {
    if (!this.historyPath) return
    mkdirSync(path.dirname(this.historyPath), { recursive: true })
    const temporary = `${this.historyPath}.tmp`
    writeFileSync(temporary, JSON.stringify(this.threads, null, 2))
    renameSync(temporary, this.historyPath)
  }
}
