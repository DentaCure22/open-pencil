import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'

import { classifyEvalSummary, type CampaignAggregate } from './aggregate'
import { summarizeEvalRun } from './measurements'
import {
  createEvalEvent,
  type EvalEvent,
  type EvalRunMetadata,
  type EvalRunRequirements,
  type EvalRunSummary,
  type EvalTarget
} from './schema'

export const EVALUATOR_CANARY_SCHEMA_VERSION = 'prompt-to-board-evaluator-canary/v1' as const

export type EvaluatorCanaryClassification = keyof CampaignAggregate['classifications']

export interface EvaluatorCanaryCase {
  case_id:
    | 'strict-success'
    | 'unstructured-machine-output'
    | 'graph-correct-pixel-failure'
    | 'visible-semantic-failure'
    | 'durability-failure'
    | 'timeout-interruption'
  expected_classification: EvaluatorCanaryClassification
  expected_failures: readonly string[]
  failure_mode: string
  requirements: EvalRunRequirements
}

export interface EvaluatorCanaryObservation {
  case_id: EvaluatorCanaryCase['case_id']
  expected_classification: EvaluatorCanaryClassification
  expected_failures: readonly string[]
  observed_classification: EvaluatorCanaryClassification
  observed_failures: readonly string[]
  passed: boolean
  summary: EvalRunSummary
}

export interface EvaluatorCanaryReport {
  denominator: number
  expected_denominator: number
  gate_passed: boolean
  observations: readonly EvaluatorCanaryObservation[]
  roster_sha256: string
  scale_allowed: boolean
  schema_version: typeof EVALUATOR_CANARY_SCHEMA_VERSION
}

export interface EvaluatorCanaryAttempt extends EvaluatorCanaryReport {
  attempt_id: string
}

export class EvaluatorCanaryGateError extends Error {
  readonly report: EvaluatorCanaryReport

  constructor(report: EvaluatorCanaryReport) {
    const failedCases = report.observations
      .filter((observation) => !observation.passed)
      .map((observation) => observation.case_id)
    super(`Evaluator canary stopped scaling: ${failedCases.join(', ') || 'denominator mismatch'}.`)
    this.name = 'EvaluatorCanaryGateError'
    this.report = report
  }
}

const NO_REQUIREMENTS: EvalRunRequirements = {
  durability: false,
  pixel_witness: false,
  receipt: false,
  recovery: false,
  render_acknowledgement: false,
  semantic_quality: false,
  visual_quality: false
}

const STRICT_REQUIREMENTS: EvalRunRequirements = {
  durability: true,
  pixel_witness: true,
  receipt: true,
  recovery: false,
  render_acknowledgement: false,
  semantic_quality: true,
  visual_quality: false
}

export const EVALUATOR_CANARY_ROSTER: readonly EvaluatorCanaryCase[] = Object.freeze([
  Object.freeze({
    case_id: 'strict-success',
    expected_classification: 'strict_visible_pass',
    expected_failures: Object.freeze([]),
    failure_mode: 'none',
    requirements: Object.freeze({ ...STRICT_REQUIREMENTS })
  }),
  Object.freeze({
    case_id: 'unstructured-machine-output',
    expected_classification: 'invalid',
    expected_failures: Object.freeze([
      'run_error',
      'missing_authoritative_result',
      'missing_exact_target'
    ]),
    failure_mode: 'unstructured_openpencil_cli_output',
    requirements: Object.freeze({ ...NO_REQUIREMENTS })
  }),
  Object.freeze({
    case_id: 'graph-correct-pixel-failure',
    expected_classification: 'invalid',
    expected_failures: Object.freeze(['missing_pixel_witness']),
    failure_mode: 'pixel_unavailable',
    requirements: Object.freeze({ ...STRICT_REQUIREMENTS })
  }),
  Object.freeze({
    case_id: 'visible-semantic-failure',
    expected_classification: 'invalid',
    expected_failures: Object.freeze(['semantic_quality_failed']),
    failure_mode: 'semantic_content_mismatch',
    requirements: Object.freeze({ ...STRICT_REQUIREMENTS })
  }),
  Object.freeze({
    case_id: 'durability-failure',
    expected_classification: 'invalid',
    expected_failures: Object.freeze(['missing_durability_confirmation']),
    failure_mode: 'durability_not_current',
    requirements: Object.freeze({ ...NO_REQUIREMENTS, durability: true, receipt: true })
  }),
  Object.freeze({
    case_id: 'timeout-interruption',
    expected_classification: 'invalid',
    expected_failures: Object.freeze(['missing_final_response', 'run_error']),
    failure_mode: 'agent_timeout',
    requirements: Object.freeze({ ...NO_REQUIREMENTS })
  })
])

