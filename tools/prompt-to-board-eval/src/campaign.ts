import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { recordCampaignExecutorFailure } from './campaign-log'
import {
  asEvalContextInventory,
  contextComponentInventory,
  type ContextComponentInventory
} from './context-components'
import {
  measurementSession,
  parseEvaluationConfiguration,
  visibleProofSafetyTimeoutMs,
  type EvaluationConfiguration
} from './evaluation-config'
import type { EvalLogAppendSink } from './io'
import { recordCodexRunDetailed, type RecordCodexRunResult } from './recorder'
import {
  campaignBoardRequestId,
  campaignPromptParts,
  sameEvalTarget,
  type CampaignBoardRequestIdentity,
  type CampaignPromptParts
} from './request-identity'
import { parseCampaignRunPlans, type CampaignRunPlan } from './run-plan'
import {
  parseScenarioManifest,
  scenarioFingerprint,
  type PromptToBoardScenario,
  type ScenarioManifest
} from './scenario-manifest'
import { parseEvalTarget, type EvalContextInventory, type EvalTarget } from './schema'
import type { StraightThroughRunInput } from './straight-through'
import { evalRunTelemetryArtifactPath, persistEvalRunTelemetryArtifact } from './telemetry'
import { finalizeVisibleRun } from './visible-finalizer'

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const CAMPAIGN_ROSTER_SCHEMA_VERSION = 'prompt-to-board-campaign-roster/v3' as const
export { parseCampaignRunPlans }
export type { CampaignRunPlan }

export interface CampaignExecutorInput {
  boardRequestId: string | null
  campaignRosterId: string
  codexBinary: string
  configuration: EvaluationConfiguration
  contextInventory: EvalContextInventory
  cwd: string
  ephemeral?: boolean
  eventLogPath: string
  exactTarget: EvalTarget | null
  openPencilRepo?: string
  outputSchemaPath?: string
  prompt: string
  recorderId: string
  recoveryOfRunId: string | null
  requestScopeRunId: string | null
  rubricId: string
  rubricVersion: string
  resumeThreadId?: string
  runId: string
  sandbox?: 'danger-full-access' | 'read-only' | 'workspace-write'
  scenarioFingerprint: string
  scenarioId: string
  skipGitRepoCheck?: boolean
  stderrPath: string
  straightThroughInput: StraightThroughRunInput | null
}

export type CampaignExecutor = (input: CampaignExecutorInput) => Promise<RecordCodexRunResult>

export interface CampaignVisibleEvidenceContext {
  readonly board_request_id: string | null
  readonly configuration: Readonly<EvaluationConfiguration>
  readonly event_log_path: string
  readonly exact_target: Readonly<EvalTarget>
  readonly rubric_id: string
  readonly rubric_version: string
  readonly request_scope_run_id: string | null
  readonly run_id: string
  readonly scenario_fingerprint: string
  readonly scenario_id: string
}

export type CampaignVisibleEvidenceCollector = (
  context: CampaignVisibleEvidenceContext,
  sink: EvalLogAppendSink
) => Promise<void>

export interface CampaignVisibleProof {
  collect: CampaignVisibleEvidenceCollector
}

export interface ExecuteCampaignOptions {
  allowPendingVisibleProof?: boolean
  codexBinary: string
  cwd: string
  ephemeral?: boolean
  executor?: CampaignExecutor
  manifest: ScenarioManifest
  maxConcurrency: number
  outputDir: string
  openPencilRepo?: string
  outputSchemaPath?: string
  recorderId: string
  rosterPath?: string
  runs: CampaignRunPlan[]
  sandbox?: 'danger-full-access' | 'read-only' | 'workspace-write'
  skipGitRepoCheck?: boolean
  straightThrough?: boolean
  visibleProof?: CampaignVisibleProof
}

export type CampaignRunStatus = 'failed' | 'finalized' | 'pending_proof' | 'recorded' | 'skipped'

export interface CampaignRunResult {
  board_request_id: string | null
  campaign_roster_id: string
  config_id: string
  error: string | null
  event_log_path: string
  exit_code: number | null
  order: number
  resume_thread_id: string | null
  run_id: string
  scenario_id: string
  status: CampaignRunStatus
  stderr_path: string
  telemetry_artifact_path: string | null
  thread_id: string | null
}

