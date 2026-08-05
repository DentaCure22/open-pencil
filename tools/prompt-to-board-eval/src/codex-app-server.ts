import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface CodexAppServerTokenUsage {
  cache_write_input_tokens: number
  cached_input_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_output_tokens: number
  total_tokens: number
  uncached_input_tokens: number
}

export interface CodexAppServerNotification {
  method: string
  params: Record<string, unknown>
  raw: Record<string, unknown>
}

export interface CodexAppServerDrainResult {
  post_release_boundary_basis: 'emitted_at_ms_with_observation_fallback'
  post_release_raw_response_count: number
  turn_completed: boolean
  turn_completed_observed_at_ms: number | null
  turn_completed_observed_monotonic_ms: number | null
  turn_status: string | null
  usage: CodexAppServerTokenUsage | null
  usage_unavailable_reason: string | null
}

export interface CodexAppServerStartInput {
  cwd: string
  ephemeral: boolean
  model: string
  outputSchema?: unknown
  prompt: string
  reasoningEffort: 'high' | 'low' | 'medium' | 'xhigh'
  sandbox: 'danger-full-access' | 'read-only' | 'workspace-write'
  serviceTier: 'default' | 'priority'
}

export interface CodexAppServerSessionOptions {
  binary: string
  cwd: string
  env: NodeJS.ProcessEnv
  onNotification?: (notification: CodexAppServerNotification) => Promise<void> | void
  onRawLine?: (line: string) => Promise<void> | void
  onStderrLine?: (line: string) => Promise<void> | void
}

interface RawResponseObservation {
  emitted_at_ms: number | null
  observed_monotonic_ms: number
}

export interface ProjectedCodexJsonEvent {
  [key: string]: unknown
  type: string
}

type CodexAppServerSandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { networkAccess: boolean; type: 'readOnly' }
  | {
      excludeSlashTmp: boolean
      excludeTmpdirEnvVar: boolean
      networkAccess: boolean
      type: 'workspaceWrite'
      writableRoots: string[]
    }

type JsonRecord = Record<string, unknown>

type PendingRequest = {
  reject(error: Error): void
  resolve(result: unknown): void
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function exactUsage(value: unknown): CodexAppServerTokenUsage | null {
  const usage = record(value)
  const inputTokens = nonnegativeInteger(usage?.inputTokens)
  const cachedInputTokens = nonnegativeInteger(usage?.cachedInputTokens)
  const cacheWriteInputTokens = nonnegativeInteger(usage?.cacheWriteInputTokens)
  const outputTokens = nonnegativeInteger(usage?.outputTokens)
  const reasoningOutputTokens = nonnegativeInteger(usage?.reasoningOutputTokens)
  const totalTokens = nonnegativeInteger(usage?.totalTokens)
  if (
    inputTokens === null ||
    cachedInputTokens === null ||
    cachedInputTokens > inputTokens ||
    cacheWriteInputTokens === null ||
    outputTokens === null ||
    reasoningOutputTokens === null ||
    totalTokens === null
  ) {
    return null
  }
  return {
    cache_write_input_tokens: cacheWriteInputTokens,
    cached_input_tokens: cachedInputTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
    total_tokens: totalTokens,
    uncached_input_tokens: inputTokens - cachedInputTokens
  }
}

function notification(value: unknown): CodexAppServerNotification | null {
  const candidate = record(value)
  const method = string(candidate?.method)
  if (!candidate || !method || 'id' in candidate) return null
  return {
    method,
    params: record(candidate.params) ?? {},
    raw: candidate
  }
}

function threadIdFromStart(value: unknown): string | null {
  return string(record(record(value)?.thread)?.id)
}

function turnIdFromStart(value: unknown): string | null {
  return string(record(record(value)?.turn)?.id)
}

function itemFromNotification(value: CodexAppServerNotification): JsonRecord | null {
  return record(value.params.item)
}

function appServerUsageToCodexJson(usage: CodexAppServerTokenUsage): JsonRecord {
  return {
    cache_write_input_tokens: usage.cache_write_input_tokens,
    cached_input_tokens: usage.cached_input_tokens,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    reasoning_output_tokens: usage.reasoning_output_tokens,
    total_tokens: usage.total_tokens,
    uncached_input_tokens: usage.uncached_input_tokens
  }
}

function sandboxPolicy(
  mode: CodexAppServerStartInput['sandbox'],
  cwd: string
): CodexAppServerSandboxPolicy {
  if (mode === 'danger-full-access') return { type: 'dangerFullAccess' }
  if (mode === 'read-only') return { networkAccess: false, type: 'readOnly' }
  return {
    excludeSlashTmp: false,
    excludeTmpdirEnvVar: false,
    networkAccess: false,
    type: 'workspaceWrite',
    writableRoots: [cwd]
  }
}

function sandboxMode(
  mode: CodexAppServerStartInput['sandbox']
): 'danger-full-access' | 'read-only' | 'workspace-write' {
  return mode
}

export function projectCodexAppServerNotification(
  value: CodexAppServerNotification,
  usage: CodexAppServerTokenUsage | null
): ProjectedCodexJsonEvent[] {
  if (value.method === 'thread/started') {
    const threadId = string(record(value.params.thread)?.id) ?? string(value.params.threadId)
    return threadId ? [{ thread_id: threadId, type: 'thread.started' }] : []
  }
  if (value.method === 'turn/started') return [{ type: 'turn.started' }]
  if (value.method === 'turn/completed') {
    return [
      {
        type: 'turn.completed',
        usage: usage ? appServerUsageToCodexJson(usage) : null
      }
    ]
  }
  if (value.method !== 'item/started' && value.method !== 'item/completed') return []
  const item = itemFromNotification(value)
  const itemType = string(item?.type)
  if (!item || !itemType) return []
  const type = value.method === 'item/started' ? 'item.started' : 'item.completed'
  if (itemType === 'agentMessage') {
    return [
      {
        item: {
          id: item.id ?? null,
          text: item.text ?? '',
          type: 'agent_message'
        },
        type
      }
    ]
  }
  if (itemType === 'commandExecution') {
    return [
      {
        item: {
          aggregated_output: item.aggregatedOutput ?? '',
          command: item.command ?? '',
          exit_code: item.exitCode ?? null,
          id: item.id ?? null,
          status: item.status ?? null,
          type: 'command_execution'
        },
        type
      }
    ]
  }
  return []
}

function timeoutPromise(milliseconds: number): Promise<'timeout'> {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), milliseconds))
}

