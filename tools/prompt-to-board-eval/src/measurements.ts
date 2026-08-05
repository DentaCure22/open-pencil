import {
  EVAL_SUMMARY_SCHEMA_VERSION,
  parseEvalTarget,
  type EvalEvent,
  type EvalRunMetadata,
  type EvalRunSummary,
  type EvalTarget
} from './schema'

function firstTime(events: EvalEvent[], kind: EvalEvent['kind']): number | null {
  return events.find((event) => event.kind === kind)?.observed_at_ms ?? null
}

function pixelTime(event: EvalEvent | undefined): number | null {
  const visibleAt = event?.data.visible_at_ms
  if (
    typeof visibleAt === 'number' &&
    Number.isInteger(visibleAt) &&
    visibleAt >= 0 &&
    visibleAt <= (event?.observed_at_ms ?? -1)
  ) {
    return visibleAt
  }
  return event?.observed_at_ms ?? null
}

function duration(start: number | null, end: number | null): number | null {
  return start === null || end === null ? null : end - start
}

function sameTarget(left: EvalTarget, right: EvalTarget): boolean {
  return (
    left.content_document_id === right.content_document_id &&
    left.document_id === right.document_id &&
    left.page_id === right.page_id &&
    left.runtime_instance_id === right.runtime_instance_id &&
    left.workspace_id === right.workspace_id
  )
}

function targetsDiffer(targets: EvalTarget[]): boolean {
  const first = targets.at(0)
  return first === undefined
    ? false
    : targets.slice(1).some((candidate) => !sameTarget(candidate, first))
}

function eventTarget(event: EvalEvent): EvalTarget | null {
  if (!event.data.target) return null
  try {
    return parseEvalTarget(event.data.target)
  } catch {
    return null
  }
}

function commandExecutionTotal(events: EvalEvent[]): number | null {
  const starts = new Map<string, number>()
  let total = 0
  let pairs = 0
  for (const event of events) {
    const itemId = typeof event.data.item_id === 'string' ? event.data.item_id : null
    if (!itemId) continue
    if (event.kind === 'command_started') starts.set(itemId, event.observed_at_ms)
    if (event.kind !== 'command_completed') continue
    const startedAt = starts.get(itemId)
    if (startedAt === undefined || event.observed_at_ms < startedAt) continue
    total += event.observed_at_ms - startedAt
    pairs += 1
  }
  return pairs > 0 ? total : null
}

function booleanData(event: EvalEvent | undefined, field: string): boolean {
  return event?.data[field] === true
}

function stringData(event: EvalEvent | undefined, field: string): string | null {
  const value = event?.data[field]
  return typeof value === 'string' && value.trim() ? value : null
}

