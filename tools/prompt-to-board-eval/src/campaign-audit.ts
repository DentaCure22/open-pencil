import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  campaignRosterId,
  type CampaignRoster,
  type CampaignRunResult,
  type CampaignRunStatus
} from './campaign'
import {
  CAMPAIGN_TRUTH_AUDIT_SCHEMA_VERSION,
  type CampaignTruthAuditReport,
  type CampaignTruthDiscrepancy,
  type CampaignTruthObservation,
  type CampaignTruthState
} from './campaign-audit-types'
import { readEvalEvents } from './io'
import { sameEvalTarget } from './request-identity'
import { parseEvalTarget, type EvalEvent } from './schema'
import {
  deriveEvalRunTelemetry,
  evalRunTelemetryArtifactPath,
  readEvalRunTelemetryArtifact
} from './telemetry'

export { CAMPAIGN_TRUTH_AUDIT_SCHEMA_VERSION }
export type {
  CampaignTruthAuditReport,
  CampaignTruthDiscrepancy,
  CampaignTruthObservation,
  CampaignTruthState
} from './campaign-audit-types'

function discrepancy(
  code: CampaignTruthDiscrepancy['code'],
  runId: string,
  detail: string
): CampaignTruthDiscrepancy {
  return { code, detail, run_id: runId }
}

function dispatchDiscrepancies(
  roster: CampaignRoster,
  rosterRun: CampaignRoster['runs'][number],
  events: readonly EvalEvent[]
): CampaignTruthDiscrepancy[] {
  const dispatches = events.filter(({ kind }) => kind === 'run_dispatched')
  const dispatch = dispatches[0]
  if (dispatches.length !== 1 || !dispatch) {
    return [
      discrepancy(
        'dispatch_identity_mismatch',
        rosterRun.run_id,
        `Expected one run_dispatched event; observed ${dispatches.length}.`
      )
    ]
  }
  const config = dispatch.data.config
  const dispatchConfigId =
    config && typeof config === 'object' ? Reflect.get(config, 'config_id') : undefined
  const mismatches = [
    dispatch.run_id === rosterRun.run_id ? null : 'run_id',
    dispatch.data.campaign_roster_id === roster.roster_id ? null : 'campaign_roster_id',
    dispatch.data.scenario_id === rosterRun.scenario_id ? null : 'scenario_id',
    dispatch.data.scenario_fingerprint === rosterRun.scenario_fingerprint
      ? null
      : 'scenario_fingerprint',
    dispatchConfigId === rosterRun.config_id ? null : 'config_id'
  ].filter((value): value is string => value !== null)
  const prompt = dispatch.data.prompt
  if (
    typeof prompt !== 'string' ||
    createHash('sha256').update(prompt, 'utf8').digest('hex') !==
      rosterRun.context_components.full_dispatched_prompt.sha256_utf8 ||
    (typeof prompt === 'string' &&
      Buffer.byteLength(prompt, 'utf8') !==
        rosterRun.context_components.full_dispatched_prompt.utf8_bytes)
  ) {
    mismatches.push('full_dispatched_prompt')
  }
  const boardRequestId = rosterRun.board_request_identity?.board_request_id
  if (
    boardRequestId &&
    (typeof prompt !== 'string' || !prompt.includes(`--request-id ${boardRequestId}`))
  ) {
    mismatches.push('board_request_id_prompt_binding')
  }
  return mismatches.length === 0
    ? []
    : [
        discrepancy(
          'dispatch_identity_mismatch',
          rosterRun.run_id,
          `Dispatch differs from frozen roster: ${mismatches.join(', ')}.`
        )
      ]
}

function targetDiscrepancies(
  rosterRun: CampaignRoster['runs'][number],
  events: readonly EvalEvent[]
): CampaignTruthDiscrepancy[] {
  if (!rosterRun.exact_target) return []
  const mismatches: string[] = []
  for (const event of events) {
    if (!event.data.target) continue
    try {
      if (!sameEvalTarget(parseEvalTarget(event.data.target), rosterRun.exact_target)) {
        mismatches.push(`${event.kind}#${event.sequence}`)
      }
    } catch {
      mismatches.push(`${event.kind}#${event.sequence}`)
    }
  }
  return mismatches.length === 0
    ? []
    : [
        discrepancy(
          'dispatch_identity_mismatch',
          rosterRun.run_id,
          `Evidence target differs from frozen roster: ${mismatches.join(', ')}.`
        )
      ]
}

