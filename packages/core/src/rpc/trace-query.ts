import type { Rect } from '@open-pencil/scene-graph/primitives'

const MAX_RESULTS = 5
const MAX_SESSIONS_READ = 12
const MAX_EVENTS_PER_RESULT = 5
const MAX_EXACT_WINDOW_EVENTS = 24
const MAX_EXACT_WINDOW_SESSIONS = 24
const CURSOR_PREFIX = 'trace-task-v3.'
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

export type TraceQueryScope = {
  documentId: string
  documentName?: string
  pageId: string
  pageName?: string
  workspaceId?: string
}

export type TraceHistoryEvent = {
  anchor?: {
    pageRegion: Rect
  }
  atMs: number
  changes?: Array<{ property: string }>
  durationMs?: number
  evidence?: { evidenceId: string }
  id: string
  kind: string
  label: string
  target?: {
    bounds?: Rect
    name: string
    stableId: string
  }
  text?: string
}

export type TraceHistorySession = {
  durationMs: number
  events: TraceHistoryEvent[]
  id: string
  scope?: TraceQueryScope
  startedAt: string
}

export type TraceQueryRecordSummary = {
  bounds?: Rect
  durationMs: number
  id: string
  scope?: TraceQueryScope
  searchTerms?: string[]
  startedAt: string
  targetIds?: string[]
  title: string
}

export type TraceQuerySpokenTurn = {
  endedAt: string
  endedAtEpochMs: number
  expiresAtEpochMs?: number
  id: string
  runtimeTabBindingId?: string
  scope: TraceQueryScope & { workspaceId: string }
  sequence: number
  startedAt: string
  startedAtEpochMs: number
  text: string
}

export type TraceQueryInput = {
  cursor?: string
  latestSpokenTurn?: boolean
  limit?: number
  query?: string
  runtimeTabBindingId?: string
  scope?: TraceQueryScope
  selectionIds?: string[]
  since?: string
  spokenText?: string
  spokenTurnId?: string
  tracedRegion?: Rect
  until?: string
  viewportBounds?: Rect
}

export type TraceQueryEvent = {
  anchor?: TraceHistoryEvent['anchor']
  atMs: number
  evidenceId?: string
  id: string
  kind: string
  label: string
  target?: TraceHistoryEvent['target']
  text?: string
}

export type TraceQueryMatch = {
  endedAt: string
  events: TraceQueryEvent[]
  matchedBy: string[]
  score: number
  scope: TraceQueryScope
  sessionId: string
  startedAt: string
  title: string
}

export type TraceQueryPublicSpokenTurn = {
  endedAt: string
  endedAtEpochMs: number
  id: string
  scope: TraceQueryScope
  sequence: number
  startedAt: string
  startedAtEpochMs: number
  text: string
}

export type TraceQueryResult = {
  matches: TraceQueryMatch[]
  reason?:
    | 'ambiguous_matches'
    | 'ambiguous_query'
    | 'ambiguous_spoken_turn'
    | 'cursor_scope_mismatch'
    | 'invalid_cursor'
    | 'invalid_spoken_turn_selector'
    | 'invalid_time_range'
    | 'malformed_trace_window'
    | 'no_relevant_trace'
    | 'no_trace_in_spoken_window'
    | 'spoken_turn_not_found'
    | 'spoken_turn_runtime_binding_unavailable'
    | 'spoken_turn_scope_unavailable'
    | 'trace_read_failed'
    | 'trace_window_incomplete'
    | 'trace_window_truncated'
    | 'trace_window_unsettled'
    | 'unscoped_history'
  scanned: {
    indexCandidates: number
    sessions: number
  }
  sourceSpokenTurn?: TraceQueryPublicSpokenTurn
  spokenTurnCandidates?: TraceQueryPublicSpokenTurn[]
  status: 'ambiguous' | 'empty' | 'error' | 'matched'
  taskCursor?: string
}

export type TraceQueryDependencies = {
  currentSession?: TraceHistorySession | null
  currentSessionSettled?: boolean
  persistentSpokenTurns?: boolean
  readSession: (sessionId: string) => Promise<TraceHistorySession | null>
  records: TraceQueryRecordSummary[]
  spokenTurns?: readonly TraceQuerySpokenTurn[]
}

