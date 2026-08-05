import { createHash } from 'node:crypto'
import { open, unlink } from 'node:fs/promises'

import { DEFAULT_VISIBLE_PROOF_SAFETY_TIMEOUT_MS } from './evaluation-config'
import { EvalLogWriter, readEvalEvents, type EvalLogAppendSink } from './io'
import { createEvalEvent, parseEvalTarget, type EvalEvent, type EvalTarget } from './schema'
import { persistEvalRunTelemetryArtifact } from './telemetry'

export const VISIBLE_FINALIZATION_FAILURE_CODES = [
  'already_finalized',
  'config_mismatch',
  'evidence_incomplete',
  'final_generation_mismatch',
  'not_pending_proof',
  'proof_timeout',
  'run_failed',
  'target_mismatch'
] as const

export type VisibleFinalizationFailureCode = (typeof VISIBLE_FINALIZATION_FAILURE_CODES)[number]

export class VisibleFinalizationError extends Error {
  constructor(
    readonly code: VisibleFinalizationFailureCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'VisibleFinalizationError'
  }
}

export interface VisibleFinalizationClock {
  epochMs: number
  monotonicMs: number
}

export interface VisibleFinalizationOptions {
  appendEvidence: (sink: EvalLogAppendSink) => Promise<void>
  clock?: () => VisibleFinalizationClock
  eventLogPath: string
  expectedConfigId: string
  expectedTarget: EvalTarget
  safetyTimeoutMs?: number
}

export interface VisibleFinalizationResult {
  finalText: string
  generatedAtMs: number
  originalProofDeadlineAtMs: number
  releasedAtMs: number
  releasedAfterOriginalDeadlineMs: number
  safetyTimeoutMs: number
}

const TARGET_FIELDS = [
  'runtime_instance_id',
  'workspace_id',
  'document_id',
  'content_document_id',
  'page_id'
] as const satisfies readonly (keyof EvalTarget)[]

function dataString(event: EvalEvent, field: string): string | null {
  const value = event.data[field]
  return typeof value === 'string' && value.trim() ? value : null
}

