import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import type { AgentModelDefinition } from '#mcp/agent-models/catalog'
import {
  type AgentConversationRouter,
  type AgentConversationThread,
  type AgentDispatchReceipt,
  type AgentDispatchRequest,
  type AgentProviderUsage
} from '#mcp/agent-router/contracts'
import type { AgentJobRecord } from '#mcp/agent-router/jobs'
import { agentWorkerEnv } from '#mcp/agent-router/worker-env'

import {
  parsePiModelId,
  piPromptWithEvidence,
  piRpcArguments,
  piThinkingLevel,
  type PiLaunchMode
} from './arguments'
import { validatePiSelection } from './catalog'
import { applyPiEvent } from './events'
import { PiProviderUsageService } from './provider-usage'
import {
  capturePiOutcome,
  completePendingUserMessages,
  createPiThread,
  isRecord,
  PiRouterState,
  processExitDetail,
  safeStatusText,
  type PiLaunch,
  type PiSession,
  type ValidatedPiRequest
} from './router-state'
import { PiRpcProcess, type PiRpcRecord } from './rpc-process'
import { applyPiEventTelemetry, applyPiSessionStats, applyPiStateTelemetry } from './telemetry'

const MAX_PROMPT_BYTES = 128 * 1024

export type PiRouterConfig = {
  executable: string
  historyPath?: string
  models?: AgentModelDefinition[]
  sessionDir?: string
  workerCount?: number
  workspaceRoot: string
}

export class PiAgentRouter implements AgentConversationRouter {
  private readonly state: PiRouterState
  private readonly providerUsageService: PiProviderUsageService

  constructor(readonly config: PiRouterConfig) {
    this.state = new PiRouterState(config.historyPath, config.workerCount)
    this.providerUsageService = new PiProviderUsageService({
      executable: config.executable,
      models: () => this.models(),
      workspaceRoot: config.workspaceRoot
    })
  }

  close(): void {
    this.state.close()
  }

  job(jobId: string): AgentJobRecord | null {
    return this.state.job(jobId)
  }

  conversations(): AgentConversationThread[] {
    return this.state.conversations()
  }

  conversationPreviews(): AgentConversationThread[] {
    return this.state.conversationPreviews()
  }

  conversation(threadId: string): AgentConversationThread | null {
    return this.state.conversation(threadId)
  }

  models(): AgentModelDefinition[] {
    return structuredClone(this.config.models ?? [])
  }

  async providerUsage(provider: string): Promise<AgentProviderUsage | null> {
    return this.providerUsageService.get(provider)
  }

  async status(): Promise<{ active: number; available: boolean; workspaceRoot: string }> {
    const available = await Promise.all([
      access(this.config.executable, constants.X_OK),
      access(this.config.workspaceRoot, constants.R_OK | constants.W_OK)
    ])
      .then(() => true)
      .catch(() => false)
    return {
      active: this.state.threads.filter((thread) => thread.state === 'running').length,
      available,
      workspaceRoot: this.config.workspaceRoot
    }
  }

  async dispatch(request: AgentDispatchRequest): Promise<AgentDispatchReceipt> {
    return this.launch(this.validate(request), { kind: 'new' })
  }

  async followUp(
    threadId: string,
    prompt: string,
    selection?: {
      displayPrompt?: string
      effort?: string
      evidencePath?: string
      model?: string
    }
  ): Promise<AgentDispatchReceipt> {
    const thread = this.requireThread(threadId)
    const session = this.state.sessions.get(thread.id)
    if (session?.aborting === 'stop') throw new Error('This Pi conversation is still stopping.')
    if (session?.activeJobId) {
      return this.steer(threadId, prompt, selection)
    }
    const request = this.validate({
      displayPrompt: selection?.displayPrompt,
      effort: selection?.effort ?? thread.effort,
      evidencePath: selection?.evidencePath,
      model: selection?.model?.trim() || thread.model,
      prompt
    })
    const sessionId = thread.sessionId
    if (!sessionId) throw new Error('This Pi conversation has no native session.')
    return this.launch(request, { kind: 'resume', sessionId }, thread)
  }

