import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  loadNarratedTraceHistory,
  readNarratedTraceRecord,
  type NarratedTraceRecordSummary
} from './history'
import type { NarratedTraceEvent, NarratedTraceScope, NarratedTraceSession } from './types'

const MAX_RESULTS = 5
const MAX_SESSIONS_READ = 12
const MAX_EVENTS_PER_RESULT = 5
const CURSOR_PREFIX = 'trace-task-v1.'
const STOP_TERMS = new Set([
  'a',
  'an',
  'back',
  'edit',
  'earlier',
  'go',
  'i',
  'it',
  'please',
  'that',
  'the',
  'this',
  'to',
  'trace',
  'traced',
  'what'
])

export type NarratedTraceQueryInput = {
  cursor?: string
  limit?: number
  query?: string
  scope: NarratedTraceScope
  selectionIds?: string[]
  since?: string
  tracedRegion?: Rect
  until?: string
  viewportBounds?: Rect
}

export type NarratedTraceQueryEvent = {
  anchor?: NarratedTraceEvent['anchor']
  atMs: number
  evidenceId?: string
  id: string
  kind: NarratedTraceEvent['kind']
  label: string
  target?: NarratedTraceEvent['target']
  text?: string
}

export type NarratedTraceQueryMatch = {
  endedAt: string
  events: NarratedTraceQueryEvent[]
  matchedBy: string[]
  score: number
  scope: NarratedTraceScope
  sessionId: string
  startedAt: string
  title: string
}

export type NarratedTraceQueryResult = {
  matches: NarratedTraceQueryMatch[]
  reason?:
    | 'ambiguous_matches'
    | 'ambiguous_query'
    | 'cursor_scope_mismatch'
    | 'invalid_cursor'
    | 'invalid_time_range'
    | 'no_relevant_trace'
    | 'unscoped_history'
  scanned: {
    indexCandidates: number
    sessions: number
  }
  status: 'ambiguous' | 'empty' | 'matched'
  taskCursor?: string
}

type TraceCursor = {
  documentId: string
  eventIds: string[]
  pageId: string
  sessionId: string
  version: 1
  workspaceId?: string
}

type QueryDependencies = {
  readSession: (sessionId: string) => Promise<NarratedTraceSession | null>
  records: NarratedTraceRecordSummary[]
}

type ScoredSession = {
  matchedBy: string[]
  score: number
  session: NarratedTraceSession
  summary: NarratedTraceRecordSummary
}

type PreparedQuery = {
  cursor: TraceCursor | null
  queryTerms: string[]
  since: number | undefined
  until: number | undefined
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      (value.toLowerCase().match(/[\p{L}\p{N}_.:-]+/gu) ?? []).filter(
        (term) => term.length > 1 && !STOP_TERMS.has(term)
      )
    )
  ]
}

function parseTime(value: string | undefined): number | null | undefined {
  if (value === undefined) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function intersects(left: Rect | undefined, right: Rect | undefined): boolean {
  if (!left || !right) return false
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  )
}

function sameScope(left: NarratedTraceScope | undefined, right: NarratedTraceScope): boolean {
  if (!left) return false
  if (left.documentId !== right.documentId || left.pageId !== right.pageId) return false
  return !left.workspaceId || !right.workspaceId || left.workspaceId === right.workspaceId
}

function encodeCursor(cursor: TraceCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `${CURSOR_PREFIX}${btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')}`
}

function decodeCursor(value: string): TraceCursor | null {
  if (!value.startsWith(CURSOR_PREFIX)) return null
  const encoded = value.slice(CURSOR_PREFIX.length).replaceAll('-', '+').replaceAll('_', '/')
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
  try {
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<TraceCursor>
    if (
      parsed.version !== 1 ||
      typeof parsed.documentId !== 'string' ||
      typeof parsed.pageId !== 'string' ||
      typeof parsed.sessionId !== 'string' ||
      (parsed.workspaceId !== undefined && typeof parsed.workspaceId !== 'string') ||
      !Array.isArray(parsed.eventIds) ||
      !parsed.eventIds.every((id) => typeof id === 'string')
    ) {
      return null
    }
    return parsed as TraceCursor
  } catch {
    return null
  }
}

function summaryScore(
  summary: NarratedTraceRecordSummary,
  queryTerms: string[],
  input: NarratedTraceQueryInput
): number {
  const summaryTerms = new Set(summary.searchTerms ?? tokenize(summary.title))
  const queryMatches = queryTerms.filter((term) => summaryTerms.has(term)).length
  const selectionMatches = (input.selectionIds ?? []).filter((id) =>
    summary.targetIds?.includes(id)
  ).length
  return (
    queryMatches * 6 +
    selectionMatches * 20 +
    (intersects(summary.bounds, input.tracedRegion) ? 14 : 0) +
    (intersects(summary.bounds, input.viewportBounds) ? 4 : 0)
  )
}

