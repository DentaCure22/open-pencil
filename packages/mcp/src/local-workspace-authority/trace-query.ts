import {
  queryTraceRecords,
  resolveTraceRequest,
  searchTrace,
  type TraceHistorySession,
  type TraceQueryDependencies,
  type TraceQueryInput,
  type TraceQueryRecordSummary,
  type TraceQueryResult,
  type TraceQueryScope,
  type TraceQuerySpokenTurn,
  type TraceResolveInput,
  type TraceResolveResult,
  type TraceSearchResult
} from '@open-pencil/core/rpc'

import type { LocalWorkspaceAuthorityStore } from './store'

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function optionalString(value: JsonRecord, key: string): string | undefined {
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
}

function traceScope(value: unknown): TraceQueryScope | undefined {
  if (!isRecord(value)) return undefined
  const documentId = optionalString(value, 'documentId')
  const pageId = optionalString(value, 'pageId')
  if (!documentId || !pageId) return undefined
  return {
    documentId,
    ...(optionalString(value, 'documentName')
      ? { documentName: optionalString(value, 'documentName') }
      : {}),
    pageId,
    ...(optionalString(value, 'pageName') ? { pageName: optionalString(value, 'pageName') } : {}),
    ...(optionalString(value, 'workspaceId')
      ? { workspaceId: optionalString(value, 'workspaceId') }
      : {})
  }
}

function traceSummary(value: unknown): TraceQueryRecordSummary | null {
  if (!isRecord(value)) return null
  const id = optionalString(value, 'id')
  const startedAt = optionalString(value, 'startedAt')
  const title = optionalString(value, 'title')
  if (
    !id ||
    !startedAt ||
    !Number.isFinite(Date.parse(startedAt)) ||
    !title ||
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0
  ) {
    return null
  }
  return structuredClone(value) as TraceQueryRecordSummary
}

function traceSession(value: unknown): TraceHistorySession | null {
  if (!isRecord(value)) return null
  const id = optionalString(value, 'id')
  const startedAt = optionalString(value, 'startedAt')
  if (
    !id ||
    !startedAt ||
    !Number.isFinite(Date.parse(startedAt)) ||
    typeof value.durationMs !== 'number' ||
    !Number.isFinite(value.durationMs) ||
    value.durationMs < 0 ||
    !Array.isArray(value.events)
  ) {
    return null
  }
  return structuredClone(value) as TraceHistorySession
}

function traceSpokenTurn(value: unknown): TraceQuerySpokenTurn | null {
  if (!isRecord(value)) return null
  const id = optionalString(value, 'id')
  const startedAt = optionalString(value, 'startedAt')
  const endedAt = optionalString(value, 'endedAt')
  const text = optionalString(value, 'text')
  const scope = traceScope(value.scope)
  if (
    !id ||
    !startedAt ||
    !endedAt ||
    !text ||
    !scope?.workspaceId ||
    typeof value.startedAtEpochMs !== 'number' ||
    !Number.isFinite(value.startedAtEpochMs) ||
    typeof value.endedAtEpochMs !== 'number' ||
    !Number.isFinite(value.endedAtEpochMs) ||
    typeof value.sequence !== 'number' ||
    !Number.isInteger(value.sequence) ||
    value.sequence < 1
  ) {
    return null
  }
  return structuredClone(value) as TraceQuerySpokenTurn
}

function selectorCount(args: JsonRecord) {
  return [
    Boolean(optionalString(args, 'query')),
    Boolean(optionalString(args, 'session_tag')),
    Boolean(optionalString(args, 'task_cursor')),
    args.latest_spoken_turn === true,
    Boolean(optionalString(args, 'spoken_text')),
    Boolean(optionalString(args, 'spoken_turn_id'))
  ].filter(Boolean).length
}

