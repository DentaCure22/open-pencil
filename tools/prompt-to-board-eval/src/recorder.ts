import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

import {
  CodexAppServerSession,
  projectCodexAppServerNotification,
  type CodexAppServerDrainResult
} from './codex-app-server'
import { CodexStreamProjector } from './codex-stream'
import {
  evaluationConfigIdentity,
  parseEvaluationConfiguration,
  visibleProofSafetyTimeoutMs,
  type EvaluationConfiguration
} from './evaluation-config'
import { dispatchedEvent, EvalLogWriter } from './io'
import { projectOpenPencilResult } from './openpencil-result'
import {
  createStraightThroughReleaseSupervisor,
  type StraightThroughReleaseAcceptance,
  type StraightThroughReleaseSupervisor
} from './release-supervisor'
import { createEvalEvent, type EvalContextInventory, type EvalEvent } from './schema'
import type { StraightThroughRunInput } from './straight-through'
import { buildRecorderContextInventory } from './telemetry'

export interface RecordCodexRunOptions {
  campaignRosterId: string
  codexBinary: string
  configuration: EvaluationConfiguration
  cwd: string
  ephemeral?: boolean
  eventLogPath: string
  openPencilRepo?: string
  onFinalResponseReleased?: (release: {
    observed_at_ms: number
    request_id: string
    target: StraightThroughReleaseAcceptance['plan']['target']
    text: string
  }) => Promise<void> | void
  outputSchemaPath?: string
  proofSafetyTimeoutMs?: number
  prompt: string
  rawCodexLogPath?: string
  recorderId: string
  rubricId: string
  rubricVersion: string
  resumeThreadId?: string
  runId: string
  sandbox?: 'danger-full-access' | 'read-only' | 'workspace-write'
  scenarioFingerprint: string
  scenarioId: string
  skipGitRepoCheck?: boolean
  stderrPath: string
  contextInventory?: EvalContextInventory
  straightThrough?: StraightThroughRunInput
}

export interface RecordCodexRunResult {
  exitCode: number
  status: 'failed' | 'pending_proof' | 'recorded'
  threadId: string | null
}

function reasoningEffort(value: string): 'high' | 'low' | 'medium' | 'xhigh' {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value
  throw new Error(`Unsupported configured reasoning effort: ${value}.`)
}

function serviceTier(value: string): 'default' | 'priority' {
  if (value === 'default' || value === 'priority') return value
  throw new Error(`Unsupported configured service tier: ${value}.`)
}