const SYNTHETIC_TARGET: EvalTarget = Object.freeze({
  content_document_id: 'canary-content-document',
  document_id: 'canary-runtime-document',
  page_id: 'canary-page',
  runtime_instance_id: 'canary-runtime',
  workspace_id: 'canary-workspace'
})

const SCREENSHOT_HASH = 'a'.repeat(64)

function rosterHash(): string {
  return createHash('sha256').update(JSON.stringify(EVALUATOR_CANARY_ROSTER)).digest('hex')
}

function scenarioVersion(canary: EvaluatorCanaryCase): string {
  return createHash('sha256').update(`evaluator-canary:${canary.case_id}`).digest('hex')
}

function metadata(canary: EvaluatorCanaryCase): EvalRunMetadata {
  return {
    config: {
      config_id: rosterHash(),
      measurement_class: 'open_ended_cold'
    },
    expected_outcome: 'artifact_success',
    prompt: `Synthetic evaluator canary: ${canary.case_id}.`,
    provenance: {
      rubric_id: 'evaluator-canary-rubric',
      rubric_version: '1',
      scenario_version: scenarioVersion(canary)
    },
    requirements: { ...canary.requirements },
    run_id: `canary-${canary.case_id}`,
    scenario_id: canary.case_id
  }
}

function event(
  canary: EvaluatorCanaryCase,
  sequence: number,
  kind: EvalEvent['kind'],
  source: EvalEvent['source'],
  data: Record<string, unknown> = {}
): EvalEvent {
  return createEvalEvent({
    data,
    kind,
    observed_at_ms: 1_000 + sequence,
    observed_monotonic_ms: 1_000 + sequence,
    precision_ms: 1,
    recorder_id: 'evaluator-canary',
    run_id: `canary-${canary.case_id}`,
    sequence,
    source
  })
}

function successfulEvents(canary: EvaluatorCanaryCase): EvalEvent[] {
  return [
    event(canary, 0, 'run_dispatched', 'orchestrator', {
      prompt: canary.case_id,
      rubric_id: 'evaluator-canary-rubric',
      rubric_version: '1',
      scenario_fingerprint: scenarioVersion(canary),
      scenario_id: canary.case_id
    }),
    event(canary, 1, 'command_started', 'codex', {
      command: 'openpencil board build --json',
      item_id: 'board-build',
      semantic_command: 'board_build'
    }),
    event(canary, 2, 'command_completed', 'codex', {
      exit_code: 0,
      item_id: 'board-build'
    }),
    event(canary, 3, 'openpencil_result', 'openpencil', {
      mutation_state: 'applied',
      owner_id: 'canary-owner',
      request_id: 'canary-request',
      target: SYNTHETIC_TARGET
    }),
    event(canary, 4, 'pixel_witness_captured', 'browser', {
      artifact_visible: true,
      screenshot_path: '/synthetic/canary.png',
      screenshot_sha256: SCREENSHOT_HASH,
      target: SYNTHETIC_TARGET
    }),
    event(canary, 5, 'semantic_review_completed', 'reviewer', {
      evidence_path: '/synthetic/semantic-review.json',
      evidence_sha256: 'b'.repeat(64),
      quality_grade: 'pass',
      quality_passed: true,
      review_id: `canary-review-${canary.case_id}`,
      reviewed_by: 'evaluator-canary',
      rubric_id: 'evaluator-canary-rubric',
      rubric_version: '1',
      scenario_id: canary.case_id,
      scenario_version: scenarioVersion(canary),
      target: SYNTHETIC_TARGET
    }),
    event(canary, 6, 'durability_confirmed', 'openpencil', {
      current: true,
      target: SYNTHETIC_TARGET
    }),
    event(canary, 7, 'agent_message_completed', 'codex', { text: 'Done.' })
  ]
}

