import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  EvalLogWriter,
  readEvalEvents,
  type EvalLogAppendSink,
  type EvalLogGeneratedBatch
} from './io'
import { createEvalEvent, parseEvalTarget, type EvalEvent, type EvalTarget } from './schema'

export interface SemanticWitnessOptions {
  eventLogPath: string
  evidencePath: string
  qualityGrade: string
  qualityPassed: boolean
  reviewId: string
  reviewedBy: string
  rubricId: string
  rubricVersion: string
  scenarioId: string
  scenarioVersion: string
  target: EvalTarget
}

function observed() {
  return { epochMs: Date.now(), monotonicMs: performance.now() }
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must be a non-empty string.`)
  return value
}

function dispatchString(data: Record<string, unknown>, field: string): string | null {
  const value = data[field]
  return typeof value === 'string' && value.trim() ? value : null
}

function assertDispatchProvenance(
  dispatch: Record<string, unknown>,
  options: SemanticWitnessOptions
): void {
  const expected = {
    rubric_id: options.rubricId,
    rubric_version: options.rubricVersion,
    scenario_fingerprint: options.scenarioVersion,
    scenario_id: options.scenarioId
  }
  for (const [field, value] of Object.entries(expected)) {
    if (dispatchString(dispatch, field) !== value) {
      throw new Error(`Semantic witness ${field} does not match dispatched provenance.`)
    }
  }
}

async function prepareSemanticWitness(options: SemanticWitnessOptions): Promise<string> {
  const events = await readEvalEvents(options.eventLogPath)
  const first = events.at(0)
  const last = events.at(-1)
  if (!first || !last || first.kind !== 'run_dispatched') {
    throw new Error('Semantic witness requires an existing dispatched eval log.')
  }
  if (events.some((event) => event.kind === 'semantic_review_completed')) {
    throw new Error('Semantic witness is append-once; an existing review cannot be replaced.')
  }
  for (const [label, value] of [
    ['evidencePath', options.evidencePath],
    ['qualityGrade', options.qualityGrade],
    ['reviewId', options.reviewId],
    ['reviewedBy', options.reviewedBy],
    ['rubricId', options.rubricId],
    ['rubricVersion', options.rubricVersion],
    ['scenarioId', options.scenarioId],
    ['scenarioVersion', options.scenarioVersion]
  ] as const) {
    nonEmpty(value, label)
  }
  if (!/^[a-f0-9]{64}$/u.test(options.scenarioVersion)) {
    throw new Error('Semantic witness scenarioVersion must be a SHA-256 scenario fingerprint.')
  }
  assertDispatchProvenance(first.data, options)
  const evidence = await readFile(options.evidencePath)
  return createHash('sha256').update(evidence).digest('hex')
}

function semanticWitnessBatch(
  options: SemanticWitnessOptions,
  last: Readonly<EvalEvent>,
  evidenceSha256: string
): EvalLogGeneratedBatch<string> {
  const time = observed()
  const observedAtMs = Math.max(time.epochMs, last.observed_at_ms)
  const observedMonotonicMs = Math.max(
    time.monotonicMs,
    last.observed_monotonic_ms + Number.EPSILON
  )
  return {
    events: [
      createEvalEvent({
        data: {
          evidence_path: options.evidencePath,
          evidence_sha256: evidenceSha256,
          quality_grade: options.qualityGrade,
          quality_passed: options.qualityPassed,
          review_id: options.reviewId,
          reviewed_by: options.reviewedBy,
          rubric_id: options.rubricId,
          rubric_version: options.rubricVersion,
          scenario_id: options.scenarioId,
          scenario_version: options.scenarioVersion,
          target: parseEvalTarget(options.target)
        },
        kind: 'semantic_review_completed',
        observed_at_ms: observedAtMs,
        observed_monotonic_ms: observedMonotonicMs,
        precision_ms: 1,
        recorder_id: last.recorder_id,
        run_id: last.run_id,
        sequence: last.sequence + 1,
        source: 'reviewer'
      })
    ],
    value: evidenceSha256
  }
}

export async function emitSemanticWitness(
  options: SemanticWitnessOptions,
  sink: EvalLogAppendSink
): Promise<string> {
  const evidenceSha256 = await prepareSemanticWitness(options)
  return sink.appendGenerated((last) => semanticWitnessBatch(options, last, evidenceSha256))
}

export async function appendSemanticWitness(options: SemanticWitnessOptions): Promise<string> {
  const writer = await EvalLogWriter.open(options.eventLogPath)
  return emitSemanticWitness(options, writer)
}
