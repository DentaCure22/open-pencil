import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'

import type { AgentModelDefinition } from '#mcp/agent-models/catalog'
import {
  type AgentConversationRouter,
  type AgentConversationThread,
  type AgentDispatchReceipt,
  type AgentDispatchRequest,
  type AgentExtensionUiRequest,
  type AgentExtensionUiResponse,
  type AgentProviderUsage
} from '#mcp/agent-router/contracts'
import type { AgentJobRecord } from '#mcp/agent-router/jobs'
import { agentWorkerEnv } from '#mcp/agent-router/worker-env'

import { captureAntigravityUsageCursor, readAntigravityTurnUsage } from './antigravity-usage'
import {
  parsePiModelId,
  piPromptInputWithEvidence,
  piRpcArguments,
  piThinkingLevel,
  type PiLaunchMode,
  type PiPromptInput
} from './arguments'
import { validatePiSelection } from './catalog'
import { compactForkPrompt, resolvePiForkLaunch, type PiForkPlan } from './compact-fork'
import {
  applyPiEvent,
  ensureVisibleFinalResponse,
  finalizePiStreamingAssistant,
  restorePiStreamingAssistant,
  threadClosingText
} from './events'
import { PiProcessPool, type PiWarmProcess } from './process-pool'
import { PiProviderUsageService } from './provider-usage'
import type { PiRouterConfig } from './router-config'
import {
  capturePiOutcome,
  completePendingUserMessages,
  createIdleForkThread,
  createPiSession,
  createPiThread,
  createPiUserMessage,
  isRecord,
  PiRouterState,
  processExitDetail,
  safeStatusText,
  type PiLaunch,
  type PiSession,
  type ValidatedPiRequest
} from './router-state'
import {
  isPiRpcTimeout,
  PI_PROMPT_COMMAND_TIMEOUT_MS,
  PiRpcProcess,
  type PiRpcRecord
} from './rpc-process'
import { reconcilePiSessionHistory } from './session-history'
import { resolveIdleUnloadGraceMs, resolveIdleUnloadMs } from './session-idle'
import {
  applyMeasuredAntigravityUsage,
  applyPiEventTelemetry,
  applyPiSessionStats,
  applyPiStateTelemetry
} from './telemetry'
import { appendUsageTurnBestEffort, buildLiveUsageTurn, emptyUsageTokens } from './usage-ledger'
import { PiSessionWatchdog } from './watchdog'
import {
  boardWorkerPrompt,
  resolveBoardWorkerMcpConfigPath,
  resolvePiSessionMcpConfigPath
} from './worker-mcp'

const MAX_PROMPT_BYTES = 128 * 1024

export type { PiRouterConfig } from './router-config'

export class PiAgentRouter implements AgentConversationRouter {
  private readonly boardWorkerMcpConfigPath?: string
  private readonly mcpConfigPath?: string
  private readonly pool: PiProcessPool
  private readonly state: PiRouterState
  private readonly providerUsageService: PiProviderUsageService
  private readonly watchdog: PiSessionWatchdog

  constructor(readonly config: PiRouterConfig) {
    this.state = new PiRouterState(config.historyPath)
    this.mcpConfigPath = resolvePiSessionMcpConfigPath({
      mcpConfigPath: config.mcpConfigPath
    })
    this.boardWorkerMcpConfigPath = resolveBoardWorkerMcpConfigPath({
      mcpConfigPath: config.mcpConfigPath,
      sessionDir: config.sessionDir
    })
    this.pool = new PiProcessPool({
      cwd: config.workspaceRoot,
      ...warmProcessSelection(config),
      env: agentWorkerEnv(process.env, config.executable),
      executable: config.executable,
      ...(this.mcpConfigPath ? { mcpConfigPath: this.mcpConfigPath } : {}),
      ...(config.sessionDir ? { sessionDir: config.sessionDir } : {}),
      size: config.warmPoolSize
    })
    this.providerUsageService = new PiProviderUsageService({
      executable: config.executable,
      models: () => this.models(),
      workspaceRoot: config.workspaceRoot
    })
    this.watchdog = new PiSessionWatchdog(config, {
      applyState: applyPiStateTelemetry,
      isCurrent: (thread, session) => this.state.sessions.get(thread.id) === session,
      onFailure: (thread, session, detail) => {
        void this.recoverStalledSession(thread, session, detail)
      },
      onIdle: (thread, session) => {
        void this.settleTurnFromSession(thread, session)
      }
    })
    this.pool.ensure()
  }

