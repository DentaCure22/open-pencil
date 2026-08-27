import {
  buildTraceQueryMatch,
  matchingTraceWindowEvents,
  queryTraceRecords,
  TURN_CONTEXT_BRACKET_MS,
  turnContextTargets,
  type TraceQueryDependencies,
  type TraceQueryRecordSummary,
  type TraceQueryResult,
  type TraceQueryScope,
  type TraceWindowEntry
} from './trace-query'

/** A pointing gesture and its spoken request never sit more than a few minutes apart. */
const MAX_RESOLVE_WINDOW_MS = 5 * 60_000
const MAX_WINDOW_SESSIONS = 24
const MAX_WINDOW_EVENTS = 24

export type TraceResolveInput = {
  /** The user's words, verbatim from the dispatch brief. */
  exactWords: string
  scope?: TraceQueryScope
  /** Optional wall-clock fallback window (ISO 8601) for when the words were spoken. */
  windowEndedAt?: string
  windowStartedAt?: string
}

export type TraceResolveResult = TraceQueryResult & {
  /** Which evidence path answered: the words matched a turn, the window did, or the latest turn. */
  resolvedBy?: 'latest-turn' | 'spoken-text' | 'time-window'
}

type EpochWindow = { endedAtEpochMs: number; startedAtEpochMs: number }

function parsedWindow(input: TraceResolveInput): EpochWindow | 'invalid' | undefined {
  if (input.windowStartedAt === undefined && input.windowEndedAt === undefined) return undefined
  if (input.windowStartedAt === undefined || input.windowEndedAt === undefined) return 'invalid'
  const startedAtEpochMs = Date.parse(input.windowStartedAt)
  const endedAtEpochMs = Date.parse(input.windowEndedAt)
  if (
    !Number.isFinite(startedAtEpochMs) ||
    !Number.isFinite(endedAtEpochMs) ||
    startedAtEpochMs > endedAtEpochMs ||
    endedAtEpochMs - startedAtEpochMs > MAX_RESOLVE_WINDOW_MS
  ) {
    return 'invalid'
  }
  return { endedAtEpochMs, startedAtEpochMs }
}

function scopeMatches(scope: TraceQueryScope | undefined, filter: TraceQueryScope | undefined) {
  if (!filter) return true
  if (!scope) return false
  return scope.documentId === filter.documentId && scope.pageId === filter.pageId
}

function windowSummaries(
  records: readonly TraceQueryRecordSummary[],
  timeWindow: EpochWindow,
  scope: TraceQueryScope | undefined
) {
  return records
    .filter((summary) => {
      if (!scopeMatches(summary.scope, scope)) return false
      const startedAtMs = Date.parse(summary.startedAt)
      if (!Number.isFinite(startedAtMs) || !Number.isFinite(summary.durationMs)) return false
      const endedAtMs = startedAtMs + Math.max(0, summary.durationMs)
      return startedAtMs <= timeWindow.endedAtEpochMs && endedAtMs >= timeWindow.startedAtEpochMs
    })
    .sort(
      (first, second) =>
        Date.parse(first.startedAt) - Date.parse(second.startedAt) ||
        first.id.localeCompare(second.id)
    )
}

async function resolveByWindow(
  timeWindow: EpochWindow,
  scope: TraceQueryScope | undefined,
  dependencies: TraceQueryDependencies
): Promise<TraceResolveResult> {
  const bracketed: EpochWindow = {
    endedAtEpochMs: timeWindow.endedAtEpochMs + TURN_CONTEXT_BRACKET_MS,
    startedAtEpochMs: timeWindow.startedAtEpochMs - TURN_CONTEXT_BRACKET_MS
  }
  const candidates = windowSummaries(dependencies.records, bracketed, scope)
  if (candidates.length > MAX_WINDOW_SESSIONS) {
    return {
      matches: [],
      reason: 'trace_window_truncated',
      resolvedBy: 'time-window',
      scanned: { indexCandidates: candidates.length, sessions: 0 },
      status: 'ambiguous'
    }
  }
  const entries: TraceWindowEntry[] = []
  for (const summary of candidates) {
    const session = await dependencies.readSession(summary.id)
    if (!session) continue
    const events = matchingTraceWindowEvents(session, bracketed)
    if (events && events.length > 0) entries.push({ events, session, summary })
  }
  const scanned = { indexCandidates: candidates.length, sessions: entries.length }
  if (entries.length === 0) {
    return {
      matches: [],
      reason: 'no_trace_in_time_window',
      resolvedBy: 'time-window',
      scanned,
      status: 'empty'
    }
  }
  let remaining = MAX_WINDOW_EVENTS
  const matches = entries.flatMap(({ events, session, summary }) => {
    if (remaining <= 0) return []
    const boundedEvents = events.slice(0, remaining)
    remaining -= boundedEvents.length
    return [
      buildTraceQueryMatch({
        matchedBy: ['time-window'],
        score: 100,
        session: { ...session, events: boundedEvents },
        summary
      })
    ]
  })
  return {
    contextTargets: turnContextTargets(entries, timeWindow),
    matches,
    resolvedBy: 'time-window',
    scanned,
    status: 'matched'
  }
}

/**
 * One-call context resolution for workers: give it the user's exact words and, when known, the
 * wall-clock window they were spoken in. It tries the words against recorded spoken turns first
 * (fuzzy, recognizer-tolerant), falls back to raw Trace activity inside the window, then to the
 * latest fresh turn — and always answers honestly about which path produced the evidence.
 */
export async function resolveTraceRequest(
  input: TraceResolveInput,
  dependencies: TraceQueryDependencies
): Promise<TraceResolveResult> {
  const timeWindow = parsedWindow(input)
  if (timeWindow === 'invalid') {
    return {
      matches: [],
      reason: 'invalid_time_window',
      scanned: { indexCandidates: 0, sessions: 0 },
      status: 'error'
    }
  }

  if (input.exactWords.trim()) {
    const byText = await queryTraceRecords(
      { scope: input.scope, spokenText: input.exactWords, turnContext: true },
      dependencies
    )
    // Any outcome other than "no turn matched these words" is an answer in itself — including
    // a matched turn with no gestures around it, which callers must see rather than paper over.
    if (byText.reason !== 'spoken_turn_not_found') {
      return { ...byText, resolvedBy: 'spoken-text' }
    }
  }

  if (timeWindow) return resolveByWindow(timeWindow, input.scope, dependencies)

  const byLatest = await queryTraceRecords(
    { latestSpokenTurn: true, scope: input.scope, turnContext: true },
    dependencies
  )
  return { ...byLatest, resolvedBy: 'latest-turn' }
}