function boardRequestDiscrepancies(
  rosterRun: CampaignRoster['runs'][number],
  events: readonly EvalEvent[],
  result: CampaignRunResult | null
): CampaignTruthDiscrepancy[] {
  const expected = rosterRun.board_request_identity?.board_request_id
  if (!expected) return []
  const boardEvidence = events.filter(
    ({ kind }) => kind === 'openpencil_result' || kind === 'durability_confirmed'
  )
  const successLike =
    result?.status === 'finalized' ||
    result?.status === 'recorded' ||
    result?.status === 'pending_proof'
  if (
    rosterRun.expected_outcome === 'artifact_success' &&
    successLike &&
    boardEvidence.length === 0
  ) {
    return [
      discrepancy(
        'board_request_identity_mismatch',
        rosterRun.run_id,
        'Successful artifact run has no Board mutation evidence bound to its orchestrator request ID.'
      )
    ]
  }
  const mismatches = boardEvidence
    .filter(({ data }) => data.request_id !== expected)
    .map(({ kind, sequence }) => `${kind}#${sequence}`)
  return mismatches.length === 0
    ? []
    : [
        discrepancy(
          'board_request_identity_mismatch',
          rosterRun.run_id,
          `Board evidence differs from the orchestrator request ID: ${mismatches.join(', ')}.`
        )
      ]
}

function mismatchedFields(checks: ReadonlyArray<readonly [boolean, string]>): string[] {
  return checks.flatMap(([matches, field]) => (matches ? [] : [field]))
}

function resultDiscrepancies(
  roster: CampaignRoster,
  rosterRun: CampaignRoster['runs'][number],
  result: CampaignRunResult
): CampaignTruthDiscrepancy[] {
  const fields = mismatchedFields([
    [result.campaign_roster_id === roster.roster_id, 'campaign_roster_id'],
    [
      result.board_request_id === (rosterRun.board_request_identity?.board_request_id ?? null),
      'board_request_id'
    ],
    [result.config_id === rosterRun.config_id, 'config_id'],
    [result.order === rosterRun.order, 'order'],
    [result.run_id === rosterRun.run_id, 'run_id'],
    [result.scenario_id === rosterRun.scenario_id, 'scenario_id'],
    [result.event_log_path === rosterRun.event_log_path, 'event_log_path'],
    [result.stderr_path === rosterRun.stderr_path, 'stderr_path']
  ])
  const expectedTelemetryPath =
    result.status === 'skipped' ? null : evalRunTelemetryArtifactPath(rosterRun.event_log_path)
  if (result.telemetry_artifact_path !== expectedTelemetryPath) {
    fields.push('telemetry_artifact_path')
  }
  const terminalFields: string[] = []
  const successLike =
    result.status === 'finalized' ||
    result.status === 'recorded' ||
    result.status === 'pending_proof'
  if (successLike && (result.exit_code !== 0 || result.error !== null)) {
    terminalFields.push('success_exit_or_error')
  }
  if (result.status === 'skipped' && (result.exit_code !== null || result.error === null)) {
    terminalFields.push('skipped_exit_or_error')
  }
  if (result.status === 'failed' && result.error === null) terminalFields.push('failed_error')
  fields.push(...terminalFields)
  return fields.length === 0
    ? []
    : [
        discrepancy(
          'result_identity_mismatch',
          rosterRun.run_id,
          `Result differs from frozen roster: ${fields.join(', ')}.`
        )
      ]
}

function isStraightThroughRecorded(
  events: readonly EvalEvent[],
  postBuildMessages: number,
  released: number,
  rawClosures: readonly EvalEvent[]
): boolean {
  return (
    postBuildMessages === 0 &&
    released === 1 &&
    rawClosures.length === 1 &&
    rawClosures[0]?.data.intentional_termination === true &&
    events.filter(
      ({ data, kind }) =>
        kind === 'command_started' && data.semantic_command === 'build' && data.route === 'cli'
    ).length === 1 &&
    events.some(({ kind }) => kind === 'openpencil_result') &&
    events.some(({ kind }) => kind === 'durability_confirmed') &&
    events.find(({ kind }) => kind === 'final_response_released')?.data.final_origin ===
      'board_build_release_summary' &&
    !events.some(
      ({ data, kind }) =>
        kind === 'command_completed' && data.semantic_command === 'build' && data.route === 'cli'
    )
  )
}