  close(): void {
    this.pool.close()
    this.state.close()
  }

  waitForWarmProcess(count = 1, timeoutMs = 3_000): Promise<boolean> {
    return this.pool.waitUntilReady(count, timeoutMs)
  }

  job(jobId: string): AgentJobRecord | null {
    return this.state.job(jobId)
  }

  conversations(): AgentConversationThread[] {
    return this.state.conversations().map((thread) => this.withPendingUiRequests(thread))
  }

  conversationPreviews(): AgentConversationThread[] {
    return this.state.conversationPreviews().map((thread) => this.withPendingUiRequests(thread))
  }

  conversation(threadId: string): AgentConversationThread | null {
    const thread = this.state.conversation(threadId)
    return thread ? this.withPendingUiRequests(thread) : null
  }

  models(): AgentModelDefinition[] {
    return structuredClone(this.config.models ?? [])
  }

  async providerUsage(provider: string): Promise<AgentProviderUsage | null> {
    return this.providerUsageService.get(provider)
  }

  respondToUiRequest(
    threadId: string,
    requestId: string,
    response: AgentExtensionUiResponse
  ): boolean {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    const session = this.state.sessions.get(threadId)
    const request = session?.pendingUiRequests.get(requestId)
    if (!thread || !session || !request) return false

    const rpcResponse = this.validateExtensionUiResponse(request, response)
    session.process.write({ id: requestId, type: 'extension_ui_response', ...rpcResponse })
    session.pendingUiRequests.delete(requestId)
    const now = new Date().toISOString()
    thread.updatedAt = now
    if (session.pendingUiRequests.size) {
      thread.state = 'needs_attention'
      thread.recentUpdate = 'Waiting for your approval.'
    } else if (session.activeJobId) {
      thread.state = 'running'
      thread.recentUpdate = 'Pi is running.'
      this.state.armHeartbeat(
        thread,
        (tickAt) => this.watchdog.tick(thread, session, tickAt),
        this.watchdog.intervalMs
      )
    }
    this.state.persist()
    return true
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
      attachments?: AgentDispatchRequest['attachments']
      displayPrompt?: string
      effort?: string
      evidencePath?: string
      imagePaths?: string[]
      model?: string
      toolScope?: AgentConversationThread['toolScope']
    }
  ): Promise<AgentDispatchReceipt> {
    const thread = this.state.requireThread(threadId)
    const session = this.state.sessions.get(thread.id)
    if (session?.aborting === 'stop') throw new Error('This Pi conversation is still stopping.')
    if (session?.activeJobId) {
      return this.steer(threadId, prompt, selection)
    }
    if (session?.pendingUiRequests.size) {
      this.cancelPendingUiRequests(session)
      this.state.persist()
    }
    const requestedToolScope = selection?.toolScope ?? thread.toolScope ?? 'general'
    if (thread.toolScope && requestedToolScope !== thread.toolScope) {
      throw new Error('This Pi conversation cannot change tool scope; start a new chat instead.')
    }
    if (!thread.toolScope) {
      thread.toolScope = requestedToolScope
      if (session) this.state.disposeSession(thread.id)
      this.state.persist()
    }
    const request = this.validate({
      attachments: selection?.attachments,
      displayPrompt: selection?.displayPrompt,
      effort: selection?.effort ?? thread.effort,
      evidencePath: selection?.evidencePath,
      imagePaths: selection?.imagePaths,
      model: selection?.model?.trim() || thread.model,
      prompt,
      toolScope: requestedToolScope
    })
    if (thread.compactForkPending) {
      thread.compactForkPending = false
      return this.launch(
        this.validate({
          ...request,
          displayPrompt: selection?.displayPrompt ?? prompt,
          prompt: compactForkPrompt(thread, prompt)
        }),
        { kind: 'new' },
        thread
      )
    }
    const sessionId = thread.sessionId
    if (!sessionId) throw new Error('This Pi conversation has no native session.')
    return this.launch(request, { kind: 'resume', sessionId }, thread)
  }

  async steer(
    threadId: string,
    prompt: string,
    selection?: {
      attachments?: AgentDispatchRequest['attachments']
      displayPrompt?: string
      effort?: string
      evidencePath?: string
      imagePaths?: string[]
      model?: string
      toolScope?: AgentConversationThread['toolScope']
    }
  ): Promise<AgentDispatchReceipt> {
    const thread = this.state.requireThread(threadId)
    const session = this.state.sessions.get(thread.id)
    if (session?.aborting === 'stop') throw new Error('This Pi conversation is still stopping.')
    if (!session?.activeJobId) {
      return this.followUp(threadId, prompt, selection)
    }
    const requestedToolScope = selection?.toolScope ?? thread.toolScope ?? 'general'
    if (thread.toolScope && requestedToolScope !== thread.toolScope) {
      throw new Error('This Pi conversation cannot change tool scope; start a new chat instead.')
    }
    if (!thread.toolScope && selection?.toolScope) {
      throw new Error(
        'A running legacy Pi conversation cannot change tool scope; start a new chat.'
      )
    }
    const request = this.validate({
      attachments: selection?.attachments,
      displayPrompt: selection?.displayPrompt,
      effort: thread.effort,
      evidencePath: selection?.evidencePath,
      imagePaths: selection?.imagePaths,
      model: thread.model,
      prompt,
      toolScope: requestedToolScope
    })
    const jobId = session.activeJobId
    const now = new Date().toISOString()
    const messageId = randomUUID()
    const previousRecentUpdate = thread.recentUpdate
    this.cancelPendingUiRequests(session)
    const finalizedStreaming = finalizePiStreamingAssistant(thread, jobId, messageId, now)
    thread.messages.push(createPiUserMessage(request, now, messageId))
    thread.recentUpdate = 'Applying your latest instruction…'
    thread.updatedAt = now
    this.state.persist()
    try {
      const input = await piPromptInputWithEvidence(
        request.prompt,
        request.evidencePath,
        request.imagePaths
      )
      const response = await session.process.command(
        {
          ...input,
          type: 'steer'
        },
        PI_PROMPT_COMMAND_TIMEOUT_MS
      )
      if (!response.success) {
        throw new Error(response.error || 'Pi rejected the steering correction.')
      }
      session.finalResponse = ''
      this.state.persist()
    } catch (error) {
      if (isPiRpcTimeout(error)) {
        session.finalResponse = ''
        this.state.persist()
        return {
          dispatchedAt: new Date().toISOString(),
          jobId,
          state: 'running',
          threadId: thread.id
        }
      }
      const messageIndex = thread.messages.findIndex((message) => message.id === messageId)
      if (messageIndex !== -1) thread.messages.splice(messageIndex, 1)
      if (finalizedStreaming) restorePiStreamingAssistant(thread, jobId, messageId)
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
    const source = this.state.requireThread(threadId)
    const plan = resolvePiForkLaunch(source, request)
    if (plan.idle) return this.forkIdle(source, plan)
    return this.launch(this.validate(plan.request), plan.mode)
  }

  private async forkIdle(
    source: AgentConversationThread,
    plan: PiForkPlan
  ): Promise<AgentDispatchReceipt> {
    const now = new Date().toISOString()
    const selection = validatePiSelection(
      this.models(),
      plan.request.model || source.model,
      plan.request.effort || source.effort
    )
    const thread = createIdleForkThread({
      compactForkPending: plan.mode.kind === 'new',
      effort: selection.effort,
      forkedFromId: plan.forkedFromId,
      messages: plan.seedMessages,
      model: selection.model,
      now,
      recentUpdate: plan.mode.kind === 'fork' ? 'Forked.' : 'Compact-forked.',
      sessionId: null,
      task: source.task,
      toolScope: plan.request.toolScope ?? source.toolScope ?? 'general',
      workerId: this.state.availableWorkerId()
    })
    this.state.threads.push(thread)
    this.state.persist()
    if (plan.mode.kind === 'fork') {
      try {
        await this.ensureSession(
          thread,
          { ...plan.request, ...selection, prompt: source.task || 'Fork' },
          plan.mode
        )
        thread.state = 'completed'
        thread.recentUpdate = 'Forked.'
        thread.updatedAt = new Date().toISOString()
        this.state.persist()
      } catch (error) {
        const detail =
          safeStatusText(error instanceof Error ? error.message : error) || 'Pi could not fork.'
        const index = this.state.threads.findIndex((candidate) => candidate.id === thread.id)
        if (index !== -1) this.state.threads.splice(index, 1)
        this.state.disposeSession(thread.id)
        this.state.persist()
        throw new Error(detail)
      }
    }
    return {
      dispatchedAt: now,
      jobId: randomUUID(),
      state: 'queued',
      threadId: thread.id
    }
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
    this.cancelPendingUiRequests(session)
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
        mode.kind === 'fork'
          ? 'Forking relevant Pi context.'
          : mode.kind === 'new' && mode.forkedFromId
            ? 'Starting a compact-fork.'
            : 'Starting Pi.',
        now,
        this.state.availableWorkerId()
      )
    if (!existing) {
      if (mode.kind !== 'resume' && mode.forkedFromId) thread.forkedFromId = mode.forkedFromId
      this.state.threads.push(thread)
    }
    thread.state = 'running'
    thread.updatedAt = now
    thread.model = request.model
    thread.effort = request.effort
    this.state.jobs.register(jobId, thread.id, 'running')
    this.state.persist()

    try {
      const session = await this.ensureSession(thread, request, mode)
      if (existing) {
        thread.messages.push(createPiUserMessage(request, now))
        this.state.persist()
      }
      await this.startTurn(thread, session, request, jobId, mode)
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
    if (mode.kind === 'new' && request.toolScope !== 'board-worker') {
      const warm = await this.pool.claim()
      if (warm) {
        const adopted = this.adoptWarmProcess(thread, warm)
        if (adopted) return adopted
      }
    }
    return this.spawnSession(thread, request, mode)
  }

  private adoptWarmProcess(thread: AgentConversationThread, warm: PiWarmProcess): PiSession | null {
    this.bindProcess(thread, warm.process)
    if (!warm.process.isAlive) return null
    const session = createPiSession(warm.process, {
      effort: warm.effort,
      model: warm.model
    })
    this.state.sessions.set(thread.id, session)
    thread.sessionId = warm.sessionId
    applyPiStateTelemetry(thread, warm.state)
    thread.canFollowUp = true
    this.state.persist()
    if (!warm.process.isAlive) {
      this.state.sessions.delete(thread.id)
      return null
    }
    return session
  }

  private async spawnSession(
    thread: AgentConversationThread,
    request: ValidatedPiRequest,
    mode: PiLaunch
  ): Promise<PiSession> {
    const launchMode: PiLaunchMode = mode.kind
    const sessionId = mode.kind === 'resume' ? mode.sessionId : thread.id
    const mcpConfigPath =
      request.toolScope === 'board-worker' ? this.boardWorkerMcpConfigPath : this.mcpConfigPath
    if (request.toolScope === 'board-worker' && !mcpConfigPath) {
      throw new Error(
        'Board worker MCP isolation is unavailable; start OpenPencil with a session directory.'
      )
    }
    const args = piRpcArguments({
      effort: request.effort,
      ...(mcpConfigPath ? { mcpConfigPath } : {}),
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
    const session = createPiSession(rpc, {
      effort: request.effort,
      model: request.model
    })
    this.state.sessions.set(thread.id, session)
    try {
      const stateCommand = rpc.command({ type: 'get_state' })
      const statsCommand = mode.kind === 'new' ? null : rpc.command({ type: 'get_session_stats' })
      const state = await stateCommand
      if (!state.success) throw new Error(state.error || 'Pi RPC session is unavailable.')
      if (isRecord(state.data) && typeof state.data.sessionId === 'string') {
        thread.sessionId = state.data.sessionId
      }
      applyPiStateTelemetry(thread, state.data)
      if (statsCommand) {
        const stats = await statsCommand
        if (stats.success) applyPiSessionStats(thread, stats.data)
      }
      if (mode.kind !== 'new') {
        await this.reconcileSession(thread, session, `session:${thread.id}`)
      }
      thread.canFollowUp = true
      this.state.persist()
      return session
    } catch (error) {
      this.state.disposeSession(thread.id)
      throw error
    }
  }

  private bindProcess(thread: AgentConversationThread, rpc: PiRpcProcess): void {
    rpc.bind({
      onEvent: (event) => this.handleEvent(thread.id, rpc, event),
      onExit: (code, signal, stderr) => this.handleExit(thread.id, rpc, code, signal, stderr)
    })
  }

  private async startTurn(
    thread: AgentConversationThread,
    session: PiSession,
    request: ValidatedPiRequest,
    jobId: string,
    mode: PiLaunch
  ): Promise<void> {
    session.activeJobId = jobId
    session.aborting = null
    session.finalResponse = ''
    session.generationElapsedMs = 0
    session.eventTurnKey = jobId
    session.lastError = ''
    session.lastEventAt = Date.now()
    session.lastProbeAt = null
    session.lastToolError = ''
    session.lastTurnUsage = null
    session.probeInFlight = false
    session.recovering = false
    session.settling = false
    this.state.clearIdleUnload(thread.id)
    thread.state = 'running'
    thread.model = request.model
    thread.effort = request.effort
    thread.recentUpdate = 'Pi is running.'
    thread.updatedAt = new Date().toISOString()
    this.state.jobs.register(jobId, thread.id, 'running')
    this.state.persist()

    const prompt =
      request.toolScope === 'board-worker' && mode.kind !== 'resume'
        ? boardWorkerPrompt(request.prompt)
        : request.prompt
    const inputPromise = piPromptInputWithEvidence(prompt, request.evidencePath, request.imagePaths)
    if (session.configuredModel !== request.model) {
      const { model, provider } = parsePiModelId(request.model)
      const modelResponse = await session.process.command({
        modelId: model,
        provider,
        type: 'set_model'
      })
      if (!modelResponse.success)
        throw new Error(modelResponse.error || 'Pi rejected the selected model.')
      applyPiStateTelemetry(thread, modelResponse.data)
      session.configuredModel = request.model
    }
    if (piThinkingLevel(session.configuredEffort) !== piThinkingLevel(request.effort)) {
      const thinkingResponse = await session.process.command({
        level: piThinkingLevel(request.effort),
        type: 'set_thinking_level'
      })
      if (!thinkingResponse.success) {
        throw new Error(thinkingResponse.error || 'Pi rejected the selected thinking level.')
      }
      session.configuredEffort = request.effort
    }
    session.antigravityUsageCursor = request.model.startsWith('antigravity/')
      ? await (this.config.captureAntigravityUsageCursor ?? captureAntigravityUsageCursor)(
          this.piSessionIds(thread)
        )
      : null
    const input = await inputPromise
    session.lastEventAt = Date.now()
    this.state.armHeartbeat(
      thread,
      (now) => this.watchdog.tick(thread, session, now),
      this.watchdog.intervalMs
    )
    this.deliverPromptCommand(thread, session, jobId, input)
  }

  private deliverPromptCommand(
    thread: AgentConversationThread,
    session: PiSession,
    jobId: string,
    input: PiPromptInput
  ): void {
    void (async () => {
      try {
        const promptResponse = await session.process.command(
          {
            ...input,
            type: 'prompt'
          },
          PI_PROMPT_COMMAND_TIMEOUT_MS
        )
        if (!promptResponse.success) {
          throw new Error(promptResponse.error || 'Pi rejected the prompt.')
        }
      } catch (error) {
        if (isPiRpcTimeout(error)) return
        if (this.state.sessions.get(thread.id) !== session) return
        if (session.activeJobId !== jobId) return
        const detail =
          safeStatusText(error instanceof Error ? error.message : error) ||
          'Pi rejected the prompt.'
        this.failTurn(thread, jobId, detail)
      }
    })()
  }

  private handleEvent(threadId: string, process: PiRpcProcess, event: PiRpcRecord): void {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    const session = this.state.sessions.get(threadId)
    if (!thread || !session || session.process !== process) return
    session.lastEventAt = Date.now()
    session.lastProbeAt = null
    if (event.type === 'extension_ui_request') {
      this.handleExtensionUi(thread, session, event)
      return
    }
    const turnKey = session.activeJobId ?? session.eventTurnKey ?? `session:${thread.id}`
    const applied = applyPiEvent(thread, event, turnKey)
    const telemetryApplied = applyPiEventTelemetry(thread, session, event)
    capturePiOutcome(session, event)
    if (applied || telemetryApplied) {
      thread.updatedAt = new Date().toISOString()
      this.state.schedulePersist()
    }
    if (event.type === 'agent_settled') void this.settleTurnFromSession(thread, session)
  }

  private async settleTurnFromSession(
    thread: AgentConversationThread,
    session: PiSession
  ): Promise<void> {
    if (session.settling) return
    session.settling = true
    try {
      const turnKey = session.activeJobId ?? session.eventTurnKey ?? `session:${thread.id}`
      await this.reconcileSession(thread, session, turnKey)
      await this.applySettledAntigravityUsage(thread, session)
      await this.appendUsageLedger(thread, session)
      this.settleTurn(thread, session)
    } finally {
      session.settling = false
    }
  }

  private async applySettledAntigravityUsage(
    thread: AgentConversationThread,
    session: PiSession
  ): Promise<void> {
    const cursor = session.antigravityUsageCursor
    session.antigravityUsageCursor = null
    if (!cursor) return
    const usage = await (this.config.readAntigravityTurnUsage ?? readAntigravityTurnUsage)(
      this.piSessionIds(thread),
      cursor
    )
    if (!usage) return
    applyMeasuredAntigravityUsage(thread, usage, session.generationElapsedMs)
    session.lastTurnUsage = {
      source: 'agy-sqlite',
      tokens: {
        cacheRead: usage.cacheRead,
        cacheWrite: 0,
        input: usage.input,
        output: usage.output,
        reasoning: usage.reasoning
      }
    }
  }

  private async appendUsageLedger(
    thread: AgentConversationThread,
    session: PiSession
  ): Promise<void> {
    const captured = session.lastTurnUsage
    const tokens = captured?.tokens ?? emptyUsageTokens()
    const usageSource =
      captured?.source ?? (thread.contextUsage?.tokensEstimated === true ? 'estimated' : 'pi-event')
    await appendUsageTurnBestEffort(
      buildLiveUsageTurn(thread, {
        at: new Date().toISOString(),
        sessionId: thread.sessionId,
        tokens,
        usageSource
      })
    )
  }

  private piSessionIds(thread: AgentConversationThread): string[] {
    return thread.sessionId && thread.sessionId !== thread.id
      ? [thread.sessionId, thread.id]
      : [thread.id]
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
      this.state.armIdleUnload(thread.id, resolveIdleUnloadMs(), () => {
        this.unloadIdleSession(thread.id)
      })
      return
    }
    if (!jobId) {
      session.aborting = null
      this.state.persist()
      this.state.armIdleUnload(thread.id, resolveIdleUnloadMs(), () => {
        this.unloadIdleSession(thread.id)
      })
      return
    }
    const answer = session.finalResponse.trim() || threadClosingText(thread)
    if (answer) {
      ensureVisibleFinalResponse(thread, answer, now)
      thread.state = 'completed'
      thread.recentUpdate = answer.slice(0, 500)
      this.state.jobs.settle(jobId, 'completed', answer)
    } else {
      thread.state = 'needs_attention'
      thread.recentUpdate =
        session.lastError || session.lastToolError || 'Pi stopped without a final response.'
      this.state.jobs.settle(jobId, 'failed', thread.recentUpdate)
    }
    thread.updatedAt = now
    session.activeJobId = null
    this.state.persist()
    this.state.armIdleUnload(thread.id, resolveIdleUnloadMs(), () => {
      this.unloadIdleSession(thread.id)
    })
  }

  private unloadIdleSession(threadId: string): void {
    const thread = this.state.threads.find((candidate) => candidate.id === threadId)
    const session = this.state.sessions.get(threadId)
    if (!thread || !session || session.activeJobId) return
    this.state.disposeSession(threadId, { graceMs: resolveIdleUnloadGraceMs() })
  }

  private async reconcileSession(
    thread: AgentConversationThread,
    session: PiSession,
    turnKey: string
  ): Promise<void> {
    try {
      const result = await reconcilePiSessionHistory(thread, session.process, turnKey)
      if (result.finalResponse) session.finalResponse = result.finalResponse
      if (result.toolError) session.lastToolError = result.toolError
      if (result.applied || thread.lastPiEntryId) {
        thread.updatedAt = new Date().toISOString()
        this.state.persist()
      }
    } catch (error) {
      session.lastError ||= safeStatusText(error instanceof Error ? error.message : error)
    }
  }

  private async recoverStalledSession(
    thread: AgentConversationThread,
    session: PiSession,
    detail: string
  ): Promise<void> {
    const jobId = session.activeJobId
    if (session.recovering || !jobId || this.state.sessions.get(thread.id) !== session) return
    session.recovering = true
    this.failTurn(thread, jobId, detail)
    try {
      await session.process.command({ type: 'abort' }, 2_000)
    } catch {
      session.process.close()
    }
    this.state.disposeSession(thread.id)
  }

  private withPendingUiRequests(thread: AgentConversationThread): AgentConversationThread {
    const requests = [...(this.state.sessions.get(thread.id)?.pendingUiRequests.values() ?? [])]
    return requests.length
      ? {
          ...thread,
          pendingUiRequests: requests.map((request) => ({
            ...request,
            ...(request.options ? { options: [...request.options] } : {})
          }))
        }
      : thread
  }

  private cancelPendingUiRequests(session: PiSession): void {
    for (const requestId of session.pendingUiRequests.keys()) {
      try {
        session.process.write({ cancelled: true, id: requestId, type: 'extension_ui_response' })
      } catch {
        break
      }
    }
    session.pendingUiRequests.clear()
  }

  private extensionUiRequest(event: PiRpcRecord): AgentExtensionUiRequest | null {
    if (typeof event.id !== 'string' || !event.id.trim() || event.id.length > 512) return null
    const requestedAt = new Date().toISOString()
    const title =
      typeof event.title === 'string' ? event.title.slice(0, 12_000) : 'Approval required'
    if (event.method === 'confirm') {
      return {
        id: event.id,
        ...(typeof event.message === 'string' ? { message: event.message.slice(0, 12_000) } : {}),
        method: 'confirm',
        requestedAt,
        title
      }
    }
    if (event.method !== 'select' || !Array.isArray(event.options)) return null
    const options = event.options
      .filter((option): option is string => typeof option === 'string')
      .slice(0, 12)
      .map((option) => option.slice(0, 500))
    if (!options.length) return null
    return { id: event.id, method: 'select', options, requestedAt, title }
  }

  private validateExtensionUiResponse(
    request: AgentExtensionUiRequest,
    response: AgentExtensionUiResponse
  ): AgentExtensionUiResponse {
    if (response.cancelled === true) return { cancelled: true }
    if (request.method === 'confirm') {
      if (typeof response.confirmed !== 'boolean') {
        throw new TypeError('This approval requires a yes or no response.')
      }
      return { confirmed: response.confirmed }
    }
    if (typeof response.value !== 'string' || !request.options?.includes(response.value)) {
      throw new TypeError('This approval response is not one of the offered choices.')
    }
    return { value: response.value }
  }

  private handleExtensionUi(
    thread: AgentConversationThread,
    session: PiSession,
    event: PiRpcRecord
  ): void {
    if (typeof event.id !== 'string' || !event.id.trim()) return
    if (event.method === 'input' || event.method === 'editor') {
      session.process.write({ cancelled: true, id: event.id, type: 'extension_ui_response' })
      return
    }
    const request = this.extensionUiRequest(event)
    if (!request) {
      session.process.write({ cancelled: true, id: event.id, type: 'extension_ui_response' })
      return
    }
    session.pendingUiRequests.set(request.id, request)
    thread.state = 'needs_attention'
    thread.recentUpdate = 'Waiting for your approval.'
    thread.updatedAt = request.requestedAt
    this.state.clearHeartbeat(thread.id)
    this.state.persist()
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

function warmProcessSelection(config: PiRouterConfig): { effort: string; model: string } {
  const model = config.models?.[0]
  return {
    effort: model?.defaultEffort ?? 'high',
    model: model?.id ?? 'xai-auth/grok-4.6'
  }
}