function processExit(child: ChildProcessWithoutNullStreams): Promise<{
  code: number | null
  signal: NodeJS.Signals | null
}> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

export class CodexAppServerSession {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly #onNotification?: CodexAppServerSessionOptions['onNotification']
  readonly #onRawLine?: CodexAppServerSessionOptions['onRawLine']
  readonly #onStderrLine?: CodexAppServerSessionOptions['onStderrLine']
  readonly #pending = new Map<number, PendingRequest>()
  readonly #reader: Promise<void>
  readonly #stderrReader: Promise<void>
  #fatalError: Error | null = null
  #latestUsage: CodexAppServerTokenUsage | null = null
  #nextRequestId = 1
  #postReleaseRawResponseCount = 0
  #rawResponseObservations: RawResponseObservation[] = []
  #releaseBoundaryEpochMs: number | null = null
  #releaseBoundaryMonotonicMs: number | null = null
  #threadId: string | null = null
  #turnCompleted = false
  #turnCompletedObservedAtMs: number | null = null
  #turnCompletedObservedMonotonicMs: number | null = null
  #turnId: string | null = null
  #turnStatus: string | null = null
  #usageRevision = 0
  #wakeDrain: (() => void) | null = null

  constructor(options: CodexAppServerSessionOptions) {
    this.#onNotification = options.onNotification
    this.#onRawLine = options.onRawLine
    this.#onStderrLine = options.onStderrLine
    this.#child = spawn(options.binary, ['app-server', '--listen', 'stdio://'], {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.#exit = processExit(this.#child)
    this.#reader = this.#readStdout()
    this.#stderrReader = this.#readStderr()
  }

  get pid(): number | null {
    return this.#child.pid ?? null
  }

  get latestUsage(): CodexAppServerTokenUsage | null {
    return this.#latestUsage
  }

  get threadId(): string | null {
    return this.#threadId
  }

  get turnId(): string | null {
    return this.#turnId
  }