function eventSearchText(event: NarratedTraceEvent): string {
  const targetPath = event.target?.path.join(' ') ?? ''
  const changedProperties = event.changes?.map((change) => change.property).join(' ') ?? ''
  return [event.label, event.text ?? '', event.target?.name ?? '', targetPath, changedProperties]
    .join(' ')
    .toLowerCase()
}

function eventScore(
  event: NarratedTraceEvent,
  queryTerms: string[],
  input: NarratedTraceQueryInput,
  cursorEventIds: Set<string>
): { matchedBy: string[]; score: number } {
  const matchedBy: string[] = []
  const text = eventSearchText(event)
  const termMatches = queryTerms.filter((term) => text.includes(term)).length
  if (termMatches > 0) matchedBy.push('text')
  const selectionMatch = Boolean(
    event.target?.stableId && input.selectionIds?.includes(event.target.stableId)
  )
  if (selectionMatch) matchedBy.push('selection')
  const spatialRegion = event.anchor?.pageRegion ?? event.target?.bounds
  const regionMatch = intersects(spatialRegion, input.tracedRegion)
  if (regionMatch) matchedBy.push('traced-region')
  const viewportMatch = intersects(spatialRegion, input.viewportBounds)
  if (viewportMatch) matchedBy.push('viewport')
  const cursorMatch = cursorEventIds.has(event.id)
  if (cursorMatch) matchedBy.push('cursor')
  return {
    matchedBy,
    score:
      termMatches * 6 +
      (selectionMatch ? 24 : 0) +
      (regionMatch ? 18 : 0) +
      (viewportMatch ? 5 : 0) +
      (cursorMatch ? 12 : 0)
  }
}

