import { summarizeNarratedTraceSession, type NarratedTraceRecordSummary } from '../history'
import { resolveNarratedTraceMicTurn, type NarratedTraceMicTurn } from '../mic'
import type {
  NarratedTraceQueryInput,
  NarratedTraceQueryResult,
  NarratedTraceQuerySpokenTurn,
  QueryDependencies
} from '../query'
import type { NarratedTraceEvent, NarratedTraceScope, NarratedTraceSession } from '../types'
import {
  buildNarratedTraceEmptyResult,
  buildNarratedTraceQueryMatch,
  publicNarratedTraceSpokenTurn
} from './result'

const MAX_EXACT_WINDOW_EVENTS = 100
const MAX_EXACT_WINDOW_SESSIONS = 24

type ExactWindowEntry = {
  events: NarratedTraceEvent[]
  session: NarratedTraceSession
  summary: NarratedTraceRecordSummary
}

type CandidateResult =
  | {
      candidates: NarratedTraceRecordSummary[]
      malformed: false
    }
  | {
      candidates: NarratedTraceRecordSummary[]
      malformed: true
    }

type LoadedResult =
  | {
      entries: ExactWindowEntry[]
      incomplete: false
      malformed: false
      sessionsRead: number
    }
  | {
      entries: []
      incomplete: boolean
      malformed: boolean
      sessionsRead: number
    }

function sameExactScope(left: NarratedTraceScope | undefined, right: NarratedTraceScope) {
  if (!left?.workspaceId || !right.workspaceId) return false
  return (
    left.workspaceId === right.workspaceId &&
    left.documentId === right.documentId &&
    left.pageId === right.pageId
  )
}

function selectorCount(input: NarratedTraceQueryInput) {
  return [
    input.latestSpokenTurn === true,
    Boolean(input.spokenText?.trim()),
    Boolean(input.spokenTurnId)
  ].filter(Boolean).length
}

export function hasSpokenTurnSelector(input: NarratedTraceQueryInput) {
  return selectorCount(input) > 0
}

function validSelector(input: NarratedTraceQueryInput) {
  return (
    selectorCount(input) === 1 &&
    !input.cursor &&
    !input.query?.trim() &&
    input.since === undefined &&
    input.until === undefined
  )
}

function errorResult(
  reason:
    | 'invalid_spoken_turn_selector'
    | 'spoken_turn_runtime_binding_unavailable'
    | 'spoken_turn_scope_unavailable'
): NarratedTraceQueryResult {
  return {
    matches: [],
    reason,
    scanned: { indexCandidates: 0, sessions: 0 },
    status: 'error'
  }
}

function emptyResult(
  reason: 'no_trace_in_spoken_window' | 'spoken_turn_not_found',
  scanned = { indexCandidates: 0, sessions: 0 },
  sourceSpokenTurn?: NarratedTraceQuerySpokenTurn
): NarratedTraceQueryResult {
  return buildNarratedTraceEmptyResult(reason, scanned, sourceSpokenTurn)
}

function ambiguousResult(
  reason: Extract<
    NonNullable<NarratedTraceQueryResult['reason']>,
    'malformed_trace_window' | 'trace_window_incomplete' | 'trace_window_truncated'
  >,
  sourceSpokenTurn: NarratedTraceQuerySpokenTurn,
  scanned: NarratedTraceQueryResult['scanned']
): NarratedTraceQueryResult {
  return {
    matches: [],
    reason,
    scanned,
    sourceSpokenTurn,
    status: 'ambiguous'
  }
}

function validTurnWindow(turn: NarratedTraceMicTurn) {
  return (
    Number.isFinite(turn.startedAtEpochMs) &&
    Number.isFinite(turn.endedAtEpochMs) &&
    turn.startedAtEpochMs <= turn.endedAtEpochMs &&
    turn.endedAtEpochMs - turn.startedAtEpochMs <= 60_000
  )
}

function windowOverlaps(startedAtMs: number, durationMs: number, turn: NarratedTraceMicTurn) {
  const endedAtMs = startedAtMs + Math.max(0, durationMs)
  return startedAtMs <= turn.endedAtEpochMs && endedAtMs >= turn.startedAtEpochMs
}

