import {
  spokenTextMatchScore,
  traceEventSearchValues,
  type TraceHistoryEvent,
  type TraceQueryDependencies,
  type TraceQueryRecordSummary,
  type TraceQueryScope,
  type TraceQuerySpokenTurn
} from './trace-query'

/**
 * Grep for Trace: rank everything, gate nothing. Unlike the resolver tools, search never decides
 * relevance for the caller — it returns scored candidates (even weak ones) and lets the agent
 * judge, the way a coding agent judges ripgrep hits before opening a file.
 */

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
/** How many candidate sessions we open to look for matching events inside. */
const MAX_SESSIONS_OPENED = 12
const MAX_EVENTS_PER_SESSION = 5

export type TraceSearchInput = {
  limit?: number
  /** Keywords to rank by. Omit to list the most recent turns and sessions. */
  pattern?: string
  since?: string
  until?: string
}

export type TraceSearchTurnHit = {
  ageSeconds: number
  endedAt: string
  id: string
  scope: TraceQueryScope
  /** Word-overlap score in [0, 1]; 0 when listing by recency. */
  score: number
  startedAt: string
  text: string
}

export type TraceSearchEventHit = {
  atMs: number
  kind: string
  label: string
  target?: TraceHistoryEvent['target']
  text?: string
}

export type TraceSearchSessionHit = {
  durationMs: number
  id: string
  /** Events inside the session whose text touches the pattern; empty when listing by recency. */
  matchedEvents: TraceSearchEventHit[]
  scope?: TraceQueryScope
  score: number
  startedAt: string
  title: string
}

export type TraceSearchResult = {
  scanned: { sessions: number; turns: number }
  sessions: TraceSearchSessionHit[]
  turns: TraceSearchTurnHit[]
}

type EpochRange = { sinceMs: number; untilMs: number }

function parsedRange(input: TraceSearchInput): EpochRange | 'invalid' {
  const sinceMs = input.since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(input.since)
  const untilMs = input.until === undefined ? Number.POSITIVE_INFINITY : Date.parse(input.until)
  if (Number.isNaN(sinceMs) || Number.isNaN(untilMs) || sinceMs > untilMs) return 'invalid'
  return { sinceMs, untilMs }
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) return DEFAULT_LIMIT
  return Math.min(limit, MAX_LIMIT)
}

