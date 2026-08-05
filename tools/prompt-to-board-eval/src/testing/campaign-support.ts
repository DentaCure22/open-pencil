import { createHash, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type {
  CampaignExecutor,
  CampaignExecutorInput,
  CampaignRunPlan,
  CampaignVisibleEvidenceContext
} from '../campaign'
import { createEvaluationConfiguration } from '../evaluation-config'
import { dispatchedEvent, EvalLogWriter, type EvalLogAppendSink } from '../io'
import type { PromptToBoardScenario, ScenarioManifest } from '../scenario-manifest'
import { createEvalEvent, type EvalEvent, type EvalTarget } from '../schema'

export function scenario(scenarioId: string, sessionMode: 'fresh' | 'warm') {
  return {
    expected_outcome: 'artifact_success' as const,
    lineage: {
      family_id: `family-${scenarioId}`,
      optimization_exposure: 'allowed' as const,
      origin: 'human' as const,
      parent_scenario_ids: [],
      source_record_ids: [`source-${scenarioId}`],
      transform: null
    },
    modalities: ['native_card' as const],
    prompt: `Build ${scenarioId}`,
    rubric: { rubric_id: 'campaign-test-rubric', version: '1' },
    scenario_id: scenarioId,
    session_mode: sessionMode,
    split: 'dev' as const,
    target_policy: {
      fixture_ref: `fixture-${scenarioId}`,
      kind: 'exact_fixture' as const,
      target_substitution: 'forbidden' as const
    },
    visibility: 'optional' as const
  }
}

export function manifest(...scenarios: PromptToBoardScenario[]): ScenarioManifest {
  return {
    manifest_id: 'campaign-test',
    revision: 1,
    scenarios,
    schema_version: 'prompt-to-board-scenario-manifest/v1'
  }
}

export function target(pageId: string): EvalTarget {
  return {
    content_document_id: 'content-document-1',
    document_id: 'document-1',
    page_id: pageId,
    runtime_instance_id: 'runtime-1',
    workspace_id: 'workspace-1'
  }
}

export function configuration(
  sessionMode: 'fresh' | 'warm',
  exactTarget: EvalTarget,
  browserRequired = true
) {
  return createEvaluationConfiguration({
    agent: { model: 'gpt-test', reasoning_effort: 'low', service_tier: 'default' },
    assistance: {
      context: 'pre_scoped',
      modality: 'agent_selected',
      placement: 'agent_selected',
      prompt: 'natural',
      provided_recipe_sha256: null,
      recipe: 'none',
      target: 'provided_exact'
    },
    board: {
      content_document_id: exactTarget.content_document_id,
      density: 'sparse',
      document_id: exactTarget.document_id,
      fixture_hash: `fixture-${exactTarget.page_id}`,
      page_id: exactTarget.page_id,
      reset_policy: 'fixture-reset-v1',
      revision: 1,
      runtime_instance_id: exactTarget.runtime_instance_id,
      workspace_id: exactTarget.workspace_id
    },
    browser: {
      engine: browserRequired ? 'chromium' : 'none',
      profile_state: browserRequired ? ('fresh' as const) : ('not_applicable' as const),
      required: browserRequired,
      version: browserRequired ? 'test' : 'not-applicable',
      viewport: browserRequired ? { height: 900, width: 1200 } : null
    },
    context: {
      cwd_mode: 'isolated',
      ignore_rules: false,
      ignore_user_config: true,
      rules_hash: 'rules-hash',
      user_config_hash: 'ignored-user-config'
    },
    evaluator: { grader_version: 'pixel-grader/v1', version: 'evaluator/v1' },
    measurement_class: sessionMode === 'fresh' ? 'assisted_cold' : 'assisted_warm',
    prompt_tooling: {
      prompt_template_hash: 'prompt-template-hash',
      skill_bundle_hash: 'skill-bundle-hash',
      tool_build_hash: 'tool-build-hash',
      tool_contract_version: 'board-tools/v1'
    },
    retry: { agent_turn_limit: 8, board_retry_policy: 'same-request-id', max_retries: 1 },
    source: {
      commit: 'abc123',
      dirty: false,
      dirty_diff_hash: 'clean-tree-hash',
      dirty_files: []
    }
  })
}

type TestRunPlan = Omit<CampaignRunPlan, 'configuration'>

export function options(
  scenarios: ScenarioManifest,
  runs: TestRunPlan[],
  executor: CampaignExecutor
) {
  const scenariosById = new Map(
    scenarios.scenarios.map((candidate) => [candidate.scenario_id, candidate])
  )
  return {
    codexBinary: 'codex',
    cwd: '/workspace',
    executor,
    manifest: scenarios,
    maxConcurrency: 2,
    outputDir: join(tmpdir(), `openpencil-campaign-${randomUUID()}`),
    recorderId: 'campaign-test',
    runs: runs.map((run) => {
      const candidateTarget = run.exact_target ?? target('page-A')
      const sessionMode = scenariosById.get(run.scenario_id)?.session_mode ?? 'fresh'
      return { ...run, configuration: configuration(sessionMode, candidateTarget) }
    })
  }
}

function runEvent(
  input: CampaignExecutorInput,
  sequence: number,
  kind: EvalEvent['kind'],
  data: Record<string, unknown>,
  source: EvalEvent['source'] = 'openpencil'
): EvalEvent {
  return createEvalEvent({
    data,
    kind,
    observed_at_ms: Date.now() + sequence,
    observed_monotonic_ms: performance.now() + sequence,
    precision_ms: 1,
    recorder_id: input.recorderId,
    run_id: input.runId,
    sequence,
    source
  })
}

async function writePendingRunState(
  input: CampaignExecutorInput,
  recoveredRunError: boolean,
  requestId = input.boardRequestId
) {
  const exactTarget = input.exactTarget
  if (!exactTarget) throw new Error('Expected exact target in campaign test.')
  await mkdir(dirname(input.eventLogPath), { recursive: true })
  const now = Date.now()
  const writer = await EvalLogWriter.create(
    input.eventLogPath,
    dispatchedEvent(input.runId, input.recorderId, now, performance.now(), input.prompt, {
      campaign_roster_id: input.campaignRosterId,
      config: {
        config_id: input.configuration.config_id,
        measurement_class: input.configuration.measurement_class
      },
      grader_version: input.configuration.evaluator.grader_version,
      rubric_id: input.rubricId,
      rubric_version: input.rubricVersion,
      scenario_fingerprint: input.scenarioFingerprint,
      scenario_id: input.scenarioId,
      source_snapshot: input.configuration.source
    })
  )
  const text = `Completed ${input.runId}`
  const generatedSequence = recoveredRunError ? 5 : 4
  const agentEvent = runEvent(
    input,
    generatedSequence,
    'agent_message_completed',
    { text },
    'codex'
  )
  for (const event of [
    runEvent(input, 1, 'openpencil_result', {
      owner_id: `owner-${input.runId}`,
      request_id: requestId,
      target: exactTarget
    }),
    runEvent(input, 2, 'render_acknowledged', {
      acknowledged: true,
      target: exactTarget
    }),
    runEvent(input, 3, 'durability_confirmed', {
      current: true,
      request_id: requestId,
      target: exactTarget
    }),
    ...(recoveredRunError
      ? [runEvent(input, 4, 'run_error', { code: 'recoverable_tool_error' }, 'codex')]
      : []),
    agentEvent,
    runEvent(
      input,
      generatedSequence + 1,
      'run_pending_proof',
      {
        config_id: input.configuration.config_id,
        expected_target: exactTarget,
        generated_at_ms: agentEvent.observed_at_ms,
        generated_event_sequence: generatedSequence,
        generated_sha256: createHash('sha256').update(text).digest('hex'),
        proof_deadline_at_ms: now + 60_000,
        required_evidence: ['pixel', 'semantic', 'durability']
      },
      'orchestrator'
    )
  ]) {
    await writer.append(event)
  }
  return { exitCode: 0, status: 'pending_proof' as const, threadId: `thread-${input.runId}` }
}

export async function writePendingRun(input: CampaignExecutorInput) {
  return writePendingRunState(input, false)
}

export async function writePendingRunWithRecoveredError(input: CampaignExecutorInput) {
  return writePendingRunState(input, true)
}

export async function writePendingRunWithWrongRequest(input: CampaignExecutorInput) {
  return writePendingRunState(input, false, 'wrong-request-id')
}

export async function appendPassingEvidence(
  context: CampaignVisibleEvidenceContext,
  sink: EvalLogAppendSink
): Promise<void> {
  const screenshotHash = createHash('sha256').update(`pixels:${context.run_id}`).digest('hex')
  const semanticHash = createHash('sha256').update(`semantic:${context.run_id}`).digest('hex')
  await sink.appendGenerated((last) => ({
    events: [
      createEvalEvent({
        data: {
          artifact_visible: true,
          screenshot_path: `/tmp/${context.run_id}.png`,
          screenshot_sha256: screenshotHash,
          target: context.exact_target,
          visible_at_ms: Date.now()
        },
        kind: 'pixel_witness_captured',
        observed_at_ms: Math.max(Date.now(), last.observed_at_ms),
        observed_monotonic_ms: last.observed_monotonic_ms + 1,
        precision_ms: 1,
        recorder_id: last.recorder_id,
        run_id: last.run_id,
        sequence: last.sequence + 1,
        source: 'browser'
      }),
      createEvalEvent({
        data: {
          evidence_sha256: semanticHash,
          quality_passed: true,
          rubric_id: context.rubric_id,
          rubric_version: context.rubric_version,
          scenario_id: context.scenario_id,
          scenario_version: context.scenario_fingerprint,
          target: context.exact_target
        },
        kind: 'semantic_review_completed',
        observed_at_ms: Math.max(Date.now(), last.observed_at_ms + 1),
        observed_monotonic_ms: last.observed_monotonic_ms + 2,
        precision_ms: 1,
        recorder_id: last.recorder_id,
        run_id: last.run_id,
        sequence: last.sequence + 2,
        source: 'reviewer'
      })
    ],
    value: undefined
  }))
}