type TerminalIssue = 'failed' | 'finalized' | 'pending_proof' | 'recorded' | null

function terminalIssue(
  status: CampaignRunStatus,
  released: number,
  pending: number,
  missingVisibleWitnesses: readonly string[],
  terminalErrors: number,
  ordinaryRecorded: boolean,
  straightThroughRecorded: boolean,
  errors: number
): TerminalIssue {
  switch (status) {
    case 'finalized':
      return released !== 1 ||
        pending !== 1 ||
        missingVisibleWitnesses.length > 0 ||
        terminalErrors > 0
        ? 'finalized'
        : null
    case 'pending_proof':
      return pending !== 1 || released > 0 || terminalErrors > 0 ? 'pending_proof' : null
    case 'failed':
      return errors === 0 ? 'failed' : null
    case 'recorded':
      return (!ordinaryRecorded && !straightThroughRecorded) || pending > 0 || errors > 0
        ? 'recorded'
        : null
    default:
      return null
  }
}

function terminalDiscrepancies(
  runId: string,
  status: CampaignRunStatus,
  events: readonly EvalEvent[]
): CampaignTruthDiscrepancy[] {
  const errors = events.filter(({ kind }) => kind === 'run_error').length
  const pendingEvents = events.filter(({ kind }) => kind === 'run_pending_proof')
  const pending = pendingEvents.length
  const pendingSequence = pendingEvents[0]?.sequence
  const terminalErrors = events.filter(
    ({ kind, sequence }) =>
      kind === 'run_error' && (pendingSequence === undefined || sequence > pendingSequence)
  ).length
  const released = events.filter(({ kind }) => kind === 'final_response_released').length
  const messages = events.filter(({ kind }) => kind === 'agent_message_completed').length
  const rawClosures = events.filter(({ kind }) => kind === 'codex_raw_stream_closed')
  const requiredVisibleWitnesses = [
    'durability_confirmed',
    'pixel_witness_captured',
    'semantic_review_completed'
  ]
  const missingVisibleWitnesses = requiredVisibleWitnesses.filter(
    (kind) => !events.some((event) => event.kind === kind)
  )
  const ordinaryRecorded = messages > 0 && released === 0
  const straightThroughBuildStart = events.find(
    ({ data, kind }) =>
      kind === 'command_started' && data.semantic_command === 'build' && data.route === 'cli'
  )
  const postBuildMessages = straightThroughBuildStart
    ? events.filter(
        ({ kind, sequence }) =>
          kind === 'agent_message_completed' && sequence > straightThroughBuildStart.sequence
      ).length
    : messages
  const straightThroughRecorded = isStraightThroughRecorded(
    events,
    postBuildMessages,
    released,
    rawClosures
  )
  const issue = terminalIssue(
    status,
    released,
    pending,
    missingVisibleWitnesses,
    terminalErrors,
    ordinaryRecorded,
    straightThroughRecorded,
    errors
  )
  if (issue === 'finalized') {
    return [
      discrepancy(
        'finalization_mismatch',
        runId,
        `Finalized result requires one pending marker, durability, pixel, semantic proof, one release, and no post-pending errors; observed pending=${pending}, missing_witnesses=${missingVisibleWitnesses.join(',') || 'none'}, release=${released}, terminal_error=${terminalErrors}, retained_error=${errors}.`
      )
    ]
  }
  if (issue === 'pending_proof') {
    return [
      discrepancy(
        'terminal_event_mismatch',
        runId,
        `Pending proof requires one pending marker and no release/post-pending error; observed pending=${pending}, release=${released}, terminal_error=${terminalErrors}, retained_error=${errors}.`
      )
    ]
  }
  if (issue === 'failed') {
    return [
      discrepancy(
        'terminal_event_mismatch',
        runId,
        'Failed result has no retained run_error event.'
      )
    ]
  }
  if (issue === 'recorded') {
    return [
      discrepancy(
        'terminal_event_mismatch',
        runId,
        `Recorded result requires either one generated model final or one verified straight-through release; observed message=${messages}, post_build_message=${postBuildMessages}, pending=${pending}, release=${released}, raw_close=${rawClosures.length}, error=${errors}.`
      )
    ]
  }
  return []
}