function candidateSummaries(
  dependencies: QueryDependencies,
  turn: NarratedTraceMicTurn
): CandidateResult {
  const current = dependencies.currentSession
  const records = current
    ? [
        summarizeNarratedTraceSession(current),
        ...dependencies.records.filter((record) => record.id !== current.id)
      ]
    : dependencies.records
  const candidates: NarratedTraceRecordSummary[] = []
  for (const summary of records) {
    if (!sameExactScope(summary.scope, turn.scope)) continue
    const startedAtMs = Date.parse(summary.startedAt)
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(summary.durationMs)) {
      return { candidates, malformed: true }
    }
    if (windowOverlaps(startedAtMs, summary.durationMs, turn)) candidates.push(summary)
  }
  candidates.sort(
    (first, second) =>
      Date.parse(first.startedAt) - Date.parse(second.startedAt) ||
      first.id.localeCompare(second.id)
  )
  return { candidates, malformed: false }
}

function matchingEvents(
  session: NarratedTraceSession,
  turn: NarratedTraceMicTurn
): NarratedTraceEvent[] | null {
  const startedAtMs = Date.parse(session.startedAt)
  if (!Number.isFinite(startedAtMs)) return null
  const events: NarratedTraceEvent[] = []
  for (const event of session.events) {
    if (
      !Number.isFinite(event.atMs) ||
      event.atMs < 0 ||
      (event.durationMs !== undefined &&
        (!Number.isFinite(event.durationMs) || event.durationMs < 0))
    ) {
      return null
    }
    const eventStartedAtMs = startedAtMs + event.atMs
    const eventEndedAtMs = eventStartedAtMs + (event.durationMs ?? 0)
    if (eventStartedAtMs <= turn.endedAtEpochMs && eventEndedAtMs >= turn.startedAtEpochMs) {
      events.push(event)
    }
  }
  return events.sort(
    (first, second) => first.atMs - second.atMs || first.id.localeCompare(second.id)
  )
}

async function loadEntries(
  dependencies: QueryDependencies,
  candidates: NarratedTraceRecordSummary[],
  turn: NarratedTraceMicTurn
): Promise<LoadedResult> {
  const current = dependencies.currentSession
  const loaded = await Promise.all(
    candidates.map(async (summary) => ({
      session:
        current?.id === summary.id
          ? structuredClone(current)
          : await dependencies.readSession(summary.id),
      summary
    }))
  )
  if (loaded.some(({ session }) => session === null)) {
    return { entries: [], incomplete: true, malformed: false, sessionsRead: loaded.length }
  }

  const entries: ExactWindowEntry[] = []
  for (const entry of loaded) {
    if (!entry.session || !sameExactScope(entry.session.scope ?? entry.summary.scope, turn.scope)) {
      return { entries: [], incomplete: true, malformed: false, sessionsRead: loaded.length }
    }
    const events = matchingEvents(entry.session, turn)
    if (!events) {
      return { entries: [], incomplete: false, malformed: true, sessionsRead: loaded.length }
    }
    if (events.length > 0) {
      entries.push({ events, session: entry.session, summary: entry.summary })
    }
  }
  return { entries, incomplete: false, malformed: false, sessionsRead: loaded.length }
}

function windowResult(
  entries: ExactWindowEntry[],
  sourceSpokenTurn: NarratedTraceQuerySpokenTurn,
  scanned: NarratedTraceQueryResult['scanned'],
  status: 'ambiguous' | 'matched',
  reason?: 'trace_window_truncated' | 'trace_window_unsettled'
): NarratedTraceQueryResult {
  let remaining = MAX_EXACT_WINDOW_EVENTS
  const matches = entries.flatMap(({ events, session, summary }) => {
    if (remaining <= 0) return []
    const boundedEvents = events.slice(0, remaining)
    remaining -= boundedEvents.length
    if (boundedEvents.length === 0) return []
    return [
      buildNarratedTraceQueryMatch({
        matchedBy: ['spoken-turn-window'],
        score: 100,
        session: { ...session, events: boundedEvents },
        summary
      })
    ]
  })
  return {
    matches,
    ...(reason ? { reason } : {}),
    scanned,
    sourceSpokenTurn,
    status
  }
}

