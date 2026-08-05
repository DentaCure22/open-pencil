import type { NarratedTraceRecordSummary } from '../history'
import type { NarratedTraceMicTurn } from '../mic'
import type {
  NarratedTraceQueryEvent,
  NarratedTraceQueryMatch,
  NarratedTraceQueryResult,
  NarratedTraceQuerySpokenTurn
} from '../query'
import type { NarratedTraceEvent, NarratedTraceSession } from '../types'

export function buildNarratedTraceQueryEvent(event: NarratedTraceEvent): NarratedTraceQueryEvent {
  return {
    anchor: event.anchor ? structuredClone(event.anchor) : undefined,
    atMs: event.atMs,
    evidenceId: event.evidence?.evidenceId,
    id: event.id,
    kind: event.kind,
    label: event.label,
    target: event.target ? structuredClone(event.target) : undefined,
    text: event.text
  }
}

export function buildNarratedTraceQueryMatch(input: {
  matchedBy: string[]
  score: number
  session: NarratedTraceSession
  summary: NarratedTraceRecordSummary
}): NarratedTraceQueryMatch {
  const scope = input.session.scope ?? input.summary.scope
  if (!scope) throw new Error('Scoped Trace query returned an unscoped session')
  const startedAtMs = Date.parse(input.session.startedAt)
  return {
    endedAt: new Date(startedAtMs + input.session.durationMs).toISOString(),
    events: input.session.events.map(buildNarratedTraceQueryEvent),
    matchedBy: input.matchedBy,
    score: input.score,
    scope,
    sessionId: input.session.id,
    startedAt: input.session.startedAt,
    title: input.summary.title
  }
}

export function publicNarratedTraceSpokenTurn(
  turn: NarratedTraceMicTurn
): NarratedTraceQuerySpokenTurn {
  return {
    endedAt: turn.endedAt,
    endedAtEpochMs: turn.endedAtEpochMs,
    id: turn.id,
    scope: structuredClone(turn.scope),
    sequence: turn.sequence,
    startedAt: turn.startedAt,
    startedAtEpochMs: turn.startedAtEpochMs,
    text: turn.text
  }
}

export function buildNarratedTraceEmptyResult(
  reason: NonNullable<NarratedTraceQueryResult['reason']>,
  scanned = { indexCandidates: 0, sessions: 0 },
  sourceSpokenTurn?: NarratedTraceQuerySpokenTurn
): NarratedTraceQueryResult {
  return {
    matches: [],
    reason,
    scanned,
    ...(sourceSpokenTurn ? { sourceSpokenTurn } : {}),
    status: 'empty'
  }
}