async function readEventsIfPresent(path: string): Promise<EvalEvent[] | null> {
  try {
    return await readEvalEvents(path)
  } catch (error) {
    if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') return null
    throw error
  }
}

async function telemetryDiscrepancies(
  rosterRun: CampaignRoster['runs'][number],
  result: CampaignRunResult,
  state: CampaignTruthState,
  events: readonly EvalEvent[]
): Promise<CampaignTruthDiscrepancy[]> {
  if (state === 'pending_proof' || state === 'skipped') return []
  const path = result.telemetry_artifact_path
  if (!path) {
    return [
      discrepancy(
        'missing_telemetry_artifact',
        rosterRun.run_id,
        'Completed campaign run has no derived telemetry artifact reference.'
      )
    ]
  }
  try {
    const artifact = await readEvalRunTelemetryArtifact(path)
    const source = await readFile(rosterRun.event_log_path, 'utf8')
    const sourceHash = createHash('sha256').update(source).digest('hex')
    const mismatches = [
      artifact.run_id === rosterRun.run_id ? null : 'run_id',
      artifact.source_event_log_path === rosterRun.event_log_path ? null : 'source_event_log_path',
      artifact.source_event_log_sha256 === sourceHash ? null : 'source_event_log_sha256',
      artifact.source_event_count === events.length ? null : 'source_event_count',
      JSON.stringify(artifact.telemetry) === JSON.stringify(deriveEvalRunTelemetry(events))
        ? null
        : 'telemetry'
    ].filter((value): value is string => value !== null)
    return mismatches.length === 0
      ? []
      : [
          discrepancy(
            'telemetry_artifact_mismatch',
            rosterRun.run_id,
            `Derived telemetry differs from immutable raw events: ${mismatches.join(', ')}.`
          )
        ]
  } catch (error) {
    if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT') {
      return [
        discrepancy(
          'missing_telemetry_artifact',
          rosterRun.run_id,
          `Completed campaign telemetry artifact is missing: ${path}.`
        )
      ]
    }
    return [
      discrepancy(
        'telemetry_artifact_mismatch',
        rosterRun.run_id,
        error instanceof Error ? error.message : String(error)
      )
    ]
  }
}

function emptyCounts(): Record<CampaignTruthState, number> {
  return {
    failed: 0,
    finalized: 0,
    interrupted: 0,
    never_started: 0,
    pending_proof: 0,
    recorded: 0,
    skipped: 0,
    unlogged_failure: 0
  }
}

function truthState(
  result: CampaignRunResult | null,
  events: readonly EvalEvent[] | null
): CampaignTruthState {
  if (!result && !events) return 'never_started'
  if (!result && events) return 'interrupted'
  if (result?.status === 'failed' && !events) return 'unlogged_failure'
  if (
    result?.status === 'pending_proof' &&
    events?.filter(({ kind }) => kind === 'final_response_released').length === 1
  ) {
    return 'finalized'
  }
  return result?.status ?? 'interrupted'
}

function matchingResultDiscrepancies(
  roster: CampaignRoster,
  rosterRun: CampaignRoster['runs'][number],
  matchingResults: readonly CampaignRunResult[]
): CampaignTruthDiscrepancy[] {
  const local: CampaignTruthDiscrepancy[] = []
  if (matchingResults.length > 1) {
    local.push(
      discrepancy(
        'duplicate_result',
        rosterRun.run_id,
        `Observed ${matchingResults.length} results for one rostered run.`
      )
    )
  }
  if (matchingResults.length === 0) {
    local.push(discrepancy('missing_result', rosterRun.run_id, 'Rostered run has no result.'))
    return local
  }
  for (const candidate of matchingResults) {
    local.push(...resultDiscrepancies(roster, rosterRun, candidate))
  }
  return local
}