function sha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 hash.`)
}

function observed() {
  return { epochMs: Date.now(), monotonicMs: performance.now() }
}

function orchestratorEvent(
  options: RecordCodexRunOptions,
  sequence: number,
  kind: EvalEvent['kind'],
  data: Record<string, unknown>
): EvalEvent {
  const time = observed()
  return createEvalEvent({
    data,
    kind,
    observed_at_ms: time.epochMs,
    observed_monotonic_ms: time.monotonicMs,
    precision_ms: 1,
    recorder_id: options.recorderId,
    run_id: options.runId,
    sequence,
    source: 'orchestrator'
  })
}

function eventThreadId(event: EvalEvent): string | null {
  const value = event.data.thread_id
  return event.kind === 'codex_thread_started' && typeof value === 'string' && value.trim()
    ? value
    : null
}

async function appendPendingProof(
  options: RecordCodexRunOptions,
  configuration: Readonly<EvaluationConfiguration>,
  log: EvalLogWriter,
  sequence: number,
  generatedFinal: EvalEvent | null,
  threadId: string | null
): Promise<RecordCodexRunResult> {
  if (!generatedFinal) {
    await log.append(
      orchestratorEvent(options, sequence, 'run_error', {
        code: 'visible_run_missing_generated_final'
      })
    )
    return { exitCode: 1, status: 'failed', threadId }
  }
  const proofSafetyTimeoutMs =
    options.proofSafetyTimeoutMs ?? visibleProofSafetyTimeoutMs(configuration)
  if (!Number.isInteger(proofSafetyTimeoutMs) || proofSafetyTimeoutMs <= 0) {
    throw new Error('proofSafetyTimeoutMs must be a positive integer.')
  }
  const text = typeof generatedFinal.data.text === 'string' ? generatedFinal.data.text : ''
  const expectedTarget = {
    content_document_id: configuration.board.content_document_id,
    document_id: configuration.board.document_id,
    page_id: configuration.board.page_id,
    runtime_instance_id: configuration.board.runtime_instance_id,
    workspace_id: configuration.board.workspace_id
  }
  await log.append(
    orchestratorEvent(options, sequence, 'run_pending_proof', {
      config_id: configuration.config_id,
      expected_target: expectedTarget,
      generated_at_ms: generatedFinal.observed_at_ms,
      generated_event_sequence: generatedFinal.sequence,
      generated_sha256: createHash('sha256').update(text).digest('hex'),
      proof_deadline_at_ms: Date.now() + proofSafetyTimeoutMs,
      proof_safety_timeout_ms: proofSafetyTimeoutMs,
      required_evidence: ['pixel', 'semantic', 'durability']
    })
  )
  return { exitCode: 0, status: 'pending_proof', threadId }
}

async function appendAppServerTurnCompleted(
  options: RecordCodexRunOptions,
  log: EvalLogWriter,
  drain: CodexAppServerDrainResult
): Promise<void> {
  await log.appendGenerated((last) => ({
    events: [
      createEvalEvent({
        data: {
          raw_event: { type: 'turn.completed', usage: drain.usage },
          usage: drain.usage,
          usage_scope: 'codex_thread_total'
        },
        kind: 'codex_turn_completed',
        observed_at_ms: Math.max(
          drain.turn_completed_observed_at_ms ?? Date.now(),
          last.observed_at_ms
        ),
        observed_monotonic_ms: Math.max(
          drain.turn_completed_observed_monotonic_ms ?? performance.now(),
          last.observed_monotonic_ms
        ),
        precision_ms: 1,
        recorder_id: options.recorderId,
        run_id: options.runId,
        sequence: last.sequence + 1,
        source: 'codex'
      })
    ],
    value: undefined
  }))
}

async function appendOrchestratorGenerated(
  options: RecordCodexRunOptions,
  log: EvalLogWriter,
  kind: EvalEvent['kind'],
  data: Record<string, unknown>
): Promise<void> {
  await log.appendGenerated((last) => {
    const time = observed()
    return {
      events: [
        createEvalEvent({
          data,
          kind,
          observed_at_ms: Math.max(time.epochMs, last.observed_at_ms),
          observed_monotonic_ms: Math.max(time.monotonicMs, last.observed_monotonic_ms),
          precision_ms: 1,
          recorder_id: options.recorderId,
          run_id: options.runId,
          sequence: last.sequence + 1,
          source: 'orchestrator'
        })
      ],
      value: undefined
    }
  })
}

async function recordStraightThroughAppServer(
  options: RecordCodexRunOptions,
  configuration: Readonly<EvaluationConfiguration>,
  log: EvalLogWriter,
  rawCodexLogPath: string,
  releaseSupervisor: StraightThroughReleaseSupervisor,
  configuredReasoningEffort: 'high' | 'low' | 'medium' | 'xhigh',
  configuredServiceTier: 'default' | 'priority',
  updateReleaseEligibility: (activeBoardBuild: boolean, disqualified: boolean) => void
): Promise<RecordCodexRunResult> {
  if (configuration.context.ignore_rules || configuration.context.ignore_user_config) {
    throw new Error(
      'Straight-through app-server recording does not support disabled rules or user config.'
    )
  }
  if (options.resumeThreadId) {
    throw new Error('Straight-through app-server recording requires a fresh thread.')
  }

  let activeBoardBuild = false
  let releaseAccepted = false
  let straightThroughDisqualified = false
  let generatedFinal: EvalEvent | null = null
  let threadId: string | null = null
  const rawStreamHash = createHash('sha256')
  let rawStreamBytes = 0
  let rawStreamLines = 0
  const projector = new CodexStreamProjector({
    initialSequence: 3,
    recorderId: options.recorderId,
    runId: options.runId
  })

  const appendProjected = async (lines: readonly string[]) => {
    for (const line of lines) {
      for (const event of projector.projectLine(line)) {
        threadId = eventThreadId(event) ?? threadId
        if (event.kind === 'agent_message_completed') {
          generatedFinal = event
          if (activeBoardBuild) straightThroughDisqualified = true
        }
        if (event.kind === 'run_error') straightThroughDisqualified = true
        if (event.kind === 'openpencil_result' || event.kind === 'durability_confirmed') {
          straightThroughDisqualified = true
        }
        if (event.kind === 'command_started' && event.data.semantic_command) {
          const eligibleBoardBuild =
            event.data.route === 'cli' &&
            event.data.semantic_command === 'build' &&
            !activeBoardBuild &&
            !straightThroughDisqualified
          if (eligibleBoardBuild) activeBoardBuild = true
          else straightThroughDisqualified = true
        }
        if (event.kind === 'command_completed' && activeBoardBuild && !releaseAccepted) {
          straightThroughDisqualified = true
        }
        await log.append(event)
        updateReleaseEligibility(activeBoardBuild, straightThroughDisqualified)
      }
    }
  }

  let session: CodexAppServerSession | null = null
  try {
    session = new CodexAppServerSession({
      binary: options.codexBinary,
      cwd: options.cwd,
      env: {
        ...process.env,
        OPENPENCIL_OUTPUT: process.env.OPENPENCIL_OUTPUT === 'release' ? 'release' : 'json',
        ...releaseSupervisor.env,
        ...(options.openPencilRepo ? { OPENPENCIL_REPO: options.openPencilRepo } : {})
      },
      async onNotification(notification) {
        if (notification.method === 'turn/completed') return
        if (releaseAccepted) return
        const projected = projectCodexAppServerNotification(
          notification,
          session?.latestUsage ?? null
        ).map((event) => JSON.stringify(event))
        await appendProjected(projected)
      },
      async onRawLine(line) {
        const rawLine = `${line}\n`
        await appendFile(rawCodexLogPath, rawLine, 'utf8')
        rawStreamHash.update(rawLine, 'utf8')
        rawStreamBytes += Buffer.byteLength(rawLine, 'utf8')
        rawStreamLines += 1
      },
      async onStderrLine(line) {
        await appendFile(options.stderrPath, `${line}\n`, 'utf8')
      }
    })
    if (!session.pid) throw new Error('Codex app-server did not expose a process PID.')
    releaseSupervisor.attachProcessGroup(session.pid)
    await log.append(
      orchestratorEvent(options, 1, 'process_spawned', {
        machine_output: 'app_server_jsonrpc',
        pid: session.pid
      })
    )
    await log.append(
      orchestratorEvent(options, 2, 'prompt_written', {
        bytes: Buffer.byteLength(options.prompt)
      })
    )
    const outputSchema = options.outputSchemaPath
      ? JSON.parse(await readFile(options.outputSchemaPath, 'utf8'))
      : undefined
    const started = await session.start({
      cwd: options.cwd,
      ephemeral: options.ephemeral ?? false,
      model: configuration.agent.model,
      outputSchema,
      prompt: options.prompt,
      reasoningEffort: configuredReasoningEffort,
      sandbox: options.sandbox ?? 'workspace-write',
      serviceTier: configuredServiceTier
    })
    threadId = started.threadId

    const outcome = await Promise.race([
      releaseSupervisor.acceptance.then((acceptance) => ({ acceptance, kind: 'release' as const })),
      session.waitForTurnCompleted().then(() => ({ kind: 'completed' as const }))
    ])

    if (outcome.kind === 'release' && outcome.acceptance) {
      const acceptance = outcome.acceptance
      releaseAccepted = true
      session.freezeReleaseBoundary(acceptance.observed_at_ms, acceptance.observed_monotonic_ms)
      const projected = projectOpenPencilResult('build', acceptance.envelope)
      if (
        projected.filter(({ kind }) => kind === 'openpencil_result').length !== 1 ||
        projected.filter(({ kind }) => kind === 'durability_confirmed').length !== 1
      ) {
        await appendOrchestratorGenerated(options, log, 'run_error', {
          code: 'straight_through_release_projection_failed'
        })
        await releaseSupervisor.close()
        await session.close()
        return { exitCode: 1, status: 'failed', threadId }
      }

      await log.appendGenerated((last) => {
        let sequence = last.sequence + 1
        let monotonicMs = Math.max(acceptance.observed_monotonic_ms, last.observed_monotonic_ms)
        const observedAtMs = Math.max(acceptance.observed_at_ms, last.observed_at_ms)
        const projectedEvents = projected.map(({ data, kind }) => {
          const event = createEvalEvent({
            data,
            kind,
            observed_at_ms: observedAtMs,
            observed_monotonic_ms: monotonicMs,
            precision_ms: 1,
            recorder_id: options.recorderId,
            run_id: options.runId,
            sequence,
            source: 'openpencil'
          })
          sequence += 1
          monotonicMs += 0.001
          return event
        })
        const released = createEvalEvent({
          data: {
            final_origin: acceptance.plan.final_origin,
            release_summary: acceptance.plan.release_summary,
            request_id: acceptance.plan.request_id,
            target: acceptance.plan.target,
            text: acceptance.plan.text,
            telemetry_capture: 'pending_turn_interrupt'
          },
          kind: 'final_response_released',
          observed_at_ms: observedAtMs,
          observed_monotonic_ms: monotonicMs,
          precision_ms: 1,
          recorder_id: options.recorderId,
          run_id: options.runId,
          sequence,
          source: 'orchestrator'
        })
        return { events: [...projectedEvents, released], value: undefined }
      })
      await options.onFinalResponseReleased?.({
        observed_at_ms: acceptance.observed_at_ms,
        request_id: acceptance.plan.request_id,
        target: acceptance.plan.target,
        text: acceptance.plan.text
      })

      const drain = await session.interruptAndDrain()
      await appendAppServerTurnCompleted(options, log, drain)
      if (drain.post_release_raw_response_count > 0) {
        await appendOrchestratorGenerated(options, log, 'run_error', {
          boundary_basis: drain.post_release_boundary_basis,
          code: 'straight_through_post_release_model_response',
          raw_response_count: drain.post_release_raw_response_count
        })
      }
      const exit = await session.close()
      await releaseSupervisor.close()
      await appendOrchestratorGenerated(options, log, 'codex_raw_stream_closed', {
        actual_exit_code: exit.code,
        actual_signal: exit.signal,
        bytes: rawStreamBytes,
        intentional_termination: true,
        line_count: rawStreamLines,
        path: rawCodexLogPath,
        sha256: rawStreamHash.digest('hex'),
        transport: 'app_server_jsonrpc',
        turn_status: drain.turn_status,
        usage_unavailable_reason: drain.usage_unavailable_reason
      })
      const clean = drain.post_release_raw_response_count === 0
      return { exitCode: clean ? 0 : 1, status: clean ? 'recorded' : 'failed', threadId }
    }

    await releaseSupervisor.close()
    const drain: CodexAppServerDrainResult = {
      post_release_boundary_basis: 'emitted_at_ms_with_observation_fallback',
      post_release_raw_response_count: 0,
      turn_completed: true,
      turn_completed_observed_at_ms: Date.now(),
      turn_completed_observed_monotonic_ms: performance.now(),
      turn_status: null,
      usage: session.latestUsage,
      usage_unavailable_reason: session.latestUsage
        ? null
        : 'Codex app-server completed without exact thread token usage.'
    }
    await appendAppServerTurnCompleted(options, log, drain)
    const exit = await session.close()
    await appendOrchestratorGenerated(options, log, 'codex_raw_stream_closed', {
      actual_exit_code: exit.code,
      actual_signal: exit.signal,
      bytes: rawStreamBytes,
      intentional_termination: false,
      line_count: rawStreamLines,
      path: rawCodexLogPath,
      sha256: rawStreamHash.digest('hex'),
      transport: 'app_server_jsonrpc'
    })
    if (configuration.browser.required) {
      return appendPendingProof(
        options,
        configuration,
        log,
        projector.nextSequence + 2,
        generatedFinal,
        threadId
      )
    }
    return { exitCode: 0, status: 'recorded', threadId }
  } catch (error) {
    await appendOrchestratorGenerated(options, log, 'run_error', {
      code: 'codex_app_server_failed',
      message: error instanceof Error ? error.message : String(error)
    })
    await releaseSupervisor.close()
    await session?.close().catch(() => undefined)
    return { exitCode: 1, status: 'failed', threadId }
  }
}

export async function recordCodexRunDetailed(
  options: RecordCodexRunOptions
): Promise<RecordCodexRunResult> {
  const configuration = parseEvaluationConfiguration(options.configuration)
  sha256(options.campaignRosterId, 'campaignRosterId')
  sha256(options.scenarioFingerprint, 'scenarioFingerprint')
  if (!options.scenarioId.trim()) throw new Error('scenarioId must be a non-empty string.')
  const configuredReasoningEffort = reasoningEffort(configuration.agent.reasoning_effort)
  const configuredServiceTier = serviceTier(configuration.agent.service_tier)
  await mkdir(dirname(options.eventLogPath), { recursive: true })
  const rawCodexLogPath =
    options.rawCodexLogPath ?? join(dirname(options.eventLogPath), 'codex-events.raw.jsonl')
  await mkdir(dirname(rawCodexLogPath), { recursive: true })
  const dispatch = observed()
  const contextInventory =
    options.contextInventory ?? buildRecorderContextInventory(options.prompt, configuration)
  const log = await EvalLogWriter.create(
    options.eventLogPath,
    dispatchedEvent(
      options.runId,
      options.recorderId,
      dispatch.epochMs,
      dispatch.monotonicMs,
      options.prompt,
      {
        campaign_roster_id: options.campaignRosterId,
        config: evaluationConfigIdentity(configuration),
        context_inventory: contextInventory,
        grader_version: configuration.evaluator.grader_version,
        rubric_id: options.rubricId,
        rubric_version: options.rubricVersion,
        scenario_fingerprint: options.scenarioFingerprint,
        scenario_id: options.scenarioId,
        source_snapshot: configuration.source
      }
    )
  )
  await writeFile(rawCodexLogPath, '', { encoding: 'utf8', flag: 'wx' })
  const args = [
    'exec',
    '--json',
    '--color',
    'never',
    '--sandbox',
    options.sandbox ?? 'workspace-write',
    '-C',
    options.cwd,
    ...(options.skipGitRepoCheck ? ['--skip-git-repo-check'] : []),
    ...(options.ephemeral ? ['--ephemeral'] : []),
    ...(configuration.context.ignore_user_config ? ['--ignore-user-config'] : []),
    ...(configuration.context.ignore_rules ? ['--ignore-rules'] : []),
    '--model',
    configuration.agent.model,
    '--config',
    `model_reasoning_effort="${configuredReasoningEffort}"`,
    '--config',
    `service_tier="${configuredServiceTier}"`,
    ...(options.outputSchemaPath ? ['--output-schema', options.outputSchemaPath] : []),
    ...(options.resumeThreadId ? ['resume', options.resumeThreadId, '-'] : ['-'])
  ]
  let activeBoardBuild = false
  let straightThroughDisqualified = false
  const releaseSupervisor = options.straightThrough
    ? await createStraightThroughReleaseSupervisor({
        canAccept: () => activeBoardBuild && !straightThroughDisqualified,
        input: options.straightThrough
      }).catch(() => null)
    : null
  if (releaseSupervisor) {
    return recordStraightThroughAppServer(
      options,
      configuration,
      log,
      rawCodexLogPath,
      releaseSupervisor,
      configuredReasoningEffort,
      configuredServiceTier,
      (active, disqualified) => {
        activeBoardBuild = active
        straightThroughDisqualified = disqualified
      }
    )
  }
  const child = spawn(options.codexBinary, args, {
    cwd: options.cwd,
    detached: false,
    env: {
      ...process.env,
      OPENPENCIL_OUTPUT: process.env.OPENPENCIL_OUTPUT === 'release' ? 'release' : 'json',
      ...(options.openPencilRepo ? { OPENPENCIL_REPO: options.openPencilRepo } : {})
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const exitPromise = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
  }>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve({ code, signal }))
  })
  await log.append(
    orchestratorEvent(options, 1, 'process_spawned', {
      machine_output: 'json',
      pid: child.pid ?? null
    })
  )
  child.stdin.end(options.prompt)
  await log.append(
    orchestratorEvent(options, 2, 'prompt_written', { bytes: Buffer.byteLength(options.prompt) })
  )

  let nextSequence = 3
  const projector = new CodexStreamProjector({
    initialSequence: nextSequence,
    recorderId: options.recorderId,
    runId: options.runId
  })
  const stdout = createInterface({ input: child.stdout })
  const stderr = createInterface({ input: child.stderr })
  const stderrTask = (async () => {
    for await (const line of stderr) await appendFile(options.stderrPath, `${line}\n`, 'utf8')
  })()
  let threadId: string | null = null
  let generatedFinal: EvalEvent | null = null
  const rawStreamHash = createHash('sha256')
  let rawStreamBytes = 0
  let rawStreamLines = 0
  for await (const line of stdout) {
    const rawLine = `${line}\n`
    await appendFile(rawCodexLogPath, rawLine, 'utf8')
    rawStreamHash.update(rawLine, 'utf8')
    rawStreamBytes += Buffer.byteLength(rawLine, 'utf8')
    rawStreamLines += 1
    for (const event of projector.projectLine(line)) {
      threadId = eventThreadId(event) ?? threadId
      if (event.kind === 'agent_message_completed') {
        generatedFinal = event
        if (activeBoardBuild) straightThroughDisqualified = true
      }
      if (event.kind === 'run_error') {
        straightThroughDisqualified = true
      }
      if (event.kind === 'openpencil_result' || event.kind === 'durability_confirmed') {
        straightThroughDisqualified = true
      }
      if (event.kind === 'command_started' && event.data.semantic_command) {
        const eligibleBoardBuild =
          event.data.route === 'cli' &&
          event.data.semantic_command === 'build' &&
          !activeBoardBuild &&
          !straightThroughDisqualified
        if (eligibleBoardBuild) activeBoardBuild = true
        else straightThroughDisqualified = true
      }
      if (event.kind === 'command_completed' && activeBoardBuild) {
        straightThroughDisqualified = true
      }
      await log.append(event)
    }
    nextSequence = projector.nextSequence
  }
  const exit = await exitPromise
  await stderrTask
  const exitCode = exit.code ?? 1
  await log.append(
    orchestratorEvent(options, nextSequence, 'codex_raw_stream_closed', {
      bytes: rawStreamBytes,
      line_count: rawStreamLines,
      path: rawCodexLogPath,
      sha256: rawStreamHash.digest('hex')
    })
  )
  nextSequence += 1
  if (exitCode !== 0) {
    await log.append(
      orchestratorEvent(options, nextSequence, 'run_error', {
        code: 'codex_process_failed',
        exit_code: exitCode
      })
    )
    nextSequence += 1
  }
  if (exitCode === 0 && configuration.browser.required) {
    return appendPendingProof(options, configuration, log, nextSequence, generatedFinal, threadId)
  }
  return { exitCode, status: exitCode === 0 ? 'recorded' : 'failed', threadId }
}

export async function recordCodexRun(options: RecordCodexRunOptions): Promise<number> {
  return (await recordCodexRunDetailed(options)).exitCode
}
