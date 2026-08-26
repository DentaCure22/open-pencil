import {
  normalizeTraceSessionTag,
  type TraceEventOrigin,
  type TraceHistoryContextEntry,
  type TraceHistoryEpisode,
  type TraceHistoryEvent,
  type TraceHistorySession,
  type TraceQueryRecordSummary,
  type TraceQueryScope,
  type TraceQuerySpokenTurn
} from '@open-pencil/core/rpc'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { LocalWorkspaceTraceEvidenceReference } from './trace'
import type { LocalWorkspaceIdentity } from './types'

type TraceAuthorityMetadata = {
  identity: LocalWorkspaceIdentity
}

type TraceJsonRecord = Record<string, unknown>

type PersistedTraceSpokenTurn = {
  endedAt: string
  id: string
  sequence: number
  startedAt: string
  value: TraceQuerySpokenTurn
}

function jsonRecord(value: unknown): TraceJsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as TraceJsonRecord)
    : null
}

function traceScope(value: unknown): TraceQueryScope | undefined {
  if (value === undefined) return undefined
  const scope = jsonRecord(value)
  if (!scope || typeof scope.documentId !== 'string' || typeof scope.pageId !== 'string') {
    throw new TypeError('Trace scope is invalid.')
  }
  return {
    documentId: scope.documentId,
    ...(typeof scope.documentName === 'string' ? { documentName: scope.documentName } : {}),
    pageId: scope.pageId,
    ...(typeof scope.pageName === 'string' ? { pageName: scope.pageName } : {}),
    ...(typeof scope.workspaceId === 'string' ? { workspaceId: scope.workspaceId } : {})
  }
}

function isTraceHistoryEvent(value: unknown): value is TraceHistoryEvent {
  const event = jsonRecord(value)
  return Boolean(
    event &&
    typeof event.atMs === 'number' &&
    Number.isFinite(event.atMs) &&
    typeof event.id === 'string' &&
    typeof event.kind === 'string' &&
    typeof event.label === 'string'
  )
}

function traceEventOrigin(value: unknown): TraceEventOrigin | undefined {
  if (value === undefined) return undefined
  const origin = jsonRecord(value)
  if (
    !origin ||
    typeof origin.episodeId !== 'string' ||
    !origin.episodeId.trim() ||
    !['board', 'chrome', 'voice'].includes(String(origin.kind)) ||
    (origin.reference !== undefined && typeof origin.reference !== 'string') ||
    (origin.sequence !== undefined &&
      (typeof origin.sequence !== 'number' ||
        !Number.isInteger(origin.sequence) ||
        origin.sequence < 1)) ||
    (origin.sourceSessionId !== undefined && typeof origin.sourceSessionId !== 'string')
  ) {
    throw new TypeError('Trace event origin is invalid.')
  }
  return structuredClone(origin) as TraceEventOrigin
}

function traceHistoryEvents(value: unknown): TraceHistoryEvent[] {
  if (!Array.isArray(value)) throw new TypeError('Trace session events must be an array.')
  return value.map((entry) => {
    if (isTraceHistoryEvent(entry)) {
      const event = structuredClone(entry)
      const origin = traceEventOrigin(jsonRecord(entry)?.origin)
      if (origin) event.origin = origin
      else delete event.origin
      return event
    }
    const event = jsonRecord(entry)
    if (!event || typeof event.id !== 'string' || !event.id.trim()) {
      throw new TypeError('Trace session event is invalid.')
    }
    const evidence = jsonRecord(event.evidence)
    return {
      atMs: typeof event.atMs === 'number' && Number.isFinite(event.atMs) ? event.atMs : 0,
      ...(evidence && typeof evidence.evidenceId === 'string'
        ? { evidence: { evidenceId: evidence.evidenceId } }
        : {}),
      id: event.id,
      kind: typeof event.kind === 'string' ? event.kind : 'trace',
      label: typeof event.label === 'string' ? event.label : '',
      ...(typeof event.text === 'string' ? { text: event.text } : {})
    }
  })
}

