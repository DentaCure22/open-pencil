import { Buffer } from 'node:buffer'

import type {
  TraceHistoryContextEntry,
  TraceHistoryEvent,
  TraceHistorySession,
  TraceQueryRecordSummary,
  TraceQueryScope,
  TraceQuerySpokenTurn
} from '@open-pencil/core/rpc'

import { readAuthorityBoardDocument } from './document'
import type { LocalWorkspaceTraceGesture } from './trace'
import type { LocalWorkspaceTraceFileEvent } from './trace-file-store'

const DEFAULT_TRACE_ACTIVITY_PAGE_LIMIT = 80
const MAX_TRACE_ACTIVITY_PAGE_LIMIT = 80

export const LOCAL_WORKSPACE_TRACE_ACTIVITY_PAGE_CONTRACT = 'trace-activity-page/v1'

type TraceJsonRecord = Record<string, unknown>

function jsonRecord(value: unknown): TraceJsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as TraceJsonRecord)
    : null
}

export type TraceFileSnapshot = {
  gestures: Map<string, LocalWorkspaceTraceGesture>
  sessions: Map<string, TraceHistorySession>
  spokenTurns: Map<string, TraceQuerySpokenTurn>
  summaries: Map<string, TraceQueryRecordSummary>
}

export type LocalWorkspaceTraceHistorySnapshot = {
  sessions: TraceHistorySession[]
  spokenTurns: TraceQuerySpokenTurn[]
  summaries: TraceQueryRecordSummary[]
}

export type LocalWorkspaceTraceActivityItem = {
  context: TraceHistoryContextEntry
  event: TraceHistoryEvent
  occurredAtMs: number
  scope?: TraceQueryScope
  sessionId: string
  sessionStartedAt: string
  title: string
}

export type LocalWorkspaceTraceActivityPage = {
  contract: typeof LOCAL_WORKSPACE_TRACE_ACTIVITY_PAGE_CONTRACT
  hasMore: boolean
  items: LocalWorkspaceTraceActivityItem[]
  nextCursor: string | null
}

type TraceActivityCursor = {
  atMs: number
  eventId: string
  occurredAtMs: number
  sessionId: string
}

export function replayTraceFileEvents(
  events: readonly LocalWorkspaceTraceFileEvent[]
): TraceFileSnapshot {
  const snapshot: TraceFileSnapshot = {
    gestures: new Map(),
    sessions: new Map(),
    spokenTurns: new Map(),
    summaries: new Map()
  }
  const spokenTurnSessionIds = new Map<string, string>()
  const clearSessionRecords = (sessionId: string) => {
    for (const [gestureId, gesture] of snapshot.gestures) {
      if (gesture.sessionId === sessionId) snapshot.gestures.delete(gestureId)
    }
    for (const [turnId, associatedSessionId] of spokenTurnSessionIds) {
      if (associatedSessionId !== sessionId) continue
      snapshot.spokenTurns.delete(turnId)
      spokenTurnSessionIds.delete(turnId)
    }
  }
  for (const event of events) {
    if (event.recordType === 'session-deleted') {
      snapshot.sessions.delete(event.sessionId)
      snapshot.summaries.delete(event.sessionId)
      clearSessionRecords(event.sessionId)
      continue
    }
    if (event.recordType === 'session') {
      clearSessionRecords(event.session.id)
      snapshot.sessions.set(event.session.id, structuredClone(event.session))
      snapshot.summaries.set(event.summary.id, structuredClone(event.summary))
      continue
    }
    if (event.recordType === 'gesture') {
      snapshot.gestures.set(event.gesture.gestureId, structuredClone(event.gesture))
      continue
    }
    snapshot.spokenTurns.set(event.spokenTurn.id, structuredClone(event.spokenTurn))
    if (event.sessionId) spokenTurnSessionIds.set(event.spokenTurn.id, event.sessionId)
    else spokenTurnSessionIds.delete(event.spokenTurn.id)
  }
  return snapshot
}