function eventsFor(canary: EvaluatorCanaryCase): EvalEvent[] {
  const events = successfulEvents(canary)
  if (canary.case_id === 'strict-success') return events
  if (canary.case_id === 'unstructured-machine-output') {
    return [
      events[0],
      events[1],
      events[2],
      event(canary, 3, 'run_error', 'orchestrator', {
        code: 'unstructured_openpencil_cli_output'
      }),
      event(canary, 4, 'agent_message_completed', 'codex', { text: 'Could not parse result.' })
    ]
  }
  if (canary.case_id === 'graph-correct-pixel-failure') {
    return events
      .filter((candidate) => candidate.kind !== 'pixel_witness_captured')
      .map((candidate, sequence) =>
        event(canary, sequence, candidate.kind, candidate.source, candidate.data)
      )
  }
  if (canary.case_id === 'visible-semantic-failure') {
    return events.map((candidate) =>
      candidate.kind === 'semantic_review_completed'
        ? event(canary, candidate.sequence, candidate.kind, candidate.source, {
            ...candidate.data,
            quality_passed: false,
            reason: 'semantic_content_mismatch'
          })
        : candidate
    )
  }
  if (canary.case_id === 'durability-failure') {
    return events.map((candidate) =>
      candidate.kind === 'durability_confirmed'
        ? event(canary, candidate.sequence, candidate.kind, candidate.source, {
            ...candidate.data,
            current: false
          })
        : candidate
    )
  }
  return [
    events[0],
    events[1],
    events[2],
    events[3],
    event(canary, 4, 'run_error', 'orchestrator', { code: 'agent_timeout' })
  ]
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left.toSorted()) === JSON.stringify(right.toSorted())
}

export function buildEvaluatorCanarySummaries(): readonly EvalRunSummary[] {
  return EVALUATOR_CANARY_ROSTER.map((canary) =>
    summarizeEvalRun(eventsFor(canary), metadata(canary))
  )
}

export function evaluateEvaluatorCanary(
  summaries: readonly EvalRunSummary[]
): EvaluatorCanaryReport {
  const observations = EVALUATOR_CANARY_ROSTER.map((canary, index) => {
    const summary = summaries[index]
    if (!summary) {
      return {
        case_id: canary.case_id,
        expected_classification: canary.expected_classification,
        expected_failures: canary.expected_failures,
        observed_classification: 'invalid' as const,
        observed_failures: ['missing_canary_summary'],
        passed: false,
        summary: summarizeEvalRun([], metadata(canary))
      }
    }
    const observedClassification = classifyEvalSummary(summary)
    return {
      case_id: canary.case_id,
      expected_classification: canary.expected_classification,
      expected_failures: canary.expected_failures,
      observed_classification: observedClassification,
      observed_failures: summary.failures,
      passed:
        summary.metadata.scenario_id === canary.case_id &&
        observedClassification === canary.expected_classification &&
        sameStrings(summary.failures, canary.expected_failures),
      summary
    }
  })
  const denominatorMatches = summaries.length === EVALUATOR_CANARY_ROSTER.length
  const gatePassed = denominatorMatches && observations.every((observation) => observation.passed)
  return {
    denominator: summaries.length,
    expected_denominator: EVALUATOR_CANARY_ROSTER.length,
    gate_passed: gatePassed,
    observations,
    roster_sha256: rosterHash(),
    scale_allowed: gatePassed,
    schema_version: EVALUATOR_CANARY_SCHEMA_VERSION
  }
}

export function requireEvaluatorCanaryGate(report: EvaluatorCanaryReport): void {
  if (!report.gate_passed || !report.scale_allowed) throw new EvaluatorCanaryGateError(report)
}

export async function writeEvaluatorCanaryAttempt(
  path: string,
  attemptId: string,
  report: EvaluatorCanaryReport
): Promise<void> {
  if (!attemptId.trim()) throw new Error('Evaluator canary attempt_id must be non-empty.')
  const attempt: EvaluatorCanaryAttempt = { ...report, attempt_id: attemptId }
  await writeFile(path, `${JSON.stringify(attempt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
}

export async function runEvaluatorCanaryAttempt(
  path: string,
  attemptId: string
): Promise<EvaluatorCanaryReport> {
  const report = evaluateEvaluatorCanary(buildEvaluatorCanarySummaries())
  await writeEvaluatorCanaryAttempt(path, attemptId, report)
  requireEvaluatorCanaryGate(report)
  return report
}