interface PreparedRun {
  boardRequestIdentity: CampaignBoardRequestIdentity | null
  configuration: EvaluationConfiguration
  contextComponents: ContextComponentInventory
  exactTarget: EvalTarget | null
  eventLogPath: string
  order: number
  promptParts: CampaignPromptParts
  recoveryOfRunId: string | null
  runId: string
  scenario: PromptToBoardScenario
  scenarioFingerprint: string
  stderrPath: string
  targetKey: string | null
  warmSessionId: string | null
}

export interface CampaignRoster {
  configurations: EvaluationConfiguration[]
  manifest: {
    manifest_id: string
    revision: number
    schema_version: ScenarioManifest['schema_version']
  }
  roster_id: string
  runs: Array<{
    config_id: string
    board_request_identity: CampaignBoardRequestIdentity | null
    context_components: ContextComponentInventory
    event_log_path: string
    exact_target: EvalTarget | null
    expected_outcome: PromptToBoardScenario['expected_outcome']
    order: number
    run_id: string
    scenario_fingerprint: string
    scenario_id: string
    session_mode: PromptToBoardScenario['session_mode']
    split: PromptToBoardScenario['split']
    stderr_path: string
    warm_session_id: string | null
  }>
  schema_version: typeof CAMPAIGN_ROSTER_SCHEMA_VERSION
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)])
  )
}

function contentHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

export function campaignRosterId(roster: Omit<CampaignRoster, 'roster_id'>): string {
  return contentHash(roster)
}

function targetKey(target: EvalTarget): string {
  return [
    target.runtime_instance_id,
    target.workspace_id,
    target.document_id,
    target.content_document_id,
    target.page_id
  ].join('\u0000')
}

function assertTargetMatchesConfiguration(
  runId: string,
  target: EvalTarget | null,
  configuration: EvaluationConfiguration
): void {
  if (!target) return
  const configured = configuration.board
  if (
    target.runtime_instance_id !== configured.runtime_instance_id ||
    target.workspace_id !== configured.workspace_id ||
    target.document_id !== configured.document_id ||
    target.content_document_id !== configured.content_document_id ||
    target.page_id !== configured.page_id
  ) {
    throw new Error(`Campaign run ${runId} exact target does not match its frozen configuration.`)
  }
}

function validateRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Campaign run_id must be path-safe: ${runId}.`)
  }
}

function validateRunPolicy(
  options: ExecuteCampaignOptions,
  run: CampaignRunPlan,
  scenario: PromptToBoardScenario,
  exactTarget: EvalTarget | null,
  configuration: EvaluationConfiguration
): string | null {
  if (scenario.visibility === 'required' && !configuration.browser.required) {
    throw new Error(
      `Campaign run ${run.run_id} requires visible proof but its frozen configuration is headless.`
    )
  }
  if (
    scenario.visibility === 'required' &&
    !options.visibleProof &&
    !options.allowPendingVisibleProof
  ) {
    throw new Error(
      `Campaign run ${run.run_id} requires a visible proof collector or explicit generation-only opt-in.`
    )
  }
  if (scenario.visibility === 'forbidden' && configuration.browser.required) {
    throw new Error(
      `Campaign run ${run.run_id} forbids visible proof but its frozen configuration requires a browser.`
    )
  }
  if (scenario.expected_outcome === 'artifact_success' && !exactTarget) {
    throw new Error(`Writable campaign run ${run.run_id} requires an exact target.`)
  }

  const warmSessionId = run.warm_session_id?.trim() || null
  const expectedSessionMode = measurementSession(configuration.measurement_class)
  const actualSessionMode = scenario.session_mode === 'fresh' ? 'cold' : 'warm'
  if (actualSessionMode !== expectedSessionMode) {
    throw new Error(
      `Campaign run ${run.run_id} session mode ${scenario.session_mode} conflicts with measurement class ${configuration.measurement_class}.`
    )
  }
  if (scenario.session_mode === 'warm' && !warmSessionId) {
    throw new Error(`Warm campaign run ${run.run_id} requires warm_session_id.`)
  }
  if (scenario.session_mode === 'fresh' && warmSessionId) {
    throw new Error(`Fresh campaign run ${run.run_id} cannot set warm_session_id.`)
  }
  return warmSessionId
}

function recoverySourceForRun(
  runId: string,
  recoveryOfRunId: string | null,
  exactTarget: EvalTarget | null,
  scenario: PromptToBoardScenario,
  preparedByRunId: Map<string, PreparedRun>
): PreparedRun | undefined {
  if (!recoveryOfRunId) return undefined
  const recoverySource = preparedByRunId.get(recoveryOfRunId)
  if (!recoverySource) {
    throw new Error(
      `Campaign recovery run ${runId} must reference an earlier run_id: ${recoveryOfRunId}.`
    )
  }
  if (
    !exactTarget ||
    !recoverySource.exactTarget ||
    !sameEvalTarget(exactTarget, recoverySource.exactTarget)
  ) {
    throw new Error(`Campaign recovery run ${runId} must keep the original exact target.`)
  }
  if (recoverySource.scenarioFingerprint !== scenarioFingerprint(scenario)) {
    throw new Error(`Campaign recovery run ${runId} must keep the original scenario.`)
  }
  return recoverySource
}

function boardRequestIdentityForRun(
  runId: string,
  exactTarget: EvalTarget | null,
  recoveryOfRunId: string | null,
  recoverySource?: PreparedRun
): CampaignBoardRequestIdentity | null {
  if (!exactTarget) return null
  const requestScopeRunId = recoverySource?.boardRequestIdentity?.request_scope_run_id ?? runId
  return {
    board_request_id:
      recoverySource?.boardRequestIdentity?.board_request_id ??
      campaignBoardRequestId(requestScopeRunId, exactTarget),
    recovery_of_run_id: recoveryOfRunId,
    request_scope_run_id: requestScopeRunId
  }
}

function prepareRuns(options: ExecuteCampaignOptions): PreparedRun[] {
  if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
    throw new Error('Campaign maxConcurrency must be a positive integer.')
  }
  if (options.runs.length === 0) throw new Error('Campaign runs must not be empty.')

  const manifest = parseScenarioManifest(options.manifest)
  const scenarios = new Map(manifest.scenarios.map((scenario) => [scenario.scenario_id, scenario]))
  const runIds = new Set<string>()
  const preparedByRunId = new Map<string, PreparedRun>()
  const width = Math.max(3, String(options.runs.length).length)

  return options.runs.map((run, order) => {
    validateRunId(run.run_id)
    if (runIds.has(run.run_id)) throw new Error(`Duplicate campaign run_id: ${run.run_id}.`)
    runIds.add(run.run_id)

    const scenario = scenarios.get(run.scenario_id)
    if (!scenario) throw new Error(`Unknown campaign scenario_id: ${run.scenario_id}.`)
    const exactTarget = run.exact_target ? parseEvalTarget(run.exact_target) : null
    const configuration = parseEvaluationConfiguration(run.configuration)
    assertTargetMatchesConfiguration(run.run_id, exactTarget, configuration)
    const warmSessionId = validateRunPolicy(options, run, scenario, exactTarget, configuration)
    const recoveryOfRunId = run.recovery_of_run_id?.trim() || null
    const recoverySource = recoverySourceForRun(
      run.run_id,
      recoveryOfRunId,
      exactTarget,
      scenario,
      preparedByRunId
    )
    const boardRequestIdentity = boardRequestIdentityForRun(
      run.run_id,
      exactTarget,
      recoveryOfRunId,
      recoverySource
    )

    const promptParts = campaignPromptParts(scenario, exactTarget, boardRequestIdentity)
    const contextComponents = contextComponentInventory({
      configuration,
      parts: promptParts,
      warmSessionId
    })
    const runDirectory = join(
      options.outputDir,
      `${String(order + 1).padStart(width, '0')}-${run.run_id}`
    )
    const prepared = {
      boardRequestIdentity,
      configuration,
      contextComponents,
      exactTarget,
      eventLogPath: join(runDirectory, 'events.jsonl'),
      order,
      promptParts,
      recoveryOfRunId,
      runId: run.run_id,
      scenario,
      scenarioFingerprint: scenarioFingerprint(scenario),
      stderrPath: join(runDirectory, 'stderr.log'),
      targetKey: exactTarget ? targetKey(exactTarget) : null,
      warmSessionId
    }
    preparedByRunId.set(run.run_id, prepared)
    return prepared
  })
}

function createCampaignRoster(manifest: ScenarioManifest, runs: PreparedRun[]): CampaignRoster {
  const configurations = [
    ...new Map(runs.map((run) => [run.configuration.config_id, run.configuration])).values()
  ].sort((left, right) => left.config_id.localeCompare(right.config_id))
  const payload = {
    configurations,
    manifest: {
      manifest_id: manifest.manifest_id,
      revision: manifest.revision,
      schema_version: manifest.schema_version
    },
    runs: runs.map((run) => ({
      board_request_identity: run.boardRequestIdentity,
      config_id: run.configuration.config_id,
      context_components: run.contextComponents,
      event_log_path: run.eventLogPath,
      exact_target: run.exactTarget,
      expected_outcome: run.scenario.expected_outcome,
      order: run.order,
      run_id: run.runId,
      scenario_fingerprint: run.scenarioFingerprint,
      scenario_id: run.scenario.scenario_id,
      session_mode: run.scenario.session_mode,
      split: run.scenario.split,
      stderr_path: run.stderrPath,
      warm_session_id: run.warmSessionId
    })),
    schema_version: CAMPAIGN_ROSTER_SCHEMA_VERSION
  }
  return { ...payload, roster_id: campaignRosterId(payload) }
}

async function writeCampaignRoster(path: string, roster: CampaignRoster): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(roster, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
}

function resultBase(run: PreparedRun, rosterId: string) {
  return {
    board_request_id: run.boardRequestIdentity?.board_request_id ?? null,
    campaign_roster_id: rosterId,
    config_id: run.configuration.config_id,
    event_log_path: run.eventLogPath,
    order: run.order,
    run_id: run.runId,
    scenario_id: run.scenario.scenario_id,
    stderr_path: run.stderrPath
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT')
}

async function persistCompletedTelemetry(
  eventLogPath: string,
  status: CampaignRunStatus
): Promise<string | null> {
  if (status === 'skipped') return null
  if (status === 'pending_proof') return evalRunTelemetryArtifactPath(eventLogPath)
  try {
    return (await persistEvalRunTelemetryArtifact(eventLogPath)).path
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  }
}

async function collectCampaignVisibleProof(
  run: PreparedRun,
  status: RecordCodexRunResult['status'],
  visibleProof: CampaignVisibleProof | undefined,
  executorInput: CampaignExecutorInput
): Promise<{ error: string | null; finalized: boolean }> {
  if (status !== 'pending_proof' || !visibleProof) return { error: null, finalized: false }
  if (!run.exactTarget) {
    return {
      error: await recordCampaignExecutorFailure(
        executorInput,
        'Visible proof requires one frozen exact target.',
        'visible_proof'
      ),
      finalized: false
    }
  }
  try {
    const exactTarget = Object.freeze(parseEvalTarget(structuredClone(run.exactTarget)))
    const context: CampaignVisibleEvidenceContext = Object.freeze({
      board_request_id: run.boardRequestIdentity?.board_request_id ?? null,
      configuration: parseEvaluationConfiguration(structuredClone(run.configuration)),
      event_log_path: run.eventLogPath,
      exact_target: exactTarget,
      rubric_id: run.scenario.rubric.rubric_id,
      rubric_version: run.scenario.rubric.version,
      request_scope_run_id: run.boardRequestIdentity?.request_scope_run_id ?? null,
      run_id: run.runId,
      scenario_fingerprint: run.scenarioFingerprint,
      scenario_id: run.scenario.scenario_id
    })
    await finalizeVisibleRun({
      appendEvidence: (sink) => visibleProof.collect(context, sink),
      eventLogPath: run.eventLogPath,
      expectedConfigId: run.configuration.config_id,
      expectedTarget: exactTarget,
      safetyTimeoutMs: visibleProofSafetyTimeoutMs(run.configuration)
    })
    return { error: null, finalized: true }
  } catch (error) {
    return {
      error: await recordCampaignExecutorFailure(
        executorInput,
        errorMessage(error),
        'visible_proof'
      ),
      finalized: false
    }
  }
}

const defaultExecutor: CampaignExecutor = async (input) =>
  recordCodexRunDetailed({
    campaignRosterId: input.campaignRosterId,
    codexBinary: input.codexBinary,
    configuration: input.configuration,
    contextInventory: input.contextInventory,
    cwd: input.cwd,
    ephemeral: input.ephemeral,
    eventLogPath: input.eventLogPath,
    openPencilRepo: input.openPencilRepo,
    outputSchemaPath: input.outputSchemaPath,
    prompt: input.prompt,
    recorderId: input.recorderId,
    rubricId: input.rubricId,
    rubricVersion: input.rubricVersion,
    resumeThreadId: input.resumeThreadId,
    runId: input.runId,
    sandbox: input.sandbox,
    scenarioFingerprint: input.scenarioFingerprint,
    scenarioId: input.scenarioId,
    skipGitRepoCheck: input.skipGitRepoCheck,
    stderrPath: input.stderrPath,
    straightThrough: input.straightThroughInput ?? undefined
  })

export async function executeCampaign(
  options: ExecuteCampaignOptions
): Promise<CampaignRunResult[]> {
  const manifest = parseScenarioManifest(options.manifest)
  const runs = prepareRuns(options)
  const roster = createCampaignRoster(manifest, runs)
  await writeCampaignRoster(
    options.rosterPath ?? join(options.outputDir, 'campaign-roster.json'),
    roster
  )
  const executor = options.executor ?? defaultExecutor
  const pending = new Set(runs.map(({ order }) => order))
  const activeTargets = new Set<string>()
  const activeWarmSessions = new Set<string>()
  const warmThreadIds = new Map<string, string>()
  const failedWarmSessions = new Set<string>()
  const pendingProofWarmSessions = new Set<string>()
  const results: Array<CampaignRunResult | undefined> = Array.from({ length: runs.length })
  let activeCount = 0
  let activeVisibleProof = false

  const usesVisibleProofLane = (run: PreparedRun): boolean =>
    Boolean(options.visibleProof && run.configuration.browser.required)

  return new Promise((resolve) => {
    const finishRun = (run: PreparedRun): void => {
      if (run.targetKey) activeTargets.delete(run.targetKey)
      if (run.warmSessionId) activeWarmSessions.delete(run.warmSessionId)
      if (usesVisibleProofLane(run)) activeVisibleProof = false
      activeCount -= 1
      schedule()
    }

    const launch = (run: PreparedRun): void => {
      pending.delete(run.order)
      activeCount += 1
      if (run.targetKey) activeTargets.add(run.targetKey)
      if (run.warmSessionId) activeWarmSessions.add(run.warmSessionId)
      if (usesVisibleProofLane(run)) activeVisibleProof = true

      const resumeThreadId = run.warmSessionId
        ? (warmThreadIds.get(run.warmSessionId) ?? null)
        : null
      if (
        run.warmSessionId &&
        (failedWarmSessions.has(run.warmSessionId) ||
          pendingProofWarmSessions.has(run.warmSessionId))
      ) {
        results[run.order] = {
          ...resultBase(run, roster.roster_id),
          error: pendingProofWarmSessions.has(run.warmSessionId)
            ? 'Previous warm-session run is still pending independent proof.'
            : 'Previous warm-session run did not produce a resumable thread.',
          exit_code: null,
          resume_thread_id: resumeThreadId,
          status: 'skipped',
          telemetry_artifact_path: null,
          thread_id: null
        }
        finishRun(run)
        return
      }

      const executorInput: CampaignExecutorInput = {
        boardRequestId: run.boardRequestIdentity?.board_request_id ?? null,
        campaignRosterId: roster.roster_id,
        codexBinary: options.codexBinary,
        configuration: run.configuration,
        contextInventory: asEvalContextInventory(run.contextComponents),
        cwd: options.cwd,
        ephemeral: options.ephemeral,
        eventLogPath: run.eventLogPath,
        exactTarget: run.exactTarget,
        openPencilRepo: options.openPencilRepo,
        outputSchemaPath: options.outputSchemaPath,
        prompt: run.promptParts.full_prompt,
        recorderId: options.recorderId,
        recoveryOfRunId: run.recoveryOfRunId,
        requestScopeRunId: run.boardRequestIdentity?.request_scope_run_id ?? null,
        rubricId: run.scenario.rubric.rubric_id,
        rubricVersion: run.scenario.rubric.version,
        resumeThreadId: resumeThreadId ?? undefined,
        runId: run.runId,
        sandbox: options.sandbox,
        scenarioFingerprint: run.scenarioFingerprint,
        scenarioId: run.scenario.scenario_id,
        skipGitRepoCheck: options.skipGitRepoCheck,
        stderrPath: run.stderrPath,
        straightThroughInput: options.straightThrough
          ? {
              configuration: run.configuration,
              enabled: true,
              exactTarget: run.exactTarget,
              outputSchemaPath: options.outputSchemaPath,
              requestId: run.boardRequestIdentity?.board_request_id ?? null,
              resumeThreadId,
              scenario: run.scenario
            }
          : null
      }
      void executor(executorInput)
        .then(async ({ exitCode, status, threadId }) => {
          const { error: proofError, finalized: proofFinalized } =
            await collectCampaignVisibleProof(run, status, options.visibleProof, executorInput)
          const missingWarmThread = Boolean(run.warmSessionId) && !threadId
          const failed =
            exitCode !== 0 || status === 'failed' || missingWarmThread || proofError !== null
          const pendingProof = !failed && status === 'pending_proof' && !proofFinalized
          const succeeded = !failed && !pendingProof
          let resultStatus: CampaignRunStatus = 'failed'
          if (pendingProof) resultStatus = 'pending_proof'
          else if (proofFinalized) resultStatus = 'finalized'
          else if (succeeded) resultStatus = 'recorded'
          let error = `Codex process exited with code ${exitCode}.`
          if (missingWarmThread) {
            error = 'Warm-session run did not produce a resumable thread.'
          }
          if (proofError) error = `Visible proof failed: ${proofError}`
          if (run.warmSessionId) {
            if (succeeded && threadId) warmThreadIds.set(run.warmSessionId, threadId)
            else if (pendingProof) pendingProofWarmSessions.add(run.warmSessionId)
            else failedWarmSessions.add(run.warmSessionId)
          }
          results[run.order] = {
            ...resultBase(run, roster.roster_id),
            error: failed ? error : null,
            exit_code: exitCode,
            resume_thread_id: resumeThreadId,
            status: resultStatus,
            telemetry_artifact_path: await persistCompletedTelemetry(
              run.eventLogPath,
              resultStatus
            ),
            thread_id: threadId
          }
          return undefined
        })
        .catch(async (error: unknown) => {
          const message = errorMessage(error)
          const retainedError = await recordCampaignExecutorFailure(
            executorInput,
            message,
            'executor'
          )
          if (run.warmSessionId) failedWarmSessions.add(run.warmSessionId)
          results[run.order] = {
            ...resultBase(run, roster.roster_id),
            error: retainedError,
            exit_code: null,
            resume_thread_id: resumeThreadId,
            status: 'failed',
            telemetry_artifact_path: await persistCompletedTelemetry(
              run.eventLogPath,
              'failed'
            ).catch(() => null),
            thread_id: null
          }
          return undefined
        })
        .finally(() => finishRun(run))
    }

    function schedule(): void {
      if (pending.size === 0 && activeCount === 0) {
        resolve(results.filter(Boolean) as CampaignRunResult[])
        return
      }

      for (const run of runs) {
        if (activeCount >= options.maxConcurrency) break
        if (!pending.has(run.order)) continue
        if (
          run.warmSessionId &&
          runs.some(
            (candidate) =>
              candidate.order < run.order &&
              candidate.warmSessionId === run.warmSessionId &&
              pending.has(candidate.order)
          )
        ) {
          continue
        }
        if (run.targetKey && activeTargets.has(run.targetKey)) continue
        if (run.warmSessionId && activeWarmSessions.has(run.warmSessionId)) continue
        if (usesVisibleProofLane(run) && activeVisibleProof) continue
        launch(run)
      }
    }

    schedule()
  })
}