export type TraceSpokenTurnSelector = {
  latest?: boolean
  runtimeTabBindingId?: string
  scope?: TraceQueryScope
  text?: string
  turnId?: string
}

export type TraceSpokenTurnResolution =
  | {
      candidates: TraceQuerySpokenTurn[]
      reason: 'ambiguous_spoken_turn'
      status: 'ambiguous'
    }
  | {
      reason:
        | 'invalid_spoken_turn_selector'
        | 'spoken_turn_runtime_binding_unavailable'
        | 'spoken_turn_scope_unavailable'
      status: 'error'
    }
  | {
      reason: 'spoken_turn_not_found'
      status: 'empty'
    }
  | {
      status: 'matched'
      turn: TraceQuerySpokenTurn
    }

type TraceCursor = {
  documentId: string
  eventIds: string[]
  pageId: string
  sessionId: string
  version: 3
  workspaceId?: string
}

type ScoredSession = {
  matchedBy: string[]
  score: number
  session: TraceHistorySession
  summary: TraceQueryRecordSummary
}

type PreparedQuery = {
  cursor: TraceCursor | null
  queryTerms: string[]
  since: number | undefined
  until: number | undefined
}

type ExactWindowEntry = {
  events: TraceHistoryEvent[]
  session: TraceHistorySession
  summary: TraceQueryRecordSummary
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

function sameScope(left: TraceQueryScope | undefined, right: TraceQueryScope): boolean {
  if (!left) return false
  return (
    left.documentId === right.documentId &&
    left.pageId === right.pageId &&
    left.workspaceId === right.workspaceId
  )
}

function sameExactScope(left: TraceQueryScope | undefined, right: TraceQueryScope): boolean {
  if (!left?.workspaceId || !right.workspaceId) return false
  return sameScope(left, right)
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
      parsed.version !== 3 ||
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
  summary: TraceQueryRecordSummary,
  queryTerms: string[],
  input: TraceQueryInput
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

function eventLexicalTerms(event: TraceHistoryEvent): Set<string> {
  const changedProperties = event.changes?.map((change) => change.property).join(' ') ?? ''
  return new Set(
    tokenize([event.label, event.text ?? '', event.target?.name ?? '', changedProperties].join(' '))
  )
}

function admittedLexicalTerms(event: TraceHistoryEvent, queryTerms: string[]): string[] {
  if (queryTerms.length === 0) return []
  const evidenceTerms = eventLexicalTerms(event)
  const matches = queryTerms.filter((term) => evidenceTerms.has(term))
  const requiredMatches = Math.min(2, queryTerms.length)
  return matches.length >= requiredMatches ? matches : []
}

function eventScore(
  event: TraceHistoryEvent,
  queryTerms: string[],
  input: TraceQueryInput,
  cursorEventIds: Set<string>
): { matchedBy: string[]; score: number } {
  const matchedBy: string[] = []
  const cursorMatch = cursorEventIds.has(event.id)
  const lexicalTerms = admittedLexicalTerms(event, queryTerms)
  const termMatches = lexicalTerms.length
  if (queryTerms.length > 0 && termMatches === 0 && !cursorMatch) {
    return { matchedBy, score: 0 }
  }
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
  session: TraceHistorySession,
  summary: TraceQueryRecordSummary,
  queryTerms: string[],
  input: TraceQueryInput,
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
  const matchedBy = new Set(relevantEvents.flatMap((entry) => entry.matchedBy))
  const hasStrongMatch = [...matchedBy].some((reason) =>
    ['cursor', 'selection', 'text', 'traced-region'].includes(reason)
  )
  return {
    matchedBy: [...matchedBy],
    score:
      queryTerms.length > 0 && !hasStrongMatch
        ? 0
        : relevantEvents.reduce((total, entry) => total + entry.score, 0) + (cursor ? 20 : 0),
    session: {
      ...session,
      events: (relevantEvents.length > 0 ? relevantEvents : scoredEvents)
        .slice(0, MAX_EVENTS_PER_RESULT)
        .map((entry) => entry.event)
    },
    summary
  }
}

function buildQueryEvent(event: TraceHistoryEvent): TraceQueryEvent {
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

export function buildTraceQueryMatch(input: {
  matchedBy: string[]
  score: number
  session: TraceHistorySession
  summary: TraceQueryRecordSummary
}): TraceQueryMatch {
  const scope = input.session.scope ?? input.summary.scope
  if (!scope) throw new Error('Scoped Trace query returned an unscoped session')
  const startedAtMs = Date.parse(input.session.startedAt)
  return {
    endedAt: new Date(startedAtMs + input.session.durationMs).toISOString(),
    events: input.session.events.map(buildQueryEvent),
    matchedBy: input.matchedBy,
    score: input.score,
    scope,
    sessionId: input.session.id,
    startedAt: input.session.startedAt,
    title: input.summary.title
  }
}

export function publicTraceSpokenTurn(turn: TraceQuerySpokenTurn): TraceQueryPublicSpokenTurn {
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

export function buildTraceEmptyResult(
  reason: NonNullable<TraceQueryResult['reason']>,
  scanned = { indexCandidates: 0, sessions: 0 },
  sourceSpokenTurn?: TraceQueryPublicSpokenTurn
): TraceQueryResult {
  return {
    matches: [],
    reason,
    scanned,
    ...(sourceSpokenTurn ? { sourceSpokenTurn } : {}),
    status: 'empty'
  }
}

function errorResult(
  reason: Extract<
    NonNullable<TraceQueryResult['reason']>,
    | 'invalid_spoken_turn_selector'
    | 'spoken_turn_runtime_binding_unavailable'
    | 'spoken_turn_scope_unavailable'
    | 'trace_read_failed'
  >
): TraceQueryResult {
  return {
    matches: [],
    reason,
    scanned: { indexCandidates: 0, sessions: 0 },
    status: 'error'
  }
}

function invalidTimeRange(since: number | null | undefined, until: number | null | undefined) {
  if (since === null || until === null) return true
  return since !== undefined && until !== undefined && since > until
}

function cursorScope(cursor: TraceCursor): TraceQueryScope {
  return {
    documentId: cursor.documentId,
    pageId: cursor.pageId,
    workspaceId: cursor.workspaceId
  }
}

function cursorScopeMismatch(cursor: TraceCursor, scope: TraceQueryScope) {
  const workspaceMismatch =
    cursor.workspaceId !== undefined && cursor.workspaceId !== scope.workspaceId
  return (
    cursor.documentId !== scope.documentId || cursor.pageId !== scope.pageId || workspaceMismatch
  )
}

function hasQueryContext(input: TraceQueryInput, cursor: TraceCursor | null) {
  return [input.selectionIds?.length, input.tracedRegion, input.viewportBounds, cursor].some(
    Boolean
  )
}

function prepareQuery(input: TraceQueryInput): TraceQueryResult | PreparedQuery {
  const since = parseTime(input.since)
  const until = parseTime(input.until)
  if (invalidTimeRange(since, until)) return buildTraceEmptyResult('invalid_time_range')

  const cursor = input.cursor ? decodeCursor(input.cursor) : null
  if (input.cursor && !cursor) return buildTraceEmptyResult('invalid_cursor')
  if (cursor && input.scope && cursorScopeMismatch(cursor, input.scope)) {
    return buildTraceEmptyResult('cursor_scope_mismatch')
  }

  const queryTerms = tokenize(input.query ?? '')
  if (queryTerms.length === 0 && !hasQueryContext(input, cursor)) {
    return buildTraceEmptyResult('ambiguous_query')
  }
  return { cursor, queryTerms, since: since ?? undefined, until: until ?? undefined }
}

function scopedSummaries(
  input: TraceQueryInput,
  records: TraceQueryRecordSummary[],
  prepared: PreparedQuery
) {
  const scope = prepared.cursor ? cursorScope(prepared.cursor) : input.scope
  return records.filter((summary) => {
    if (scope && !sameScope(summary.scope, scope)) return false
    if (prepared.cursor && summary.id !== prepared.cursor.sessionId) return false
    const startedAt = Date.parse(summary.startedAt)
    const endedAt = startedAt + summary.durationMs
    if (prepared.since !== undefined && endedAt < prepared.since) return false
    if (prepared.until !== undefined && startedAt > prepared.until) return false
    return true
  })
}

function currentSessionSummary(
  session: TraceHistorySession,
  existing?: TraceQueryRecordSummary
): TraceQueryRecordSummary {
  return {
    durationMs: session.durationMs,
    id: session.id,
    ...(session.scope ? { scope: structuredClone(session.scope) } : {}),
    searchTerms: tokenize(
      [
        session.id,
        existing?.title ?? '',
        ...session.events.flatMap((event) => [
          event.label,
          event.text ?? '',
          event.target?.name ?? '',
          ...(event.changes?.map((change) => change.property) ?? [])
        ])
      ].join(' ')
    ),
    startedAt: session.startedAt,
    title: existing?.title ?? 'Narrated session'
  }
}

function withCurrentSession(dependencies: TraceQueryDependencies): TraceQueryDependencies {
  const current = dependencies.currentSession
  if (!current) return dependencies
  const existing = dependencies.records.find((record) => record.id === current.id)
  return {
    ...dependencies,
    records: [
      currentSessionSummary(current, existing),
      ...dependencies.records.filter((record) => record.id !== current.id)
    ]
  }
}

async function rankedSessions(
  input: TraceQueryInput,
  dependencies: TraceQueryDependencies,
  prepared: PreparedQuery,
  scoped: TraceQueryRecordSummary[]
) {
  const scope = prepared.cursor ? cursorScope(prepared.cursor) : input.scope
  const candidates = scoped
    .map((summary) => ({ score: summaryScore(summary, prepared.queryTerms, input), summary }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        Date.parse(right.summary.startedAt) - Date.parse(left.summary.startedAt) ||
        left.summary.id.localeCompare(right.summary.id)
    )
    .slice(0, MAX_SESSIONS_READ)
  const sessions = await Promise.all(
    candidates.map(async ({ summary }) => ({
      session:
        dependencies.currentSession?.id === summary.id
          ? structuredClone(dependencies.currentSession)
          : await dependencies.readSession(summary.id),
      summary
    }))
  )
  const scored = sessions
    .flatMap(({ session, summary }) =>
      session && (!scope || sameScope(session.scope ?? summary.scope, scope))
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

function selectorCount(input: TraceQueryInput) {
  return [
    input.latestSpokenTurn === true,
    Boolean(input.spokenText?.trim()),
    Boolean(input.spokenTurnId)
  ].filter(Boolean).length
}

export function hasTraceSpokenTurnSelector(input: TraceQueryInput) {
  return selectorCount(input) > 0
}

function validSpokenSelector(input: TraceQueryInput) {
  return (
    selectorCount(input) === 1 &&
    !input.cursor &&
    !input.query?.trim() &&
    input.since === undefined &&
    input.until === undefined
  )
}

function normalizedSpokenText(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

export function resolveTraceSpokenTurn(
  selector: TraceSpokenTurnSelector,
  turns: readonly TraceQuerySpokenTurn[],
  options: { includeExpired?: boolean; nowEpochMs?: number } = {}
): TraceSpokenTurnResolution {
  if (selector.scope && !selector.scope.workspaceId) {
    return { reason: 'spoken_turn_scope_unavailable', status: 'error' }
  }
  const count = [
    selector.latest === true,
    Boolean(selector.text?.trim()),
    Boolean(selector.turnId)
  ].filter(Boolean).length
  if (count !== 1) return { reason: 'invalid_spoken_turn_selector', status: 'error' }

  const nowEpochMs = options.nowEpochMs ?? Date.now()
  const scoped = turns.filter(
    (turn) =>
      (options.includeExpired === true ||
        turn.expiresAtEpochMs === undefined ||
        turn.expiresAtEpochMs > nowEpochMs) &&
      (!selector.runtimeTabBindingId ||
        turn.runtimeTabBindingId === selector.runtimeTabBindingId) &&
      (!selector.scope || sameExactScope(turn.scope, selector.scope))
  )
  let candidates: TraceQuerySpokenTurn[]
  if (selector.turnId) {
    candidates = scoped.filter((turn) => turn.id === selector.turnId)
  } else if (selector.text?.trim()) {
    const query = normalizedSpokenText(selector.text)
    candidates = scoped.filter((turn) => normalizedSpokenText(turn.text).includes(query))
  } else {
    candidates = [...scoped]
      .sort(
        (first, second) =>
          second.sequence - first.sequence || second.endedAtEpochMs - first.endedAtEpochMs
      )
      .slice(0, 1)
  }

  if (candidates.length === 0) return { reason: 'spoken_turn_not_found', status: 'empty' }
  if (candidates.length > 1) {
    return {
      candidates: candidates.map((turn) => structuredClone(turn)),
      reason: 'ambiguous_spoken_turn',
      status: 'ambiguous'
    }
  }
  return { status: 'matched', turn: structuredClone(candidates[0]) }
}

function validTurnWindow(turn: TraceQuerySpokenTurn) {
  return (
    Number.isFinite(turn.startedAtEpochMs) &&
    Number.isFinite(turn.endedAtEpochMs) &&
    turn.startedAtEpochMs <= turn.endedAtEpochMs &&
    turn.endedAtEpochMs - turn.startedAtEpochMs <= 60_000
  )
}

function windowOverlaps(startedAtMs: number, durationMs: number, turn: TraceQuerySpokenTurn) {
  const endedAtMs = startedAtMs + Math.max(0, durationMs)
  return startedAtMs <= turn.endedAtEpochMs && endedAtMs >= turn.startedAtEpochMs
}

function candidateSummaries(dependencies: TraceQueryDependencies, turn: TraceQuerySpokenTurn) {
  const candidates = dependencies.records.filter((summary) => {
    if (!sameExactScope(summary.scope, turn.scope)) return false
    const startedAtMs = Date.parse(summary.startedAt)
    return (
      Number.isFinite(startedAtMs) &&
      Number.isFinite(summary.durationMs) &&
      windowOverlaps(startedAtMs, summary.durationMs, turn)
    )
  })
  candidates.sort(
    (first, second) =>
      Date.parse(first.startedAt) - Date.parse(second.startedAt) ||
      first.id.localeCompare(second.id)
  )
  return candidates
}

function matchingEvents(
  session: TraceHistorySession,
  turn: TraceQuerySpokenTurn
): TraceHistoryEvent[] | null {
  const startedAtMs = Date.parse(session.startedAt)
  if (!Number.isFinite(startedAtMs)) return null
  const events: TraceHistoryEvent[] = []
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

function spokenWindowResult(
  entries: ExactWindowEntry[],
  sourceSpokenTurn: TraceQueryPublicSpokenTurn,
  scanned: TraceQueryResult['scanned'],
  status: 'ambiguous' | 'matched',
  reason?: 'trace_window_truncated' | 'trace_window_unsettled'
): TraceQueryResult {
  let remaining = MAX_EXACT_WINDOW_EVENTS
  const matches = entries.flatMap(({ events, session, summary }) => {
    if (remaining <= 0) return []
    const boundedEvents = events.slice(0, remaining)
    remaining -= boundedEvents.length
    if (boundedEvents.length === 0) return []
    return [
      buildTraceQueryMatch({
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

export async function queryTraceSpokenTurnWindow(
  input: TraceQueryInput,
  dependencies: TraceQueryDependencies
): Promise<TraceQueryResult> {
  if (!validSpokenSelector(input)) return errorResult('invalid_spoken_turn_selector')
  const resolution = resolveTraceSpokenTurn(
    {
      latest: input.latestSpokenTurn,
      runtimeTabBindingId: input.runtimeTabBindingId,
      scope: input.scope,
      text: input.spokenText,
      turnId: input.spokenTurnId
    },
    dependencies.spokenTurns ?? [],
    { includeExpired: dependencies.persistentSpokenTurns === true }
  )
  if (resolution.status === 'error') return errorResult(resolution.reason)
  if (resolution.status === 'empty') return buildTraceEmptyResult(resolution.reason)
  if (resolution.status === 'ambiguous') {
    return {
      matches: [],
      reason: resolution.reason,
      scanned: { indexCandidates: 0, sessions: 0 },
      spokenTurnCandidates: resolution.candidates.map(publicTraceSpokenTurn),
      status: 'ambiguous'
    }
  }

  const sourceSpokenTurn = publicTraceSpokenTurn(resolution.turn)
  if (!validTurnWindow(resolution.turn)) {
    return {
      matches: [],
      reason: 'malformed_trace_window',
      scanned: { indexCandidates: 0, sessions: 0 },
      sourceSpokenTurn,
      status: 'ambiguous'
    }
  }
  const candidates = candidateSummaries(dependencies, resolution.turn)
  if (candidates.length > MAX_EXACT_WINDOW_SESSIONS) {
    return {
      matches: [],
      reason: 'trace_window_truncated',
      scanned: { indexCandidates: candidates.length, sessions: 0 },
      sourceSpokenTurn,
      status: 'ambiguous'
    }
  }
  const loaded = await Promise.all(
    candidates.map(async (summary) => ({
      session:
        dependencies.currentSession?.id === summary.id
          ? structuredClone(dependencies.currentSession)
          : await dependencies.readSession(summary.id),
      summary
    }))
  )
  if (
    loaded.some(
      ({ session, summary }) =>
        !session || !sameExactScope(session.scope ?? summary.scope, resolution.turn.scope)
    )
  ) {
    return {
      matches: [],
      reason: 'trace_window_incomplete',
      scanned: { indexCandidates: candidates.length, sessions: loaded.length },
      sourceSpokenTurn,
      status: 'ambiguous'
    }
  }

  const entries: ExactWindowEntry[] = []
  for (const { session, summary } of loaded) {
    if (!session) continue
    const events = matchingEvents(session, resolution.turn)
    if (!events) {
      return {
        matches: [],
        reason: 'malformed_trace_window',
        scanned: { indexCandidates: candidates.length, sessions: loaded.length },
        sourceSpokenTurn,
        status: 'ambiguous'
      }
    }
    if (events.length > 0) entries.push({ events, session, summary })
  }

  const scanned = { indexCandidates: candidates.length, sessions: loaded.length }
  const eventCount = entries.reduce((total, entry) => total + entry.events.length, 0)
  const currentUnsettled =
    dependencies.currentSessionSettled === false &&
    Boolean(
      dependencies.currentSession &&
      candidates.some((candidate) => candidate.id === dependencies.currentSession?.id)
    )
  if (currentUnsettled) {
    return spokenWindowResult(
      entries,
      sourceSpokenTurn,
      scanned,
      'ambiguous',
      'trace_window_unsettled'
    )
  }
  if (eventCount > MAX_EXACT_WINDOW_EVENTS) {
    return spokenWindowResult(
      entries,
      sourceSpokenTurn,
      scanned,
      'ambiguous',
      'trace_window_truncated'
    )
  }
  if (eventCount === 0) {
    return buildTraceEmptyResult('no_trace_in_spoken_window', scanned, sourceSpokenTurn)
  }
  return spokenWindowResult(entries, sourceSpokenTurn, scanned, 'matched')
}

export async function queryTraceRecords(
  input: TraceQueryInput,
  dependencies: TraceQueryDependencies
): Promise<TraceQueryResult> {
  const resolvedDependencies = withCurrentSession(dependencies)
  if (hasTraceSpokenTurnSelector(input)) {
    return queryTraceSpokenTurnWindow(input, resolvedDependencies)
  }
  const prepared = prepareQuery(input)
  if ('status' in prepared) return prepared

  const scoped = scopedSummaries(input, resolvedDependencies.records, prepared)
  if (scoped.length === 0) {
    const hasLegacyHistory =
      !prepared.cursor &&
      resolvedDependencies.records.some(
        (summary) =>
          !summary.scope ||
          (input.scope !== undefined &&
            summary.scope.documentId === input.scope.documentId &&
            summary.scope.pageId === input.scope.pageId &&
            summary.scope.workspaceId === undefined &&
            input.scope.workspaceId !== undefined)
      )
    return buildTraceEmptyResult(hasLegacyHistory ? 'unscoped_history' : 'no_relevant_trace')
  }

  const { candidates, scored, sessions } = await rankedSessions(
    input,
    resolvedDependencies,
    prepared,
    scoped
  )
  if (scored.length === 0) {
    return buildTraceEmptyResult('no_relevant_trace', {
      indexCandidates: candidates.length,
      sessions: sessions.length
    })
  }

  const limit = Math.max(1, Math.min(MAX_RESULTS, input.limit ?? 3))
  const matches = scored.slice(0, limit).map(buildTraceQueryMatch)
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
      documentId: first.scope.documentId,
      eventIds: first.events.map((event) => event.id),
      pageId: first.scope.pageId,
      sessionId: first.sessionId,
      version: 3,
      workspaceId: first.scope.workspaceId
    })
  }
}