  async steer(
    threadId: string,
    prompt: string,
    selection?: {
      displayPrompt?: string
      effort?: string
      evidencePath?: string
      model?: string
    }
  ): Promise<AgentDispatchReceipt> {
    const thread = this.requireThread(threadId)
    const session = this.state.sessions.get(thread.id)
    if (session?.aborting === 'stop') throw new Error('This Pi conversation is still stopping.')
    if (!session?.activeJobId) {
      return this.followUp(threadId, prompt, selection)
    }
    const request = this.validate({
      displayPrompt: selection?.displayPrompt,
      effort: thread.effort,
      evidencePath: selection?.evidencePath,
      model: thread.model,
      prompt
    })
    const jobId = session.activeJobId
    const now = new Date().toISOString()
    const messageId = randomUUID()
    const previousRecentUpdate = thread.recentUpdate
    thread.messages.push({
      createdAt: now,
      id: messageId,
      role: 'user',
      text: request.displayPrompt?.trim() || request.prompt
    })
    thread.recentUpdate = 'Applying your latest instruction…'
    thread.updatedAt = now
    this.state.persist()
    try {
      const response = await session.process.command({
        message: piPromptWithEvidence(request.prompt, request.evidencePath),
        type: 'steer'
      })
      if (!response.success) {
        throw new Error(response.error || 'Pi rejected the steering correction.')
      }
      session.finalResponse = ''
    } catch (error) {
      const messageIndex = thread.messages.findIndex((message) => message.id === messageId)
      if (messageIndex !== -1) thread.messages.splice(messageIndex, 1)
      const detail =
        safeStatusText(error instanceof Error ? error.message : error) ||
        'Pi rejected the steering correction.'
      if (thread.recentUpdate === 'Applying your latest instruction…') {
        thread.recentUpdate = previousRecentUpdate
      }
      thread.updatedAt = new Date().toISOString()
      this.state.persist()
      throw new Error(detail)
    }
    return {
      dispatchedAt: new Date().toISOString(),
      jobId,
      state: 'running',
      threadId: thread.id
    }
  }

  async fork(threadId: string, request: AgentDispatchRequest): Promise<AgentDispatchReceipt> {
    const source = this.requireThread(threadId)
    const sessionId = source.sessionId
    if (!sessionId) throw new Error('This Pi conversation has no native session.')
    return this.launch(this.validate(request), {
      kind: 'fork',
      sessionId
    })
  }

  stop(threadId: string): boolean {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    const session = this.state.sessions.get(threadId)
    if (!thread || !session?.activeJobId) return false
    const now = new Date().toISOString()
    thread.state = 'stopped'
    thread.recentUpdate = 'Stopped by the user.'
    thread.updatedAt = now
    completePendingUserMessages(thread, now)
    this.state.jobs.settle(session.activeJobId, 'stopped', thread.recentUpdate)
    session.activeJobId = null
    session.aborting = 'stop'
    this.state.clearHeartbeat(threadId)
    this.state.persist()
    try {
      session.process.write({ id: `stop:${randomUUID()}`, type: 'abort' })
    } catch {
      return true
    }
    return true
  }

  delete(threadId: string): boolean {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    if (!thread) return false
    this.state.disposeSession(threadId)
    const index = this.state.threads.findIndex((candidate) => candidate.id === threadId)
    if (index !== -1) this.state.threads.splice(index, 1)
    this.state.persist()
    return true
  }

  resetWorkers(): { deleted: number } {
    const ids = this.state.threads.map((thread) => thread.id)
    for (const id of ids) this.state.disposeSession(id)
    this.state.threads.splice(0)
    this.state.persist()
    return { deleted: ids.length }
  }

  async waitForJob(jobId: string, timeoutMs = 180_000): Promise<AgentJobRecord | null> {
    return this.state.waitForJob(jobId, timeoutMs)
  }