function traceContextDraft(
  value: unknown,
  events: readonly TraceHistoryEvent[]
): TraceHistoryContextEntry[] {
  if (!Array.isArray(value)) throw new TypeError('Trace session context draft must be an array.')
  const entries = new Map<string, TraceHistoryContextEntry>()
  for (const candidate of value) {
    const entry = jsonRecord(candidate)
    if (
      !entry ||
      typeof entry.sourceEventId !== 'string' ||
      typeof entry.included !== 'boolean' ||
      typeof entry.removed !== 'boolean'
    ) {
      throw new TypeError('Trace session context entry is invalid.')
    }
    entries.set(entry.sourceEventId, {
      ...(typeof entry.editedText === 'string' ? { editedText: entry.editedText } : {}),
      included: entry.included,
      ...(typeof entry.note === 'string' ? { note: entry.note } : {}),
      removed: entry.removed,
      sourceEventId: entry.sourceEventId
    })
  }
  return events.map(
    (event) =>
      entries.get(event.id) ?? {
        included: true,
        removed: false,
        sourceEventId: event.id
      }
  )
}

function traceRect(value: unknown): Rect | undefined {
  if (value === undefined) return undefined
  const rect = jsonRecord(value)
  if (
    !rect ||
    typeof rect.x !== 'number' ||
    !Number.isFinite(rect.x) ||
    typeof rect.y !== 'number' ||
    !Number.isFinite(rect.y) ||
    typeof rect.width !== 'number' ||
    !Number.isFinite(rect.width) ||
    typeof rect.height !== 'number' ||
    !Number.isFinite(rect.height)
  ) {
    throw new TypeError('Trace bounds are invalid.')
  }
  return { height: rect.height, width: rect.width, x: rect.x, y: rect.y }
}

function traceStrings(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new TypeError(`Trace ${field} is invalid.`)
  }
  return [...value]
}

function traceTag(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError(`Trace ${field} is invalid.`)
  const normalized = normalizeTraceSessionTag(value)
  if (!normalized) throw new TypeError(`Trace ${field} is invalid.`)
  return normalized
}

function traceSessionReferences(value: TraceJsonRecord, field: string) {
  const aliases = traceStrings(value.aliases, `${field} aliases`)
    ?.map((alias) => traceTag(alias, `${field} alias`))
    .filter((alias): alias is string => Boolean(alias))
  const tag = traceTag(value.tag, `${field} tag`)
  return {
    ...(aliases?.length ? { aliases: [...new Set(aliases)] } : {}),
    ...(tag ? { tag } : {})
  }
}

function traceEpisodes(value: unknown): TraceHistoryEpisode[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new TypeError('Trace session episodes must be an array.')
  const episodes = value.map((candidate) => {
    const episode = jsonRecord(candidate)
    if (
      !episode ||
      typeof episode.id !== 'string' ||
      !episode.id.trim() ||
      !['board', 'chrome', 'voice'].includes(String(episode.kind)) ||
      typeof episode.startedAtMs !== 'number' ||
      !Number.isFinite(episode.startedAtMs) ||
      (episode.endedAtMs !== undefined &&
        (typeof episode.endedAtMs !== 'number' ||
          !Number.isFinite(episode.endedAtMs) ||
          episode.endedAtMs < episode.startedAtMs))
    ) {
      throw new TypeError('Trace session episode is invalid.')
    }
    return structuredClone(episode) as TraceHistoryEpisode
  })
  if (new Set(episodes.map((episode) => episode.id)).size !== episodes.length) {
    throw new TypeError('Trace session episode ids must be unique.')
  }
  return episodes
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`Trace ${field} is invalid.`)
  }
  return value
}