async function auditRosterRun(
  roster: CampaignRoster,
  rosterRun: CampaignRoster['runs'][number],
  matchingResults: readonly CampaignRunResult[]
): Promise<CampaignTruthObservation> {
  const local = matchingResultDiscrepancies(roster, rosterRun, matchingResults)
  const result = matchingResults[0] ?? null
  let events: EvalEvent[] | null = null
  let invalidLog: string | null = null
  try {
    events = await readEventsIfPresent(rosterRun.event_log_path)
  } catch (error) {
    invalidLog = error instanceof Error ? error.message : String(error)
  }

  if (invalidLog) {
    local.push(discrepancy('invalid_event_log', rosterRun.run_id, invalidLog))
  } else if (result?.status === 'skipped' && events) {
    local.push(
      discrepancy('unexpected_event_log', rosterRun.run_id, 'Skipped run unexpectedly has a log.')
    )
  } else if (result && result.status !== 'skipped' && !events) {
    local.push(
      discrepancy('missing_event_log', rosterRun.run_id, 'Started run has no raw event log.')
    )
  }
  if (events) {
    local.push(...dispatchDiscrepancies(roster, rosterRun, events))
    local.push(...boardRequestDiscrepancies(rosterRun, events, result))
    local.push(...targetDiscrepancies(rosterRun, events))
    if (result) {
      const state = truthState(result, events)
      const terminalStatus = state === 'finalized' ? 'finalized' : result.status
      local.push(...terminalDiscrepancies(rosterRun.run_id, terminalStatus, events))
      local.push(...(await telemetryDiscrepancies(rosterRun, result, state, events)))
    }
  }
  return {
    discrepancies: local,
    event_count: events?.length ?? 0,
    result_status: result?.status ?? null,
    run_id: rosterRun.run_id,
    state: truthState(result, events),
    telemetry_artifact_path: result?.telemetry_artifact_path ?? null
  }
}

export async function auditCampaignTruth(
  roster: CampaignRoster,
  results: readonly CampaignRunResult[]
): Promise<CampaignTruthAuditReport> {
  const discrepancies: CampaignTruthDiscrepancy[] = []
  const { roster_id: _rosterId, ...rosterPayload } = roster
  const recomputedRosterId = campaignRosterId(rosterPayload)
  if (recomputedRosterId !== roster.roster_id) {
    discrepancies.push(
      discrepancy(
        'roster_identity_mismatch',
        '__campaign__',
        'Roster content does not match its content-addressed roster_id.'
      )
    )
  }
  const resultsByRun = new Map<string, CampaignRunResult[]>()
  for (const result of results) {
    const matches = resultsByRun.get(result.run_id) ?? []
    matches.push(result)
    resultsByRun.set(result.run_id, matches)
  }
  const rosterIds = new Set(roster.runs.map(({ run_id }) => run_id))
  for (const result of results) {
    if (!rosterIds.has(result.run_id)) {
      discrepancies.push(
        discrepancy('unexpected_result', result.run_id, 'Result is absent from the frozen roster.')
      )
    }
  }

  const observations: CampaignTruthObservation[] = []
  for (const rosterRun of roster.runs) {
    const matchingResults = resultsByRun.get(rosterRun.run_id) ?? []
    const observation = await auditRosterRun(roster, rosterRun, matchingResults)
    discrepancies.push(...observation.discrepancies)
    observations.push(observation)
  }

  const counts = emptyCounts()
  for (const observation of observations) counts[observation.state] += 1
  return {
    counts,
    discrepancies,
    gate_passed: discrepancies.length === 0,
    observations,
    results_total: results.length,
    roster_id: roster.roster_id,
    scheduled_total: roster.runs.length,
    schema_version: CAMPAIGN_TRUTH_AUDIT_SCHEMA_VERSION,
    started_total: observations.filter(
      ({ state }) => state !== 'never_started' && state !== 'skipped'
    ).length
  }
}

export async function auditCampaignTruthFiles(
  rosterPath: string,
  resultsPath: string
): Promise<CampaignTruthAuditReport> {
  const roster = JSON.parse(await readFile(rosterPath, 'utf8')) as CampaignRoster
  const results = JSON.parse(await readFile(resultsPath, 'utf8')) as CampaignRunResult[]
  return auditCampaignTruth(roster, results)
}