function traceQueryInput(args: JsonRecord): TraceQueryInput {
  if (selectorCount(args) !== 1) {
    throw new Error(
      'Trace queries require exactly one of session_tag, query, task_cursor, latest_spoken_turn, spoken_turn_id, or spoken_text.'
    )
  }
  const spokenSelector =
    args.latest_spoken_turn === true ||
    Boolean(optionalString(args, 'spoken_text')) ||
    Boolean(optionalString(args, 'spoken_turn_id'))
  if (spokenSelector && (optionalString(args, 'since') || optionalString(args, 'until'))) {
    throw new Error('Spoken-turn retrieval cannot be combined with since or until.')
  }
  if (args.turn_context === true && !spokenSelector) {
    throw new Error(
      'turn_context requires a spoken-turn selector (latest_spoken_turn, spoken_turn_id, or spoken_text).'
    )
  }
  const limit = args.limit
  if (
    limit !== undefined &&
    (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 5)
  ) {
    throw new Error('Trace query limit must be an integer between 1 and 5.')
  }
  return {
    cursor: optionalString(args, 'task_cursor'),
    latestSpokenTurn: args.latest_spoken_turn === true,
    ...(typeof limit === 'number' ? { limit } : {}),
    query: optionalString(args, 'query'),
    sessionTag: optionalString(args, 'session_tag'),
    since: optionalString(args, 'since'),
    spokenText: optionalString(args, 'spoken_text'),
    spokenTurnId: optionalString(args, 'spoken_turn_id'),
    turnContext: args.turn_context === true,
    until: optionalString(args, 'until')
  }
}

async function persistedTraceDependencies(
  store: LocalWorkspaceAuthorityStore
): Promise<TraceQueryDependencies> {
  const snapshot = await store.traceHistorySnapshot()
  const records = snapshot.summaries.flatMap((record) => {
    const parsed = traceSummary(record)
    return parsed ? [parsed] : []
  })
  const spokenTurns = snapshot.spokenTurns.flatMap((turn) => {
    const parsed = traceSpokenTurn(turn)
    return parsed ? [parsed] : []
  })
  const sessions = new Map(
    snapshot.sessions.flatMap((session) => {
      const parsed = traceSession(session)
      return parsed ? [[parsed.id, parsed] as const] : []
    })
  )
  return {
    persistentSpokenTurns: true,
    readSession: async (sessionId) => structuredClone(sessions.get(sessionId) ?? null),
    records,
    spokenTurns
  }
}

function traceReadFailure(): TraceQueryResult {
  return {
    matches: [],
    reason: 'trace_read_failed',
    scanned: { indexCandidates: 0, sessions: 0 },
    status: 'error'
  }
}

export async function queryPersistedTraceHistory(
  store: LocalWorkspaceAuthorityStore,
  args: JsonRecord
): Promise<TraceQueryResult> {
  const input = traceQueryInput(args)
  try {
    return await queryTraceRecords(input, await persistedTraceDependencies(store))
  } catch {
    return traceReadFailure()
  }
}

export async function searchPersistedTrace(
  store: LocalWorkspaceAuthorityStore,
  args: JsonRecord
): Promise<TraceSearchResult | { error: string }> {
  const limit = args.limit
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit))) {
    throw new Error('search_trace limit must be an integer.')
  }
  try {
    return await searchTrace(
      {
        ...(typeof limit === 'number' ? { limit } : {}),
        pattern: optionalString(args, 'pattern'),
        since: optionalString(args, 'since'),
        until: optionalString(args, 'until')
      },
      await persistedTraceDependencies(store)
    )
  } catch {
    return { error: 'trace_read_failed' }
  }
}

export async function resolvePersistedTraceRequest(
  store: LocalWorkspaceAuthorityStore,
  args: JsonRecord
): Promise<TraceResolveResult> {
  const exactWords = optionalString(args, 'exact_words')
  if (!exactWords) {
    throw new Error('resolve_request requires exact_words: the user\u2019s words, verbatim.')
  }
  const input: TraceResolveInput = {
    exactWords,
    windowEndedAt: optionalString(args, 'window_ended_at'),
    windowStartedAt: optionalString(args, 'window_started_at')
  }
  try {
    return await resolveTraceRequest(input, await persistedTraceDependencies(store))
  } catch {
    return traceReadFailure()
  }
}