function traceActivityContext(
  session: TraceHistorySession,
  event: TraceHistoryEvent
): TraceHistoryContextEntry {
  return (
    session.contextDraft?.find((entry) => entry.sourceEventId === event.id) ?? {
      included: true,
      removed: false,
      sourceEventId: event.id
    }
  )
}

function compareTraceActivity(
  first: {
    event: Pick<TraceHistoryEvent, 'atMs' | 'id'>
    occurredAtMs: number
    sessionId: string
  },
  second: {
    event: Pick<TraceHistoryEvent, 'atMs' | 'id'>
    occurredAtMs: number
    sessionId: string
  }
) {
  return (
    second.occurredAtMs - first.occurredAtMs ||
    second.event.atMs - first.event.atMs ||
    first.sessionId.localeCompare(second.sessionId) ||
    first.event.id.localeCompare(second.event.id)
  )
}

function encodeTraceActivityCursor(item: LocalWorkspaceTraceActivityItem) {
  const cursor: TraceActivityCursor = {
    atMs: item.event.atMs,
    eventId: item.event.id,
    occurredAtMs: item.occurredAtMs,
    sessionId: item.sessionId
  }
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeTraceActivityCursor(value: string | undefined): TraceActivityCursor | null {
  if (value === undefined) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > 512)
    throw new TypeError('Trace activity cursor is invalid.')
  try {
    const decoded = jsonRecord(JSON.parse(Buffer.from(normalized, 'base64url').toString('utf8')))
    if (
      !decoded ||
      typeof decoded.atMs !== 'number' ||
      !Number.isFinite(decoded.atMs) ||
      typeof decoded.eventId !== 'string' ||
      !decoded.eventId ||
      typeof decoded.occurredAtMs !== 'number' ||
      !Number.isFinite(decoded.occurredAtMs) ||
      typeof decoded.sessionId !== 'string' ||
      !decoded.sessionId
    ) {
      throw new TypeError('Trace activity cursor is invalid.')
    }
    return {
      atMs: decoded.atMs,
      eventId: decoded.eventId,
      occurredAtMs: decoded.occurredAtMs,
      sessionId: decoded.sessionId
    }
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Trace activity cursor is invalid.') {
      throw error
    }
    throw new TypeError('Trace activity cursor is invalid.')
  }
}

export function traceActivityPage(
  snapshot: TraceFileSnapshot,
  input: { before?: string; limit?: number }
): LocalWorkspaceTraceActivityPage {
  const limit = input.limit ?? DEFAULT_TRACE_ACTIVITY_PAGE_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TRACE_ACTIVITY_PAGE_LIMIT) {
    throw new TypeError(
      `Trace activity limit must be between 1 and ${String(MAX_TRACE_ACTIVITY_PAGE_LIMIT)}.`
    )
  }
  const cursor = decodeTraceActivityCursor(input.before)
  const items = [...snapshot.sessions.values()]
    .flatMap((session): LocalWorkspaceTraceActivityItem[] => {
      const startedAtMs = Date.parse(session.startedAt)
      const summary = snapshot.summaries.get(session.id)
      return session.events.map((event) => ({
        context: structuredClone(traceActivityContext(session, event)),
        event: structuredClone(event),
        occurredAtMs: (Number.isNaN(startedAtMs) ? 0 : startedAtMs) + event.atMs,
        ...(session.scope ? { scope: structuredClone(session.scope) } : {}),
        sessionId: session.id,
        sessionStartedAt: session.startedAt,
        title: summary?.title || 'Recent activity'
      }))
    })
    .sort(compareTraceActivity)
  const startIndex = cursor
    ? items.findIndex(
        (item) =>
          compareTraceActivity(item, {
            event: { atMs: cursor.atMs, id: cursor.eventId },
            occurredAtMs: cursor.occurredAtMs,
            sessionId: cursor.sessionId
          }) > 0
      )
    : 0
  const safeStartIndex = startIndex < 0 ? items.length : startIndex
  const pageItems = items.slice(safeStartIndex, safeStartIndex + limit)
  const hasMore = safeStartIndex + pageItems.length < items.length
  const nextCursorItem = pageItems.at(-1)
  return {
    contract: LOCAL_WORKSPACE_TRACE_ACTIVITY_PAGE_CONTRACT,
    hasMore,
    items: pageItems,
    nextCursor: hasMore && nextCursorItem ? encodeTraceActivityCursor(nextCursorItem) : null
  }
}