  async start(input: CodexAppServerStartInput): Promise<{ threadId: string; turnId: string }> {
    await this.#request('initialize', {
      capabilities: { experimentalApi: true, requestAttestation: false },
      clientInfo: {
        name: 'openpencil-prompt-to-board-eval',
        title: 'OpenPencil prompt-to-Board evaluator',
        version: '1'
      }
    })
    this.#notify('initialized')
    const thread = await this.#request('thread/start', {
      approvalPolicy: 'never',
      allowProviderModelFallback: false,
      cwd: input.cwd,
      ephemeral: input.ephemeral,
      experimentalRawEvents: true,
      model: input.model,
      sandbox: sandboxMode(input.sandbox),
      serviceTier: input.serviceTier
    })
    const threadId = threadIdFromStart(thread)
    if (!threadId) throw new Error('Codex app-server thread/start did not return thread.id.')
    this.#threadId = threadId
    const turn = await this.#request('turn/start', {
      cwd: input.cwd,
      effort: input.reasoningEffort,
      input: [{ text: input.prompt, type: 'text' }],
      model: input.model,
      ...(input.outputSchema === undefined ? {} : { outputSchema: input.outputSchema }),
      sandboxPolicy: sandboxPolicy(input.sandbox, input.cwd),
      serviceTier: input.serviceTier,
      threadId
    })
    const turnId = turnIdFromStart(turn)
    if (!turnId) throw new Error('Codex app-server turn/start did not return turn.id.')
    this.#turnId = turnId
    return { threadId, turnId }
  }

  freezeReleaseBoundary(observedAtMs = Date.now(), observedMonotonicMs = performance.now()): void {
    if (this.#releaseBoundaryMonotonicMs !== null) {
      throw new Error('Codex app-server release boundary can only be frozen once.')
    }
    this.#releaseBoundaryEpochMs = observedAtMs
    this.#releaseBoundaryMonotonicMs = observedMonotonicMs
    this.#postReleaseRawResponseCount = this.#rawResponseObservations.filter((response) =>
      response.emitted_at_ms !== null
        ? response.emitted_at_ms >= observedAtMs
        : response.observed_monotonic_ms >= observedMonotonicMs
    ).length
  }

  async waitForTurnCompleted(): Promise<void> {
    while (!this.#turnCompleted && !this.#fatalError) {
      await new Promise<void>((resolve) => {
        this.#wakeDrain = resolve
      })
    }
    if (this.#fatalError) throw this.#fatalError
  }

  async interruptAndDrain(timeoutMs = 1_500): Promise<CodexAppServerDrainResult> {
    const threadId = this.#threadId
    const turnId = this.#turnId
    if (!threadId || !turnId) {
      throw new Error('Codex app-server turn must start before interruption.')
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Codex app-server drain timeout must be a positive integer.')
    }
    const usageRevisionBeforeInterrupt = this.#usageRevision
    await this.#request('turn/interrupt', { threadId, turnId })
    const deadline = performance.now() + timeoutMs
    while (
      (!this.#turnCompleted || this.#usageRevision <= usageRevisionBeforeInterrupt) &&
      performance.now() < deadline
    ) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.#wakeDrain = resolve
        }),
        timeoutPromise(Math.max(1, Math.ceil(deadline - performance.now())))
      ])
    }
    const usage = this.#usageRevision > usageRevisionBeforeInterrupt ? this.#latestUsage : null
    return {
      post_release_boundary_basis: 'emitted_at_ms_with_observation_fallback',
      post_release_raw_response_count: this.#postReleaseRawResponseCount,
      turn_completed: this.#turnCompleted,
      turn_completed_observed_at_ms: this.#turnCompletedObservedAtMs,
      turn_completed_observed_monotonic_ms: this.#turnCompletedObservedMonotonicMs,
      turn_status: this.#turnStatus,
      usage,
      usage_unavailable_reason: usage
        ? null
        : this.#turnCompleted
          ? 'Codex app-server completed the interrupted turn without a final exact thread token usage update.'
          : 'Codex app-server telemetry drain ended before exact thread token usage was observed.'
    }
  }

  async close(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    if (!this.#child.stdin.destroyed) this.#child.stdin.end()
    const graceful = await Promise.race([this.#exit, timeoutPromise(250)])
    if (graceful !== 'timeout') {
      await Promise.all([this.#reader, this.#stderrReader])
      return graceful
    }
    const pid = this.#child.pid
    if (pid) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        // The isolated app-server already exited between the timeout and signal.
      }
    }
    const terminated = await Promise.race([this.#exit, timeoutPromise(750)])
    if (terminated !== 'timeout') {
      await Promise.all([this.#reader, this.#stderrReader])
      return terminated
    }
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // The isolated app-server already exited between the timeout and signal.
      }
    }
    const exit = await Promise.race([this.#exit, timeoutPromise(750)])
    if (exit === 'timeout') throw new Error('Codex app-server did not exit after SIGKILL.')
    await Promise.all([this.#reader, this.#stderrReader])
    return exit
  }

  async #readStdout(): Promise<void> {
    const stdout = createInterface({ input: this.#child.stdout })
    try {
      for await (const line of stdout) {
        await this.#onRawLine?.(line)
        await this.#acceptLine(line)
      }
    } catch (error) {
      this.#fail(error instanceof Error ? error : new Error(String(error)))
    } finally {
      const error = this.#fatalError ?? new Error('Codex app-server stdout closed.')
      this.#fatalError = error
      for (const pending of this.#pending.values()) pending.reject(error)
      this.#pending.clear()
      this.#wakeDrain?.()
    }
  }

  async #readStderr(): Promise<void> {
    const stderr = createInterface({ input: this.#child.stderr })
    for await (const line of stderr) await this.#onStderrLine?.(line)
  }

  async #acceptLine(line: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.#fail(new Error('Codex app-server emitted invalid JSON.'))
      return
    }
    const candidate = record(parsed)
    if (!candidate) {
      this.#fail(new Error('Codex app-server emitted a non-object message.'))
      return
    }
    const serverMethod = string(candidate.method)
    if (serverMethod && 'id' in candidate) {
      this.#write({
        error: {
          code: -32601,
          message: `OpenPencil evaluator does not support app-server request ${serverMethod}.`
        },
        id: candidate.id
      })
      this.#fail(new Error(`Unsupported Codex app-server request: ${serverMethod}.`))
      return
    }
    const id = nonnegativeInteger(candidate.id)
    if (id !== null) {
      const pending = this.#pending.get(id)
      if (!pending) return
      this.#pending.delete(id)
      const rpcError = record(candidate.error)
      if (rpcError) {
        pending.reject(new Error(string(rpcError.message) ?? 'Codex app-server request failed.'))
      } else {
        pending.resolve(candidate.result)
      }
      return
    }
    const observed = notification(candidate)
    if (!observed) return
    this.#observeNotification(observed)
    await this.#onNotification?.(observed)
  }

  #observeNotification(value: CodexAppServerNotification): void {
    const notificationThreadId = string(value.params.threadId)
    const notificationTurnId = string(value.params.turnId) ?? string(record(value.params.turn)?.id)
    const matchesTurn =
      (!this.#threadId || notificationThreadId === this.#threadId) &&
      (!this.#turnId || notificationTurnId === this.#turnId)
    if (value.method === 'rawResponse/completed' && matchesTurn) {
      const observedMonotonicMs = performance.now()
      const emittedAtMs = nonnegativeInteger(value.raw.emittedAtMs)
      this.#rawResponseObservations.push({
        emitted_at_ms: emittedAtMs,
        observed_monotonic_ms: observedMonotonicMs
      })
      if (
        this.#releaseBoundaryEpochMs !== null &&
        this.#releaseBoundaryMonotonicMs !== null &&
        (emittedAtMs !== null
          ? emittedAtMs >= this.#releaseBoundaryEpochMs
          : observedMonotonicMs >= this.#releaseBoundaryMonotonicMs)
      ) {
        this.#postReleaseRawResponseCount += 1
      }
    }
    if (value.method === 'thread/tokenUsage/updated' && matchesTurn) {
      this.#latestUsage = exactUsage(record(value.params.tokenUsage)?.total)
      this.#usageRevision += 1
    }
    if (value.method === 'turn/completed' && matchesTurn) {
      this.#turnCompleted = true
      this.#turnCompletedObservedAtMs = Date.now()
      this.#turnCompletedObservedMonotonicMs = performance.now()
      this.#turnStatus = string(record(value.params.turn)?.status)
    }
    this.#wakeDrain?.()
    this.#wakeDrain = null
  }

  #request(method: string, params: JsonRecord): Promise<unknown> {
    if (this.#fatalError) return Promise.reject(this.#fatalError)
    const id = this.#nextRequestId
    this.#nextRequestId += 1
    const result = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { reject, resolve })
    })
    this.#write({ id, method, params })
    return result
  }

  #notify(method: string, params?: JsonRecord): void {
    this.#write(params ? { method, params } : { method })
  }

  #write(value: JsonRecord): void {
    if (this.#child.stdin.destroyed) {
      this.#fail(new Error('Codex app-server stdin is closed.'))
      return
    }
    this.#child.stdin.write(`${JSON.stringify(value)}\n`)
  }

  #fail(error: Error): void {
    this.#fatalError ??= error
    for (const pending of this.#pending.values()) pending.reject(this.#fatalError)
    this.#pending.clear()
    this.#wakeDrain?.()
  }
}