function numberData(event: EvalEvent | undefined, field: string): number | null {
  const value = event?.data[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonEmptyStringMapData(event: EvalEvent | undefined, field: string): boolean {
  const value = event?.data[field]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return (
    entries.length > 0 &&
    entries.every(
      ([key, item]) => Boolean(key.trim()) && typeof item === 'string' && Boolean(item.trim())
    )
  )
}

function validateSequence(events: EvalEvent[], failures: string[]): void {
  let previousSequence = -1
  let previousTime = -1
  let previousMonotonic = -1
  const recorderIds = new Set<string>()
  for (const event of events) {
    if (event.sequence <= previousSequence) failures.push('event_sequence_not_strictly_increasing')
    if (event.observed_at_ms < previousTime) failures.push('event_time_moved_backwards')
    if (event.observed_monotonic_ms <= previousMonotonic) {
      failures.push('event_monotonic_time_not_strictly_increasing')
    }
    recorderIds.add(event.recorder_id)
    previousSequence = event.sequence
    previousTime = event.observed_at_ms
    previousMonotonic = event.observed_monotonic_ms
  }
  if (recorderIds.size > 1) failures.push('multiple_recorders_in_one_run')
}

interface RunMilestones {
  authoritative: number | null
  dispatched: number | null
  durable: number | null
  final: number | null
  finalGenerated: number | null
  firstBoardTool: number | null
  firstTool: number | null
  pixel: number | null
  render: number | null
  semanticReview: number | null
}

interface RunEvents {
  durability: EvalEvent | undefined
  pixel: EvalEvent | undefined
  result: EvalEvent | undefined
  review: EvalEvent | undefined
  render: EvalEvent | undefined
  semanticReview: EvalEvent | undefined
}

interface RunWitnesses {
  durability: boolean
  pixel: boolean
  receipt: boolean
  recovery: boolean
  render: boolean
  semanticQuality: boolean
  visualQuality: boolean
}

function relevantEvents(events: EvalEvent[]): RunEvents {
  return {
    durability: events.findLast((event) => event.kind === 'durability_confirmed'),
    pixel: events.find((event) => event.kind === 'pixel_witness_captured'),
    result: events.findLast((event) => event.kind === 'openpencil_result'),
    review: events.find((event) => event.kind === 'visual_review_completed'),
    render: events.find((event) => event.kind === 'render_acknowledged'),
    semanticReview: events.find((event) => event.kind === 'semantic_review_completed')
  }
}

function milestones(events: EvalEvent[], relevant: RunEvents): RunMilestones {
  const finalMessages = events.filter((event) => event.kind === 'agent_message_completed')
  const releasedFinal = events.find((event) => event.kind === 'final_response_released')
  const pendingProof = events.some((event) => event.kind === 'run_pending_proof')
  const firstBoardTool = events.find(
    (event) =>
      event.kind === 'command_started' &&
      typeof event.data.semantic_command === 'string' &&
      event.data.semantic_command.length > 0
  )
  return {
    authoritative: relevant.result?.observed_at_ms ?? null,
    dispatched: firstTime(events, 'run_dispatched'),
    durable: relevant.durability?.observed_at_ms ?? null,
    final:
      releasedFinal?.observed_at_ms ??
      (pendingProof ? null : (finalMessages.at(-1)?.observed_at_ms ?? null)),
    finalGenerated: finalMessages.at(-1)?.observed_at_ms ?? null,
    firstBoardTool: firstBoardTool?.observed_at_ms ?? null,
    firstTool: firstTime(events, 'command_started'),
    pixel: pixelTime(relevant.pixel),
    render: relevant.render?.observed_at_ms ?? null,
    semanticReview: relevant.semanticReview?.observed_at_ms ?? null
  }
}

function exactTarget(events: RunEvents, failures: string[]): EvalTarget | null {
  const targetEvents = [
    events.result,
    events.render,
    events.pixel,
    events.durability,
    events.semanticReview
  ].filter((event): event is EvalEvent => event !== undefined)
  const targets = targetEvents.flatMap((event) => {
    const target = eventTarget(event)
    return target ? [target] : []
  })
  const target = targets[0] ?? null
  if (targetEvents.length > 0 && targets.length !== targetEvents.length) {
    failures.push('missing_exact_target')
  }
  if (targetsDiffer(targets)) failures.push('witness_target_mismatch')
  return target
}

function semanticProvenanceMatches(
  event: EvalEvent | undefined,
  metadata: EvalRunMetadata
): boolean {
  return (
    stringData(event, 'scenario_id') === metadata.scenario_id &&
    stringData(event, 'scenario_version') === metadata.provenance.scenario_version &&
    stringData(event, 'rubric_id') === metadata.provenance.rubric_id &&
    stringData(event, 'rubric_version') === metadata.provenance.rubric_version
  )
}

function witnesses(
  events: EvalEvent[],
  relevant: RunEvents,
  metadata: EvalRunMetadata
): RunWitnesses {
  const pixelHash = stringData(relevant.pixel, 'screenshot_sha256')
  const semanticEvidenceHash = stringData(relevant.semanticReview, 'evidence_sha256')
  return {
    durability: booleanData(relevant.durability, 'current'),
    pixel:
      booleanData(relevant.pixel, 'artifact_visible') &&
      stringData(relevant.pixel, 'screenshot_path') !== null &&
      pixelHash !== null,
    receipt:
      stringData(relevant.result, 'request_id') !== null &&
      (stringData(relevant.result, 'owner_id') !== null ||
        nonEmptyStringMapData(relevant.result, 'owner_ids')),
    recovery: events.some(
      (event) => event.kind === 'recovery_probe_completed' && event.data.passed === true
    ),
    render: booleanData(relevant.render, 'acknowledged'),
    semanticQuality:
      booleanData(relevant.semanticReview, 'quality_passed') &&
      semanticProvenanceMatches(relevant.semanticReview, metadata) &&
      semanticEvidenceHash !== null &&
      /^[a-f0-9]{64}$/u.test(semanticEvidenceHash),
    visualQuality:
      booleanData(relevant.review, 'quality_passed') &&
      pixelHash !== null &&
      stringData(relevant.review, 'screenshot_sha256') === pixelHash
  }
}

function validateCommon(
  events: EvalEvent[],
  metadata: EvalRunMetadata,
  times: RunMilestones,
  failures: string[]
): void {
  if (events.length === 0) failures.push('no_events')
  if (events.some((event) => event.run_id !== metadata.run_id)) failures.push('run_id_mismatch')
  validateSequence(events, failures)
  if (times.dispatched === null) failures.push('missing_prompt_dispatch')
  if (times.final === null) failures.push('missing_final_response')
  if (events.filter((event) => event.kind === 'final_response_released').length > 1) {
    failures.push('multiple_final_responses_released')
  }
  if (events.some((event) => event.kind === 'run_error')) failures.push('run_error')
  if (events.some(isUnsafeEvalCommand)) failures.push('unsafe_raw_eval_path')
}

function isUnsafeEvalCommand(event: EvalEvent): boolean {
  const command = stringData(event, 'command')
  return (
    event.kind === 'command_started' &&
    command !== null &&
    /(?:openpencil-cli\.sh|bun\s+open-pencil|openpencil)\s+eval\b/.test(command)
  )
}

function validateArtifactSuccess(
  metadata: EvalRunMetadata,
  relevant: RunEvents,
  target: EvalTarget | null,
  times: RunMilestones,
  proof: RunWitnesses,
  failures: string[]
): void {
  if (times.authoritative === null) failures.push('missing_authoritative_result')
  if (!target) failures.push('missing_exact_target')
  if (metadata.requirements.receipt && !proof.receipt) failures.push('missing_receipt')
  if (metadata.requirements.pixel_witness && !proof.pixel) failures.push('missing_pixel_witness')
  if (metadata.requirements.durability && !proof.durability) {
    failures.push('missing_durability_confirmation')
  }
  if (metadata.requirements.semantic_quality) {
    validateSemanticReview(metadata, relevant.semanticReview, proof, failures)
  }
  if (metadata.requirements.recovery && !proof.recovery) failures.push('missing_recovery_proof')
  validateArtifactOrdering(times, failures)
}

function validateSemanticReview(
  metadata: EvalRunMetadata,
  review: EvalEvent | undefined,
  proof: RunWitnesses,
  failures: string[]
): void {
  if (!review) {
    failures.push('missing_semantic_quality_review')
    return
  }
  if (!semanticProvenanceMatches(review, metadata)) {
    failures.push('semantic_review_provenance_mismatch')
    return
  }
  const evidenceHash = stringData(review, 'evidence_sha256')
  if (evidenceHash === null || !/^[a-f0-9]{64}$/u.test(evidenceHash)) {
    failures.push('semantic_review_evidence_invalid')
    return
  }
  if (!proof.semanticQuality) failures.push('semantic_quality_failed')
}

function validateArtifactOrdering(times: RunMilestones, failures: string[]): void {
  if (times.authoritative !== null && times.pixel !== null && times.authoritative > times.pixel) {
    failures.push('visible_before_authoritative_result')
  }
  if (times.pixel !== null && times.final !== null && times.pixel > times.final) {
    failures.push('final_before_pixel_witness')
  }
  if (times.durable !== null && times.final !== null && times.durable > times.final) {
    failures.push('final_before_durability_confirmation')
  }
  if (times.semanticReview !== null && times.final !== null && times.semanticReview > times.final) {
    failures.push('final_before_semantic_review')
  }
}

function hasUnchangedBoardEvidence(event: EvalEvent | undefined): boolean {
  const revisionBefore = numberData(event, 'revision_before')
  const revisionAfter = numberData(event, 'revision_after')
  const hashBefore = stringData(event, 'content_hash_before')
  const hashAfter = stringData(event, 'content_hash_after')
  return (
    revisionBefore !== null &&
    revisionBefore === revisionAfter &&
    hashBefore !== null &&
    hashBefore === hashAfter
  )
}

function validateSafeStop(result: EvalEvent | undefined, failures: string[]): void {
  if (result?.data.mutation_state !== 'not_applied') failures.push('safe_stop_mutated_board')
  if (!hasUnchangedBoardEvidence(result)) failures.push('safe_stop_missing_unchanged_board_proof')
}

export function summarizeEvalRun(events: EvalEvent[], metadata: EvalRunMetadata): EvalRunSummary {
  const failures: string[] = []
  const relevant = relevantEvents(events)
  const times = milestones(events, relevant)
  validateCommon(events, metadata, times, failures)
  const target = exactTarget(relevant, failures)
  const proof = witnesses(events, relevant, metadata)

  if (metadata.expected_outcome === 'artifact_success') {
    validateArtifactSuccess(metadata, relevant, target, times, proof, failures)
  } else {
    validateSafeStop(relevant.result, failures)
  }

  return {
    failures: [...new Set(failures)],
    metadata,
    milestones: {
      authoritative_result_at_ms: times.authoritative,
      durability_confirmed_at_ms: times.durable,
      final_response_observed_at_ms: times.final,
      final_response_generated_at_ms: times.finalGenerated,
      first_board_tool_started_at_ms: times.firstBoardTool,
      first_tool_started_at_ms: times.firstTool,
      pixel_witness_at_ms: times.pixel,
      prompt_dispatched_at_ms: times.dispatched,
      render_acknowledged_at_ms: times.render,
      semantic_review_at_ms: times.semanticReview
    },
    schema_version: EVAL_SUMMARY_SCHEMA_VERSION,
    target,
    timings_ms: {
      command_execution_total: commandExecutionTotal(events),
      prompt_to_authoritative: duration(times.dispatched, times.authoritative),
      prompt_to_final: duration(times.dispatched, times.final),
      prompt_to_final_generation: duration(times.dispatched, times.finalGenerated),
      prompt_to_first_board_tool: duration(times.dispatched, times.firstBoardTool),
      prompt_to_first_tool: duration(times.dispatched, times.firstTool),
      prompt_to_semantic_review: duration(times.dispatched, times.semanticReview),
      prompt_to_visible: duration(times.dispatched, times.pixel)
    },
    valid: failures.length === 0,
    witnesses: {
      durability: proof.durability,
      pixel: proof.pixel,
      receipt: proof.receipt,
      render: proof.render,
      semantic_quality: proof.semanticQuality,
      visual_quality: proof.visualQuality
    }
  }
}