type DirectTraceSelection = {
  gesture?: LocalWorkspaceTraceGesture
  spokenTurn?: TraceQuerySpokenTurn
}

type DirectTraceBoardContext = {
  pageMissing: boolean
  pageName?: string
  targetMissing: boolean
}

function traceGestureMatchesTurn(
  gesture: LocalWorkspaceTraceGesture,
  spokenTurn: TraceQuerySpokenTurn
): boolean {
  const capturedAt = Date.parse(gesture.capturedAt)
  return (
    gesture.boardOrigin.workspaceId === spokenTurn.scope.workspaceId &&
    gesture.boardOrigin.contentDocumentId === spokenTurn.scope.documentId &&
    gesture.boardOrigin.pageId === spokenTurn.scope.pageId &&
    capturedAt >= Date.parse(spokenTurn.startedAt) - 3_000 &&
    capturedAt <= Date.parse(spokenTurn.endedAt) + 3_000
  )
}

export function selectDirectTrace(snapshot: TraceFileSnapshot): DirectTraceSelection | null {
  const gestures = [...snapshot.gestures.values()].sort(
    (first, second) =>
      Date.parse(second.capturedAt) - Date.parse(first.capturedAt) ||
      second.gestureId.localeCompare(first.gestureId)
  )
  const spokenTurns = [...snapshot.spokenTurns.values()].sort(
    (first, second) =>
      Date.parse(second.endedAt) - Date.parse(first.endedAt) ||
      second.sequence - first.sequence ||
      second.id.localeCompare(first.id)
  )
  const latestGesture = gestures.at(0)
  const latestSpokenTurn = spokenTurns.at(0)
  if (!latestGesture && !latestSpokenTurn) return null
  const latestGestureAt = latestGesture
    ? Date.parse(latestGesture.capturedAt)
    : Number.NEGATIVE_INFINITY
  const latestSpokenAt = latestSpokenTurn
    ? Date.parse(latestSpokenTurn.endedAt)
    : Number.NEGATIVE_INFINITY
  const spokenTurn =
    latestSpokenTurn && (!latestGesture || latestSpokenAt >= latestGestureAt - 3_000)
      ? latestSpokenTurn
      : undefined
  return {
    gesture: spokenTurn
      ? gestures.find((candidate) => traceGestureMatchesTurn(candidate, spokenTurn))
      : latestGesture,
    ...(spokenTurn ? { spokenTurn } : {})
  }
}

function directTraceTargetIds(gesture?: LocalWorkspaceTraceGesture): Set<string> {
  const items = gesture?.candidates.items ?? []
  const targetIds = new Set(items.map(({ stableId }) => stableId))
  const primaryTargetId = gesture?.candidates.primaryTargetId
  if (primaryTargetId && !items.some(({ stableId }) => stableId === primaryTargetId)) {
    targetIds.add(primaryTargetId)
  }
  return targetIds
}

export function resolveDirectTraceBoardContext(
  documentValue: unknown,
  pageId?: string,
  gesture?: LocalWorkspaceTraceGesture
): DirectTraceBoardContext {
  try {
    const document = readAuthorityBoardDocument(documentValue)
    const page = pageId ? document.graph.getNode(pageId) : undefined
    if (page?.type !== 'CANVAS' || page.parentId !== document.graph.rootId) {
      return { pageMissing: true, targetMissing: false }
    }
    const targetMissing = [...directTraceTargetIds(gesture)].some((id) => {
      const node = document.graph.getNode(id)
      return !node || (node.id !== page.id && !document.graph.isDescendant(node.id, page.id))
    })
    return { pageMissing: false, pageName: page.name, targetMissing }
  } catch {
    return { pageMissing: true, targetMissing: false }
  }
}