function scoreSession(
  session: NarratedTraceSession,
  summary: NarratedTraceRecordSummary,
  queryTerms: string[],
  input: NarratedTraceQueryInput,
  cursor: TraceCursor | null
): ScoredSession {
  const cursorEventIds = cursor ? new Set(cursor.eventIds) : new Set<string>()
  const scoredEvents = session.events
    .map((event) => ({ event, ...eventScore(event, queryTerms, input, cursorEventIds) }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.event.atMs - left.event.atMs ||
        left.event.id.localeCompare(right.event.id)
    )
  const relevantEvents = scoredEvents.filter((entry) => entry.score > 0)
  const titleText = summary.title.toLowerCase()
  const titleMatches = queryTerms.filter((term) => titleText.includes(term)).length
  const matchedBy = new Set(relevantEvents.flatMap((entry) => entry.matchedBy))
  if (titleMatches > 0) matchedBy.add('title')
  const hasStrongMatch =
    titleMatches > 0 ||
    [...matchedBy].some((reason) =>
      ['cursor', 'selection', 'text', 'traced-region'].includes(reason)
    )
  return {
    matchedBy: [...matchedBy],
    score:
      queryTerms.length > 0 && !hasStrongMatch
        ? 0
        : relevantEvents.reduce((total, entry) => total + entry.score, 0) +
          titleMatches * 8 +
          (cursor ? 20 : 0),
    session: {
      ...session,
      events: (relevantEvents.length > 0 ? relevantEvents : scoredEvents)
        .slice(0, MAX_EVENTS_PER_RESULT)
        .map((entry) => entry.event)
    },
    summary
  }
}

function queryEvent(event: NarratedTraceEvent): NarratedTraceQueryEvent {
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

function queryMatch(scored: ScoredSession): NarratedTraceQueryMatch {
  const scope = scored.session.scope ?? scored.summary.scope
  if (!scope) throw new Error('Scoped Trace query returned an unscoped session')
  const startedAtMs = Date.parse(scored.session.startedAt)
  return {
    endedAt: new Date(startedAtMs + scored.session.durationMs).toISOString(),
    events: scored.session.events.map(queryEvent),
    matchedBy: scored.matchedBy,
    score: scored.score,
    scope,
    sessionId: scored.session.id,
    startedAt: scored.session.startedAt,
    title: scored.summary.title
  }
}

function emptyResult(
  reason: NonNullable<NarratedTraceQueryResult['reason']>,
  scanned = { indexCandidates: 0, sessions: 0 }
): NarratedTraceQueryResult {
  return { matches: [], reason, scanned, status: 'empty' }
}

function invalidTimeRange(since: number | null | undefined, until: number | null | undefined) {
  if (since === null || until === null) return true
  return since !== undefined && until !== undefined && since > until
}

function cursorScopeMismatch(cursor: TraceCursor, scope: NarratedTraceScope) {
  const workspaceMismatch =
    cursor.workspaceId !== undefined && cursor.workspaceId !== scope.workspaceId
  return (
    cursor.documentId !== scope.documentId || cursor.pageId !== scope.pageId || workspaceMismatch
  )
}

function hasQueryContext(input: NarratedTraceQueryInput, cursor: TraceCursor | null) {
  return [input.selectionIds?.length, input.tracedRegion, input.viewportBounds, cursor].some(
    Boolean
  )
}

function prepareQuery(input: NarratedTraceQueryInput): NarratedTraceQueryResult | PreparedQuery {
  const since = parseTime(input.since)
  const until = parseTime(input.until)
  if (invalidTimeRange(since, until)) return emptyResult('invalid_time_range')

  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  if (input.cursor && !cursor) return emptyResult('invalid_cursor')
  if (cursor && cursorScopeMismatch(cursor, input.scope)) {
    return emptyResult('cursor_scope_mismatch')
  }

  const queryTerms = tokenize(input.query ?? '')
  if (queryTerms.length === 0 && !hasQueryContext(input, cursor)) {
    return emptyResult('ambiguous_query')
  }
  return {
    cursor,
    queryTerms,
    since: since ?? undefined,
    until: until ?? undefined
  }
}

function scopedSummaries(
  input: NarratedTraceQueryInput,
  records: NarratedTraceRecordSummary[],
  prepared: PreparedQuery
) {
  return records.filter((summary) => {
    if (!sameScope(summary.scope, input.scope)) return false
    if (prepared.cursor && summary.id !== prepared.cursor.sessionId) return false
    const startedAt = Date.parse(summary.startedAt)
    const endedAt = startedAt + summary.durationMs
    if (prepared.since !== undefined && endedAt < prepared.since) return false
    if (prepared.until !== undefined && startedAt > prepared.until) return false
    return true
  })
}

async function rankedSessions(
  input: NarratedTraceQueryInput,
  dependencies: QueryDependencies,
  prepared: PreparedQuery,
  scoped: NarratedTraceRecordSummary[]
) {
  const candidates = scoped
    .map((summary) => ({
      score: summaryScore(summary, prepared.queryTerms, input),
      summary
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.summary.startedAt) - Date.parse(left.summary.startedAt) ||
        left.summary.id.localeCompare(right.summary.id)
    )
    .slice(0, MAX_SESSIONS_READ)
  const sessions = await Promise.all(
    candidates.map(async ({ summary }) => ({
      session: await dependencies.readSession(summary.id),
      summary
    }))
  )
  const scored = sessions
    .flatMap(({ session, summary }) =>
      session && sameScope(session.scope ?? summary.scope, input.scope)
        ? [scoreSession(session, summary, prepared.queryTerms, input, prepared.cursor)]
        : []
    )
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.session.startedAt) - Date.parse(left.session.startedAt) ||
        left.session.id.localeCompare(right.session.id)
    )
  return { candidates, scored, sessions }
}

export async function queryNarratedTraceRecords(
  input: NarratedTraceQueryInput,
  dependencies: QueryDependencies
): Promise<NarratedTraceQueryResult> {
  const prepared = prepareQuery(input)
  if ('status' in prepared) return prepared

  const scoped = scopedSummaries(input, dependencies.records, prepared)
  if (scoped.length === 0) {
    const hasLegacyHistory =
      !prepared.cursor && dependencies.records.some((summary) => !summary.scope)
    return emptyResult(hasLegacyHistory ? 'unscoped_history' : 'no_relevant_trace')
  }

  const { candidates, scored, sessions } = await rankedSessions(
    input,
    dependencies,
    prepared,
    scoped
  )

  if (scored.length === 0) {
    return emptyResult('no_relevant_trace', {
      indexCandidates: candidates.length,
      sessions: sessions.length
    })
  }

  const limit = Math.max(1, Math.min(MAX_RESULTS, input.limit ?? 3))
  const matches = scored.slice(0, limit).map(queryMatch)
  const ambiguous = !prepared.cursor && scored.length > 1 && scored[0]?.score === scored[1]?.score
  if (ambiguous) {
    return {
      matches,
      reason: 'ambiguous_matches',
      scanned: { indexCandidates: candidates.length, sessions: sessions.length },
      status: 'ambiguous'
    }
  }

  const first = matches[0]
  return {
    matches,
    scanned: { indexCandidates: candidates.length, sessions: sessions.length },
    status: 'matched',
    taskCursor: encodeCursor({
      documentId: input.scope.documentId,
      eventIds: first.events.map((event) => event.id),
      pageId: input.scope.pageId,
      sessionId: first.sessionId,
      version: 1,
      workspaceId: input.scope.workspaceId
    })
  }
}

export async function queryNarratedTraceHistory(
  input: NarratedTraceQueryInput
): Promise<NarratedTraceQueryResult> {
  const records = await loadNarratedTraceHistory()
  return queryNarratedTraceRecords(input, {
    readSession: readNarratedTraceRecord,
    records
  })
}