  private validate(request: AgentDispatchRequest): ValidatedPiRequest {
    const prompt = request.prompt.trim()
    if (!prompt) throw new TypeError('A prompt is required.')
    if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) {
      throw new TypeError('The prompt is too large for Pi.')
    }
    const selection = validatePiSelection(this.models(), request.model, request.effort)
    return { ...request, ...selection, prompt }
  }

  private requireThread(threadId: string): AgentConversationThread {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    if (!thread?.canFollowUp || !thread.sessionId) {
      throw new Error('This Pi conversation cannot preserve context yet.')
    }
    return thread
  }

  private async launch(
    request: ValidatedPiRequest,
    mode: PiLaunch,
    existing?: AgentConversationThread,
    jobId: string = randomUUID()
  ): Promise<AgentDispatchReceipt> {
    const now = new Date().toISOString()
    const thread =
      existing ??
      createPiThread(
        request,
        mode.kind === 'fork' ? 'Forking relevant Pi context.' : 'Starting Pi.',
        now,
        this.state.availableWorkerId()
      )
    if (!existing) this.state.threads.push(thread)
    else {
      thread.messages.push({
        createdAt: now,
        id: randomUUID(),
        role: 'user',
        text: request.displayPrompt?.trim() || request.prompt
      })
    }
    thread.state = 'running'
    thread.updatedAt = now
    thread.model = request.model
    thread.effort = request.effort
    this.state.jobs.register(jobId, thread.id, 'running')
    this.state.persist()

    try {
      const session = await this.ensureSession(thread, request, mode)
      await this.startTurn(thread, session, request, jobId)
    } catch (error) {
      const detail =
        safeStatusText(error instanceof Error ? error.message : error) || 'Pi could not start.'
      this.failTurn(thread, jobId, detail)
      throw new Error(detail)
    }

    return {
      dispatchedAt: now,
      jobId,
      state: 'running',
      threadId: thread.id
    }
  }

  private async ensureSession(
    thread: AgentConversationThread,
    request: ValidatedPiRequest,
    mode: PiLaunch
  ): Promise<PiSession> {
    const existing = this.state.sessions.get(thread.id)
    if (existing && !existing.process.isClosing) return existing
    this.state.releaseIdleWorkerSession(thread.workerId, thread.id)
    const launchMode: PiLaunchMode = mode.kind
    const sessionId = mode.kind === 'resume' ? mode.sessionId : thread.id
    const args = piRpcArguments({
      effort: request.effort,
      mode: launchMode,
      model: request.model,
      ...(this.config.sessionDir ? { sessionDir: this.config.sessionDir } : {}),
      sessionId,
      ...(mode.kind === 'fork' ? { sourceSessionId: mode.sessionId } : {})
    })
    let rpc: PiRpcProcess | null = null
    rpc = await PiRpcProcess.start({
      args,
      cwd: this.config.workspaceRoot,
      env: agentWorkerEnv(process.env, this.config.executable),
      executable: this.config.executable,
      onEvent: (event) => {
        if (rpc) this.handleEvent(thread.id, rpc, event)
      },
      onExit: (code, signal, stderr) => {
        if (rpc) this.handleExit(thread.id, rpc, code, signal, stderr)
      }
    })
    const session: PiSession = {
      aborting: null,
      activeJobId: null,
      finalResponse: '',
      firstTokenAt: null,
      generatedCharacters: 0,
      generationBaseTokens: null,
      lastError: '',
      lastToolError: '',
      process: rpc
    }
    this.state.sessions.set(thread.id, session)
    try {
      const state = await rpc.command({ type: 'get_state' })
      if (!state.success) throw new Error(state.error || 'Pi RPC session is unavailable.')
      if (isRecord(state.data) && typeof state.data.sessionId === 'string') {
        thread.sessionId = state.data.sessionId
      }
      applyPiStateTelemetry(thread, state.data)
      const stats = await rpc.command({ type: 'get_session_stats' })
      if (stats.success) applyPiSessionStats(thread, stats.data)
      thread.canFollowUp = true
      this.state.persist()
      return session
    } catch (error) {
      this.state.disposeSession(thread.id)
      throw error
    }
  }

  private async startTurn(
    thread: AgentConversationThread,
    session: PiSession,
    request: ValidatedPiRequest,
    jobId: string
  ): Promise<void> {
    session.activeJobId = jobId
    session.aborting = null
    session.finalResponse = ''
    session.lastError = ''
    session.lastToolError = ''
    thread.state = 'running'
    thread.model = request.model
    thread.effort = request.effort
    thread.recentUpdate = 'Pi is running.'
    thread.updatedAt = new Date().toISOString()
    this.state.jobs.register(jobId, thread.id, 'running')
    this.state.persist()

    const { model, provider } = parsePiModelId(request.model)
    const modelResponse = await session.process.command({
      modelId: model,
      provider,
      type: 'set_model'
    })
    if (!modelResponse.success)
      throw new Error(modelResponse.error || 'Pi rejected the selected model.')
    applyPiStateTelemetry(thread, modelResponse.data)
    const thinkingResponse = await session.process.command({
      level: piThinkingLevel(request.effort),
      type: 'set_thinking_level'
    })
    if (!thinkingResponse.success) {
      throw new Error(thinkingResponse.error || 'Pi rejected the selected thinking level.')
    }
    const promptResponse = await session.process.command({
      message: piPromptWithEvidence(request.prompt, request.evidencePath),
      type: 'prompt'
    })
    if (!promptResponse.success) throw new Error(promptResponse.error || 'Pi rejected the prompt.')
    this.state.armHeartbeat(thread)
  }

  private handleEvent(threadId: string, process: PiRpcProcess, event: PiRpcRecord): void {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    const session = this.state.sessions.get(threadId)
    if (!thread || !session || session.process !== process) return
    if (event.type === 'extension_ui_request') {
      this.handleExtensionUi(session, event)
      return
    }
    const turnKey = session.activeJobId ?? `session:${thread.id}`
    const applied = applyPiEvent(thread, event, turnKey)
    const telemetryApplied = applyPiEventTelemetry(thread, session, event)
    capturePiOutcome(session, event)
    if (applied || telemetryApplied) {
      thread.updatedAt = new Date().toISOString()
      this.state.persist()
    }
    if (event.type === 'agent_settled') this.settleTurn(thread, session)
  }

  private settleTurn(thread: AgentConversationThread, session: PiSession): void {
    const now = new Date().toISOString()
    const jobId = session.activeJobId
    completePendingUserMessages(thread, now)
    this.state.clearHeartbeat(thread.id)
    if (session.aborting === 'stop') {
      session.aborting = null
      session.activeJobId = null
      this.state.persist()
      return
    }
    if (!jobId) {
      session.aborting = null
      this.state.persist()
      return
    }
    if (session.finalResponse.trim()) {
      thread.state = 'completed'
      thread.recentUpdate = session.finalResponse.trim().slice(0, 500)
      this.state.jobs.settle(jobId, 'completed', session.finalResponse.trim())
    } else {
      thread.state = 'needs_attention'
      thread.recentUpdate =
        session.lastError || session.lastToolError || 'Pi stopped without a final response.'
      this.state.jobs.settle(jobId, 'failed', thread.recentUpdate)
    }
    thread.updatedAt = now
    session.activeJobId = null
    this.state.persist()
  }

  private handleExtensionUi(session: PiSession, event: PiRpcRecord): void {
    if (
      typeof event.id !== 'string' ||
      !['confirm', 'editor', 'input', 'select'].includes(String(event.method))
    ) {
      return
    }
    session.process.write({ cancelled: true, id: event.id, type: 'extension_ui_response' })
  }

  private handleExit(
    threadId: string,
    process: PiRpcProcess,
    code: number | null,
    signal: NodeJS.Signals | null,
    stderr: string
  ): void {
    const session = this.state.sessions.get(threadId)
    if (!session || session.process !== process) return
    this.state.sessions.delete(threadId)
    this.state.clearHeartbeat(threadId)
    if (process.isClosing) return
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    if (!thread || !session.activeJobId) return
    const now = new Date().toISOString()
    const detail = safeStatusText(stderr) || processExitDetail(code, signal)
    completePendingUserMessages(thread, now)
    thread.state = 'needs_attention'
    thread.recentUpdate = detail
    thread.updatedAt = now
    this.state.jobs.settle(session.activeJobId, 'failed', detail)
    this.state.persist()
  }

  private failTurn(thread: AgentConversationThread, jobId: string, detail: string): void {
    const now = new Date().toISOString()
    completePendingUserMessages(thread, now)
    thread.state = 'needs_attention'
    thread.recentUpdate = detail
    thread.updatedAt = now
    const session = this.state.sessions.get(thread.id)
    if (session?.activeJobId === jobId) session.activeJobId = null
    this.state.jobs.settle(jobId, 'failed', detail)
    this.state.clearHeartbeat(thread.id)
    this.state.persist()
  }
}