function patternTerms(pattern: string | undefined): string[] {
  if (!pattern) return []
  return [...new Set(pattern.toLowerCase().match(/[\p{L}\p{N}'_.:-]+/gu))]
}

function turnInRange(turn: TraceQuerySpokenTurn, range: EpochRange): boolean {
  return turn.endedAtEpochMs >= range.sinceMs && turn.startedAtEpochMs <= range.untilMs
}

function sessionInRange(summary: TraceQueryRecordSummary, range: EpochRange): boolean {
  const startedAtMs = Date.parse(summary.startedAt)
  if (!Number.isFinite(startedAtMs)) return false
  const endedAtMs = startedAtMs + Math.max(0, summary.durationMs)
  return endedAtMs >= range.sinceMs && startedAtMs <= range.untilMs
}

function searchTurns(
  turns: readonly TraceQuerySpokenTurn[],
  pattern: string | undefined,
  range: EpochRange,
  limit: number,
  nowEpochMs: number
): { hits: TraceSearchTurnHit[]; scanned: number } {
  const inRange = turns.filter((turn) => turnInRange(turn, range))
  const scored = inRange.map((turn) => ({
    score: pattern ? spokenTextMatchScore(pattern, turn.text) : 0,
    turn
  }))
  const kept = pattern ? scored.filter((entry) => entry.score > 0) : scored
  kept.sort(
    (first, second) =>
      second.score - first.score || second.turn.endedAtEpochMs - first.turn.endedAtEpochMs
  )
  return {
    hits: kept.slice(0, limit).map(({ score, turn }) => ({
      ageSeconds: Math.max(0, Math.round((nowEpochMs - turn.endedAtEpochMs) / 1000)),
      endedAt: turn.endedAt,
      id: turn.id,
      scope: turn.scope,
      score: Number(score.toFixed(3)),
      startedAt: turn.startedAt,
      text: turn.text
    })),
    scanned: inRange.length
  }
}

function summaryTermMatches(summary: TraceQueryRecordSummary, terms: readonly string[]): number {
  const haystack = [summary.title, ...(summary.searchTerms ?? []), ...(summary.targetIds ?? [])]
    .join(' ')
    .toLowerCase()
  return terms.filter((term) => haystack.includes(term)).length
}

function matchingEvents(
  events: readonly TraceHistoryEvent[],
  terms: readonly string[]
): TraceHistoryEvent[] {
  if (terms.length === 0) return []
  return events.filter((event) => {
    const haystack = traceEventSearchValues([event]).join(' ').toLowerCase()
    return terms.some((term) => haystack.includes(term))
  })
}

function eventHit(event: TraceHistoryEvent): TraceSearchEventHit {
  return {
    atMs: event.atMs,
    kind: event.kind,
    label: event.label,
    ...(event.target ? { target: event.target } : {}),
    ...(event.text ? { text: event.text } : {})
  }
}

async function searchSessions(
  dependencies: TraceQueryDependencies,
  terms: readonly string[],
  range: EpochRange,
  limit: number
): Promise<{ hits: TraceSearchSessionHit[]; scanned: number }> {
  const inRange = dependencies.records
    .filter((summary) => sessionInRange(summary, range))
    .map((summary) => ({ summary, termMatches: summaryTermMatches(summary, terms) }))
    .sort(
      (first, second) =>
        second.termMatches - first.termMatches ||
        Date.parse(second.summary.startedAt) - Date.parse(first.summary.startedAt)
    )

  const hits: TraceSearchSessionHit[] = []
  const openable = inRange.slice(0, Math.max(MAX_SESSIONS_OPENED, limit))
  for (const { summary, termMatches } of openable) {
    if (hits.length >= limit) break
    let matchedEvents: TraceSearchEventHit[] = []
    if (terms.length > 0 && hits.length < MAX_SESSIONS_OPENED) {
      const session = await dependencies.readSession(summary.id)
      if (session) {
        matchedEvents = matchingEvents(session.events, terms)
          .slice(0, MAX_EVENTS_PER_SESSION)
          .map(eventHit)
      }
    }
    const score = termMatches + matchedEvents.length
    // With a pattern, drop sessions that matched nothing at all — pure noise, not a weak signal.
    if (terms.length > 0 && score === 0) continue
    hits.push({
      durationMs: summary.durationMs,
      id: summary.id,
      matchedEvents,
      ...(summary.scope ? { scope: summary.scope } : {}),
      score,
      startedAt: summary.startedAt,
      title: summary.title
    })
  }
  hits.sort(
    (first, second) =>
      second.score - first.score || Date.parse(second.startedAt) - Date.parse(first.startedAt)
  )
  return { hits, scanned: inRange.length }
}

export async function searchTrace(
  input: TraceSearchInput,
  dependencies: TraceQueryDependencies,
  options: { nowEpochMs?: number } = {}
): Promise<TraceSearchResult | { error: string }> {
  const range = parsedRange(input)
  if (range === 'invalid') {
    return {
      error: 'invalid_time_range: since/until must be valid ISO timestamps, since <= until.'
    }
  }
  const limit = boundedLimit(input.limit)
  const pattern = input.pattern?.trim() || undefined
  const nowEpochMs = options.nowEpochMs ?? Date.now()

  const turns = searchTurns(dependencies.spokenTurns ?? [], pattern, range, limit, nowEpochMs)
  const sessions = await searchSessions(dependencies, patternTerms(pattern), range, limit)

  return {
    scanned: { sessions: sessions.scanned, turns: turns.scanned },
    sessions: sessions.hits,
    turns: turns.hits
  }
}