export function traceSession(value: unknown): TraceHistorySession {
  const session = jsonRecord(value)
  if (
    !session ||
    typeof session.id !== 'string' ||
    !session.id.trim() ||
    typeof session.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(session.startedAt)) ||
    typeof session.durationMs !== 'number' ||
    !Number.isFinite(session.durationMs) ||
    !Array.isArray(session.events) ||
    !Array.isArray(session.contextDraft)
  ) {
    throw new TypeError('Trace session payload is invalid.')
  }
  const scope = traceScope(session.scope)
  const events = traceHistoryEvents(session.events)
  const episodes = traceEpisodes(session.episodes)
  const episodesById = new Map(episodes?.map((episode) => [episode.id, episode]))
  for (const event of events) {
    if (!event.origin) continue
    const episode = episodesById.get(event.origin.episodeId)
    if (!episode || episode.kind !== event.origin.kind) {
      throw new TypeError('Trace event origin must reference a matching session episode.')
    }
  }
  return {
    ...traceSessionReferences(session, 'session'),
    contextDraft: traceContextDraft(session.contextDraft, events),
    durationMs: session.durationMs,
    ...(episodes ? { episodes } : {}),
    events,
    id: session.id,
    ...(scope ? { scope } : {}),
    startedAt: session.startedAt
  }
}

export function traceSummary(value: unknown, sessionId: string): TraceQueryRecordSummary {
  const summary = jsonRecord(value)
  if (
    !summary ||
    summary.id !== sessionId ||
    typeof summary.startedAt !== 'string' ||
    typeof summary.updatedAt !== 'string' ||
    typeof summary.title !== 'string'
  ) {
    throw new TypeError('Trace session summary is invalid.')
  }
  const bounds = traceRect(summary.bounds)
  const eventCount = optionalNonNegativeInteger(summary.eventCount, 'summary.eventCount')
  const evidenceCount = optionalNonNegativeInteger(summary.evidenceCount, 'summary.evidenceCount')
  const gestureCount = optionalNonNegativeInteger(summary.gestureCount, 'summary.gestureCount')
  const gestureIds = traceStrings(summary.gestureIds, 'summary.gestureIds')
  const latestGestureAt = summary.latestGestureAt
  if (
    latestGestureAt !== undefined &&
    (typeof latestGestureAt !== 'string' || !Number.isFinite(Date.parse(latestGestureAt)))
  ) {
    throw new TypeError('Trace summary.latestGestureAt is invalid.')
  }
  const scope = traceScope(summary.scope)
  const searchTerms = traceStrings(summary.searchTerms, 'summary.searchTerms')
  const targetIds = traceStrings(summary.targetIds, 'summary.targetIds')
  return {
    ...traceSessionReferences(summary, 'summary'),
    ...(bounds ? { bounds } : {}),
    durationMs:
      typeof summary.durationMs === 'number' && Number.isFinite(summary.durationMs)
        ? summary.durationMs
        : 0,
    ...(eventCount !== undefined ? { eventCount } : {}),
    ...(evidenceCount !== undefined ? { evidenceCount } : {}),
    ...(gestureCount !== undefined ? { gestureCount } : {}),
    ...(gestureIds ? { gestureIds } : {}),
    id: summary.id,
    ...(latestGestureAt !== undefined ? { latestGestureAt } : {}),
    ...(scope ? { scope } : {}),
    ...(searchTerms ? { searchTerms } : {}),
    startedAt: summary.startedAt,
    ...(targetIds ? { targetIds } : {}),
    title: summary.title,
    updatedAt: summary.updatedAt
  }
}

export function sameTraceSessionReferences(
  session: TraceHistorySession,
  summary: TraceQueryRecordSummary
) {
  const sessionAliases = [...(session.aliases ?? [])].sort()
  const summaryAliases = [...(summary.aliases ?? [])].sort()
  return (
    session.tag === summary.tag && sessionAliases.join('\u0000') === summaryAliases.join('\u0000')
  )
}