function dataNumber(event: EvalEvent, field: string): number | null {
  const value = event.data[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sameTarget(left: EvalTarget, right: EvalTarget): boolean {
  return TARGET_FIELDS.every((field) => left[field] === right[field])
}

function exactEventTarget(event: EvalEvent, expected: EvalTarget): void {
  let observed: EvalTarget
  try {
    observed = parseEvalTarget(event.data.target)
  } catch (error) {
    throw new VisibleFinalizationError(
      'target_mismatch',
      `${event.kind} is missing an exact target.`,
      { cause: error }
    )
  }
  if (!sameTarget(expected, observed)) {
    const mismatches = TARGET_FIELDS.filter((field) => expected[field] !== observed[field])
    throw new VisibleFinalizationError(
      'target_mismatch',
      `${event.kind} target mismatch: ${mismatches.join(', ')}.`
    )
  }
}

function exactlyOne(events: EvalEvent[], kind: EvalEvent['kind']): EvalEvent {
  const matches = events.filter((event) => event.kind === kind)
  if (matches.length !== 1) {
    throw new VisibleFinalizationError(
      'evidence_incomplete',
      `Visible finalization requires exactly one ${kind} event; found ${matches.length}.`
    )
  }
  const match = matches[0]
  if (!match) throw new Error('Unreachable empty event match.')
  return match
}

function atLeastOne(events: EvalEvent[], kind: EvalEvent['kind']): EvalEvent[] {
  const matches = events.filter((event) => event.kind === kind)
  if (matches.length === 0) {
    throw new VisibleFinalizationError(
      'evidence_incomplete',
      `Visible finalization requires at least one ${kind} event.`
    )
  }
  return matches
}

function dispatchConfigId(dispatch: EvalEvent): string | null {
  const config = dispatch.data.config
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  const value = Reflect.get(config, 'config_id')
  return typeof value === 'string' ? value : null
}

interface PendingState {
  generated: EvalEvent
  originalDeadlineAtMs: number
  pending: EvalEvent
  safetyDeadlineAtMs: number
  safetyTimeoutMs: number
  target: EvalTarget
}

function validatePending(
  events: EvalEvent[],
  expectedConfigId: string,
  expectedTarget: EvalTarget,
  nowMs: number,
  safetyTimeoutMs: number
): PendingState {
  if (events.some((event) => event.kind === 'final_response_released')) {
    throw new VisibleFinalizationError('already_finalized', 'Visible final was already released.')
  }
  const dispatch = events.at(0)
  if (!dispatch || dispatch.kind !== 'run_dispatched') {
    throw new VisibleFinalizationError('not_pending_proof', 'Run dispatch evidence is missing.')
  }
  const pending = exactlyOne(events, 'run_pending_proof')
  if (events.some((event) => event.kind === 'run_error' && event.sequence > pending.sequence)) {
    throw new VisibleFinalizationError(
      'run_failed',
      'A terminal run error after proof buffering prevents success finalization.'
    )
  }
  const dispatchedConfigId = dispatchConfigId(dispatch)
  const pendingConfigId = dataString(pending, 'config_id')
  if (
    dispatchedConfigId !== expectedConfigId ||
    pendingConfigId !== expectedConfigId ||
    !/^[a-f0-9]{64}$/u.test(expectedConfigId)
  ) {
    throw new VisibleFinalizationError(
      'config_mismatch',
      'Visible finalization config does not match the frozen dispatch.'
    )
  }
  let target: EvalTarget
  try {
    target = parseEvalTarget(pending.data.expected_target)
  } catch (error) {
    throw new VisibleFinalizationError(
      'target_mismatch',
      'Pending proof is missing its exact target.',
      { cause: error }
    )
  }
  if (!sameTarget(target, expectedTarget)) {
    throw new VisibleFinalizationError(
      'target_mismatch',
      'Visible finalization target does not match the frozen pending target.'
    )
  }
  const originalDeadlineAtMs = dataNumber(pending, 'proof_deadline_at_ms')
  if (originalDeadlineAtMs === null) {
    throw new VisibleFinalizationError('not_pending_proof', 'Visible proof deadline is missing.')
  }
  if (!Number.isInteger(safetyTimeoutMs) || safetyTimeoutMs <= 0) {
    throw new Error('safetyTimeoutMs must be a positive integer.')
  }
  const safetyDeadlineAtMs = pending.observed_at_ms + safetyTimeoutMs
  if (nowMs > safetyDeadlineAtMs) {
    throw new VisibleFinalizationError(
      'proof_timeout',
      'Visible proof safety timeout expired without finalization.'
    )
  }
  const generatedSequence = dataNumber(pending, 'generated_event_sequence')
  const generated = events.find(
    (event) => event.sequence === generatedSequence && event.kind === 'agent_message_completed'
  )
  const text = generated?.data.text
  const expectedHash = dataString(pending, 'generated_sha256')
  const generatedAtMs = dataNumber(pending, 'generated_at_ms')
  if (
    !generated ||
    typeof text !== 'string' ||
    generatedAtMs !== generated.observed_at_ms ||
    createHash('sha256').update(text).digest('hex') !== expectedHash
  ) {
    throw new VisibleFinalizationError(
      'final_generation_mismatch',
      'Buffered final does not match the recorded generation.'
    )
  }
  return {
    generated,
    originalDeadlineAtMs,
    pending,
    safetyDeadlineAtMs,
    safetyTimeoutMs,
    target
  }
}

function validateEvidence(events: EvalEvent[], pending: EvalEvent, target: EvalTarget): void {
  const dispatch = events[0]
  if (!dispatch) {
    throw new VisibleFinalizationError('evidence_incomplete', 'Dispatch evidence is missing.')
  }
  const durabilities = atLeastOne(events, 'durability_confirmed')
  const durability = durabilities.at(-1)
  if (!durability) throw new Error('Unreachable empty durability evidence.')
  const pixel = exactlyOne(events, 'pixel_witness_captured')
  const semantic = exactlyOne(events, 'semantic_review_completed')
  for (const event of [...durabilities, pixel, semantic]) exactEventTarget(event, target)
  if (durability.data.current !== true) {
    throw new VisibleFinalizationError('evidence_incomplete', 'Current durability proof must pass.')
  }
  if (pixel.sequence <= pending.sequence || semantic.sequence <= pending.sequence) {
    throw new VisibleFinalizationError(
      'evidence_incomplete',
      'External pixel and semantic evidence must follow pending_proof.'
    )
  }
  const screenshotHash = dataString(pixel, 'screenshot_sha256')
  if (
    pixel.data.artifact_visible !== true ||
    screenshotHash === null ||
    !/^[a-f0-9]{64}$/u.test(screenshotHash)
  ) {
    throw new VisibleFinalizationError(
      'evidence_incomplete',
      'Pixel evidence did not prove the artifact is visible.'
    )
  }
  const evidenceHash = dataString(semantic, 'evidence_sha256')
  if (
    semantic.data.quality_passed !== true ||
    evidenceHash === null ||
    !/^[a-f0-9]{64}$/u.test(evidenceHash) ||
    dataString(semantic, 'rubric_id') !== dataString(dispatch, 'rubric_id') ||
    dataString(semantic, 'rubric_version') !== dataString(dispatch, 'rubric_version') ||
    dataString(semantic, 'scenario_id') !== dataString(dispatch, 'scenario_id') ||
    dataString(semantic, 'scenario_version') !== dataString(dispatch, 'scenario_fingerprint')
  ) {
    throw new VisibleFinalizationError(
      'evidence_incomplete',
      'Semantic-quality evidence did not prove the requested result.'
    )
  }
}

export async function finalizeVisibleRun(
  options: VisibleFinalizationOptions
): Promise<VisibleFinalizationResult> {
  const expectedTarget = parseEvalTarget(options.expectedTarget)
  const clock = options.clock ?? (() => ({ epochMs: Date.now(), monotonicMs: performance.now() }))
  const safetyTimeoutMs = options.safetyTimeoutMs ?? DEFAULT_VISIBLE_PROOF_SAFETY_TIMEOUT_MS
  const lockPath = `${options.eventLogPath}.finalizing`
  let lock
  try {
    lock = await open(lockPath, 'wx')
  } catch (error) {
    throw new VisibleFinalizationError(
      'already_finalized',
      'Another visible finalizer owns this run.',
      { cause: error }
    )
  }
  try {
    const before = await readEvalEvents(options.eventLogPath)
    validatePending(
      before,
      options.expectedConfigId,
      expectedTarget,
      clock().epochMs,
      safetyTimeoutMs
    )
    const writer = await EvalLogWriter.open(options.eventLogPath)
    await options.appendEvidence(writer)
    const afterEvidence = await readEvalEvents(options.eventLogPath)
    const state = validatePending(
      afterEvidence,
      options.expectedConfigId,
      expectedTarget,
      clock().epochMs,
      safetyTimeoutMs
    )
    validateEvidence(afterEvidence, state.pending, state.target)
    const result = await writer.appendGenerated((last) => {
      const observed = clock()
      const releasedAtMs = Math.max(observed.epochMs, last.observed_at_ms)
      const releasedAfterOriginalDeadlineMs = Math.max(0, releasedAtMs - state.originalDeadlineAtMs)
      const text = String(state.generated.data.text ?? '')
      const event = createEvalEvent({
        data: {
          config_id: options.expectedConfigId,
          generated_at_ms: state.generated.observed_at_ms,
          generated_event_sequence: state.generated.sequence,
          generated_sha256: createHash('sha256').update(text).digest('hex'),
          original_proof_deadline_at_ms: state.originalDeadlineAtMs,
          proof_safety_deadline_at_ms: state.safetyDeadlineAtMs,
          proof_safety_timeout_ms: state.safetyTimeoutMs,
          released_at_ms: releasedAtMs,
          released_after_original_deadline_ms: releasedAfterOriginalDeadlineMs,
          target: state.target,
          text
        },
        kind: 'final_response_released',
        observed_at_ms: releasedAtMs,
        observed_monotonic_ms: Math.max(
          observed.monotonicMs,
          last.observed_monotonic_ms + Number.EPSILON
        ),
        precision_ms: 1,
        recorder_id: last.recorder_id,
        run_id: last.run_id,
        sequence: last.sequence + 1,
        source: 'orchestrator'
      })
      return {
        events: [event],
        value: {
          finalText: text,
          generatedAtMs: state.generated.observed_at_ms,
          originalProofDeadlineAtMs: state.originalDeadlineAtMs,
          releasedAfterOriginalDeadlineMs,
          releasedAtMs,
          safetyTimeoutMs: state.safetyTimeoutMs
        }
      }
    })
    await persistEvalRunTelemetryArtifact(options.eventLogPath)
    return result
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}