function settleWindowResult(
  entries: ExactWindowEntry[],
  dependencies: QueryDependencies,
  candidates: NarratedTraceRecordSummary[],
  sourceSpokenTurn: NarratedTraceQuerySpokenTurn,
  sessionsRead: number
) {
  const scanned = { indexCandidates: candidates.length, sessions: sessionsRead }
  const eventCount = entries.reduce((total, entry) => total + entry.events.length, 0)
  const current = dependencies.currentSession
  const currentUnsettled =
    dependencies.currentSessionSettled === false &&
    Boolean(current && candidates.some((candidate) => candidate.id === current.id))
  if (currentUnsettled) {
    return windowResult(entries, sourceSpokenTurn, scanned, 'ambiguous', 'trace_window_unsettled')
  }
  if (eventCount > MAX_EXACT_WINDOW_EVENTS) {
    return windowResult(entries, sourceSpokenTurn, scanned, 'ambiguous', 'trace_window_truncated')
  }
  if (eventCount === 0) {
    return emptyResult('no_trace_in_spoken_window', scanned, sourceSpokenTurn)
  }
  return windowResult(entries, sourceSpokenTurn, scanned, 'matched')
}

export async function querySpokenTurnWindow(
  input: NarratedTraceQueryInput,
  dependencies: QueryDependencies
): Promise<NarratedTraceQueryResult> {
  if (!validSelector(input)) return errorResult('invalid_spoken_turn_selector')
  const resolution = resolveNarratedTraceMicTurn(
    {
      latest: input.latestSpokenTurn,
      runtimeTabBindingId: input.runtimeTabBindingId,
      scope: input.scope,
      text: input.spokenText,
      turnId: input.spokenTurnId
    },
    dependencies.spokenTurns ?? []
  )
  if (resolution.status === 'error') return errorResult(resolution.reason)
  if (resolution.status === 'empty') return emptyResult(resolution.reason)
  if (resolution.status === 'ambiguous') {
    return {
      matches: [],
      reason: resolution.reason,
      scanned: { indexCandidates: 0, sessions: 0 },
      spokenTurnCandidates: resolution.candidates.map(publicNarratedTraceSpokenTurn),
      status: 'ambiguous'
    }
  }

  const sourceSpokenTurn = publicNarratedTraceSpokenTurn(resolution.turn)
  if (!validTurnWindow(resolution.turn)) {
    return ambiguousResult('malformed_trace_window', sourceSpokenTurn, {
      indexCandidates: 0,
      sessions: 0
    })
  }
  const candidateResult = candidateSummaries(dependencies, resolution.turn)
  if (candidateResult.malformed) {
    return ambiguousResult('malformed_trace_window', sourceSpokenTurn, {
      indexCandidates: candidateResult.candidates.length,
      sessions: 0
    })
  }
  if (candidateResult.candidates.length > MAX_EXACT_WINDOW_SESSIONS) {
    return ambiguousResult('trace_window_truncated', sourceSpokenTurn, {
      indexCandidates: candidateResult.candidates.length,
      sessions: 0
    })
  }
  const loaded = await loadEntries(dependencies, candidateResult.candidates, resolution.turn)
  if (loaded.incomplete) {
    return ambiguousResult('trace_window_incomplete', sourceSpokenTurn, {
      indexCandidates: candidateResult.candidates.length,
      sessions: loaded.sessionsRead
    })
  }
  if (loaded.malformed) {
    return ambiguousResult('malformed_trace_window', sourceSpokenTurn, {
      indexCandidates: candidateResult.candidates.length,
      sessions: loaded.sessionsRead
    })
  }
  return settleWindowResult(
    loaded.entries,
    dependencies,
    candidateResult.candidates,
    sourceSpokenTurn,
    loaded.sessionsRead
  )
}