export function traceEvidenceReferences(
  value: unknown
): Map<string, LocalWorkspaceTraceEvidenceReference> {
  const session = jsonRecord(value)
  if (!Array.isArray(session?.events)) return new Map()
  return new Map(
    session.events.flatMap((value) => {
      const event = jsonRecord(value)
      const evidence = jsonRecord(event?.evidence)
      if (
        !event ||
        typeof event.id !== 'string' ||
        !event.id.trim() ||
        !evidence ||
        typeof evidence.evidenceId !== 'string' ||
        !evidence.evidenceId.trim()
      ) {
        return []
      }
      const mimeType = evidence.mimeType === 'image/png' ? evidence.mimeType : undefined
      return [
        [
          event.id.trim(),
          {
            evidenceId: evidence.evidenceId.trim(),
            ...(mimeType ? { mimeType } : {})
          }
        ] as const
      ]
    })
  )
}

export function gestureWithEvidenceReference(
  value: unknown,
  references: Map<string, LocalWorkspaceTraceEvidenceReference>
): unknown {
  const gesture = jsonRecord(value)
  if (!gesture || gesture.evidence !== undefined) return value
  const reference =
    typeof gesture.gestureId === 'string' ? references.get(gesture.gestureId.trim()) : undefined
  return reference ? { ...gesture, evidence: reference } : gesture
}

type ValidTraceSpokenTurn = TraceJsonRecord & {
  endedAt: string
  endedAtEpochMs: number
  id: string
  sequence: number
  startedAt: string
  startedAtEpochMs: number
  text: string
}

function hasValidTraceSpokenTurnFields(turn: TraceJsonRecord): turn is ValidTraceSpokenTurn {
  return (
    typeof turn.id === 'string' &&
    Boolean(turn.id.trim()) &&
    typeof turn.sequence === 'number' &&
    Number.isInteger(turn.sequence) &&
    turn.sequence > 0 &&
    typeof turn.text === 'string' &&
    Boolean(turn.text.trim())
  )
}

function hasValidTraceSpokenTurnTiming(turn: TraceJsonRecord): turn is ValidTraceSpokenTurn {
  return (
    typeof turn.startedAt === 'string' &&
    Number.isFinite(Date.parse(turn.startedAt)) &&
    typeof turn.endedAt === 'string' &&
    Number.isFinite(Date.parse(turn.endedAt)) &&
    typeof turn.startedAtEpochMs === 'number' &&
    Number.isFinite(turn.startedAtEpochMs) &&
    typeof turn.endedAtEpochMs === 'number' &&
    Number.isFinite(turn.endedAtEpochMs) &&
    turn.startedAtEpochMs <= turn.endedAtEpochMs &&
    turn.endedAtEpochMs - turn.startedAtEpochMs <= 60_000
  )
}

function hasValidTraceSpokenTurnScope(
  scope: TraceJsonRecord | null,
  metadata: TraceAuthorityMetadata
): boolean {
  return Boolean(
    scope &&
    scope.workspaceId === metadata.identity.workspaceId &&
    scope.documentId === metadata.identity.documentId &&
    typeof scope.pageId === 'string' &&
    scope.pageId.trim()
  )
}

export function traceSpokenTurn(
  value: unknown,
  metadata: TraceAuthorityMetadata
): PersistedTraceSpokenTurn {
  const turn = jsonRecord(value)
  const scope = jsonRecord(turn?.scope)
  if (
    !turn ||
    !hasValidTraceSpokenTurnFields(turn) ||
    !hasValidTraceSpokenTurnTiming(turn) ||
    !hasValidTraceSpokenTurnScope(scope, metadata)
  ) {
    throw new TypeError('Trace spoken turn payload is invalid.')
  }
  return {
    endedAt: new Date(turn.endedAt).toISOString(),
    id: turn.id.trim(),
    sequence: turn.sequence,
    startedAt: new Date(turn.startedAt).toISOString(),
    value: structuredClone(turn) as TraceQuerySpokenTurn
  }
}
