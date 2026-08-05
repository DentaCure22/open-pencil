import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { readNarratedTraceEvidenceImageData } from './capture'
import {
  loadNarratedTraceHistory,
  readNarratedTraceRecord,
  summarizeNarratedTraceSession,
  type NarratedTraceRecordSummary
} from './history'
import { narratedTraceSession } from './state'
import type {
  NarratedTraceEvent,
  NarratedTraceEvidence,
  NarratedTraceGestureCandidate,
  NarratedTracePoint,
  NarratedTraceScope,
  NarratedTraceSession,
  NarratedTraceTarget,
  NarratedTraceViewport
} from './types'

const MAX_GESTURE_SESSIONS_READ = 24
const MAX_EPISODE_EVENTS = 24
const EPISODE_BEFORE_MS = 5_000
const EPISODE_AFTER_MS = 2_000

export type NarratedTraceGestureLookupInput = {
  gestureId?: string
  includeImage?: boolean
  latest?: boolean
}

export type NarratedTraceGestureEpisodeEvent = {
  anchor?: NarratedTraceEvent['anchor']
  at: string
  atMs: number
  evidenceId?: string
  id: string
  kind: NarratedTraceEvent['kind']
  label: string
  relativeToGestureMs: number
  target?: NarratedTraceTarget
  text?: string
}

export type NarratedTraceGesturePacketEvidence = NarratedTraceEvidence & {
  image?: { base64: string; mimeType: 'image/png' }
}

export type NarratedTraceGesturePacket = {
  boardOrigin: {
    contentDocumentId: string
    documentId?: string
    pageId: string
    runtimeInstanceId?: string
    workspaceId?: string
  }
  candidates: {
    count: number
    items: NarratedTraceGestureCandidate[]
    primaryTargetId?: string
    truncated: boolean
  }
  capturedAt: string
  contract: 'trace-gesture/v1'
  episode: {
    events: NarratedTraceGestureEpisodeEvent[]
    from: string
    to: string
    truncated: boolean
  }
  evidence?: NarratedTraceGesturePacketEvidence
  evidenceStatus?: NarratedTraceEvent['evidenceStatus']
  geometry: {
    kind: 'focus' | 'ink'
    pagePoints: Vector[]
    pageRegion: Rect
    screenBounds: Rect
    screenPoints: NarratedTracePoint[]
    viewport: NarratedTraceViewport
  }
  gestureId: string
  scope: NarratedTraceScope
  sessionId: string
  target?: NarratedTraceTarget
}

export type NarratedTraceGestureLookupResult = {
  gesture?: NarratedTraceGesturePacket
  reason?: 'gesture_not_found' | 'invalid_selector' | 'trace_read_failed'
  scanned: { sessions: number }
  status: 'empty' | 'error' | 'matched'
}

export type NarratedTraceGestureDependencies = {
  currentSession?: NarratedTraceSession | null
  readSession: (sessionId: string) => Promise<NarratedTraceSession | null>
  records: NarratedTraceRecordSummary[]
}

type SessionWithSummary = {
  session: NarratedTraceSession
  summary: NarratedTraceRecordSummary
}

type GestureOccurrence = SessionWithSummary & {
  event: NarratedTraceEvent
  occurredAtMs: number
}

function sameScope(left: NarratedTraceScope | undefined, right: NarratedTraceScope) {
  return (
    left?.documentId === right.documentId &&
    left.pageId === right.pageId &&
    left.workspaceId === right.workspaceId
  )
}

function occurredAtMs(session: NarratedTraceSession, event: NarratedTraceEvent) {
  const startedAt = Date.parse(session.startedAt)
  return (Number.isNaN(startedAt) ? 0 : startedAt) + event.atMs
}

function summaryForCurrent(current: NarratedTraceSession, records: NarratedTraceRecordSummary[]) {
  return summarizeNarratedTraceSession(
    current,
    records.find((record) => record.id === current.id)?.title
  )
}

function uniqueSummaries(
  current: NarratedTraceSession | null | undefined,
  records: NarratedTraceRecordSummary[]
) {
  return current
    ? [summaryForCurrent(current, records), ...records.filter((record) => record.id !== current.id)]
    : records
}

async function readSessions(
  summaries: NarratedTraceRecordSummary[],
  dependencies: NarratedTraceGestureDependencies
): Promise<SessionWithSummary[]> {
  const sessions = await Promise.all(
    summaries.map(async (summary) => ({
      session:
        dependencies.currentSession?.id === summary.id
          ? structuredClone(dependencies.currentSession)
          : await dependencies.readSession(summary.id),
      summary
    }))
  )
  return sessions.flatMap(({ session, summary }) => (session ? [{ session, summary }] : []))
}

async function findGesture(
  input: NarratedTraceGestureLookupInput,
  dependencies: NarratedTraceGestureDependencies
): Promise<{ occurrence: GestureOccurrence | null; sessionsRead: number }> {
  const summaries = uniqueSummaries(dependencies.currentSession, dependencies.records)
  const likely = summaries
    .filter((summary) =>
      input.gestureId
        ? summary.gestureIds?.includes(input.gestureId)
        : (summary.gestureCount ?? 0) > 0
    )
    .slice(0, MAX_GESTURE_SESSIONS_READ)
  const sessions = await readSessions(likely, dependencies)
  const occurrences = sessions
    .flatMap(({ session, summary }) =>
      session.events.flatMap((event) =>
        event.gesture
          ? [{ event, occurredAtMs: occurredAtMs(session, event), session, summary }]
          : []
      )
    )
    .filter(({ event }) => !input.gestureId || event.id === input.gestureId)
    .sort(
      (left, right) =>
        right.occurredAtMs - left.occurredAtMs || right.event.id.localeCompare(left.event.id)
    )
  return { occurrence: occurrences[0] ?? null, sessionsRead: sessions.length }
}

function overlappingSummary(
  summary: NarratedTraceRecordSummary,
  scope: NarratedTraceScope,
  fromMs: number,
  toMs: number
) {
  if (!sameScope(summary.scope, scope)) return false
  const startedAt = Date.parse(summary.startedAt)
  if (Number.isNaN(startedAt)) return false
  return startedAt <= toMs && startedAt + summary.durationMs >= fromMs
}

function episodeEvent(
  event: NarratedTraceEvent,
  absoluteAtMs: number,
  gestureAtMs: number
): NarratedTraceGestureEpisodeEvent {
  return {
    ...(event.anchor ? { anchor: structuredClone(event.anchor) } : {}),
    at: new Date(absoluteAtMs).toISOString(),
    atMs: event.atMs,
    ...(event.evidence ? { evidenceId: event.evidence.evidenceId } : {}),
    id: event.id,
    kind: event.kind,
    label: event.label,
    relativeToGestureMs: absoluteAtMs - gestureAtMs,
    ...(event.target ? { target: structuredClone(event.target) } : {}),
    ...(event.text ? { text: event.text } : {})
  }
}

async function gestureEpisode(
  occurrence: GestureOccurrence,
  dependencies: NarratedTraceGestureDependencies
) {
  const scope = occurrence.session.scope ?? occurrence.summary.scope
  if (!scope) return { events: [], truncated: false }
  const fromMs = occurrence.occurredAtMs - EPISODE_BEFORE_MS
  const toMs = occurrence.occurredAtMs + EPISODE_AFTER_MS
  const summaries = uniqueSummaries(dependencies.currentSession, dependencies.records)
    .filter((summary) => overlappingSummary(summary, scope, fromMs, toMs))
    .slice(0, MAX_GESTURE_SESSIONS_READ)
  const sessions = await readSessions(summaries, dependencies)
  const events = sessions
    .flatMap(({ session, summary }) => {
      const sessionScope = session.scope ?? summary.scope
      if (!sameScope(sessionScope, scope)) return []
      return session.events.flatMap((event) => {
        const absoluteAtMs = occurredAtMs(session, event)
        return absoluteAtMs >= fromMs && absoluteAtMs <= toMs
          ? [episodeEvent(event, absoluteAtMs, occurrence.occurredAtMs)]
          : []
      })
    })
    .sort(
      (left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id)
    )
  return {
    events: events.slice(0, MAX_EPISODE_EVENTS),
    truncated: events.length > MAX_EPISODE_EVENTS
  }
}

async function gesturePacket(
  occurrence: GestureOccurrence,
  dependencies: NarratedTraceGestureDependencies,
  includeImage: boolean
): Promise<NarratedTraceGesturePacket | null> {
  const gesture = occurrence.event.gesture
  const scope = occurrence.session.scope ?? occurrence.summary.scope
  const anchor = occurrence.event.anchor
  if (!gesture || !scope || !anchor) return null
  const episode = await gestureEpisode(occurrence, dependencies)
  const evidenceImage =
    includeImage && occurrence.event.evidence
      ? await readNarratedTraceEvidenceImageData(occurrence.event.evidence)
      : null
  const evidence = occurrence.event.evidence
    ? {
        annotation: structuredClone(occurrence.event.evidence.annotation),
        annotationBaked: occurrence.event.evidence.annotationBaked,
        capturedAtMs: occurrence.event.evidence.capturedAtMs,
        cropBounds: structuredClone(occurrence.event.evidence.cropBounds),
        evidenceId: occurrence.event.evidence.evidenceId,
        height: occurrence.event.evidence.height,
        ...(evidenceImage ? { image: evidenceImage } : {}),
        mimeType: occurrence.event.evidence.mimeType,
        omissions: structuredClone(occurrence.event.evidence.omissions),
        source: occurrence.event.evidence.source,
        targetPath: occurrence.event.evidence.targetPath,
        targetStableId: occurrence.event.evidence.targetStableId,
        width: occurrence.event.evidence.width
      }
    : undefined
  return {
    boardOrigin: {
      contentDocumentId: scope.documentId,
      ...(gesture.documentTabId ? { documentId: gesture.documentTabId } : {}),
      pageId: scope.pageId,
      ...(gesture.runtimeInstanceId ? { runtimeInstanceId: gesture.runtimeInstanceId } : {}),
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {})
    },
    candidates: {
      count: gesture.candidateCount,
      items: structuredClone(gesture.candidates),
      ...(gesture.primaryTargetId ? { primaryTargetId: gesture.primaryTargetId } : {}),
      truncated: gesture.candidatesTruncated
    },
    capturedAt: new Date(occurrence.occurredAtMs).toISOString(),
    contract: 'trace-gesture/v1',
    episode: {
      events: episode.events,
      from: new Date(occurrence.occurredAtMs - EPISODE_BEFORE_MS).toISOString(),
      to: new Date(occurrence.occurredAtMs + EPISODE_AFTER_MS).toISOString(),
      truncated: episode.truncated
    },
    ...(evidence ? { evidence } : {}),
    ...(occurrence.event.evidenceStatus ? { evidenceStatus: occurrence.event.evidenceStatus } : {}),
    geometry: {
      kind: gesture.kind,
      pagePoints: structuredClone(gesture.pagePoints),
      pageRegion: structuredClone(anchor.pageRegion),
      screenBounds: structuredClone(gesture.screenBounds),
      screenPoints: structuredClone(gesture.screenPoints),
      viewport: structuredClone(anchor.viewport)
    },
    gestureId: occurrence.event.id,
    scope: structuredClone(scope),
    sessionId: occurrence.session.id,
    ...(occurrence.event.target ? { target: structuredClone(occurrence.event.target) } : {})
  }
}

export async function getNarratedTraceGestureFromRecords(
  input: NarratedTraceGestureLookupInput,
  dependencies: NarratedTraceGestureDependencies
): Promise<NarratedTraceGestureLookupResult> {
  if (Boolean(input.latest) === Boolean(input.gestureId)) {
    return { reason: 'invalid_selector', scanned: { sessions: 0 }, status: 'error' }
  }
  const found = await findGesture(input, dependencies)
  if (!found.occurrence) {
    return {
      reason: 'gesture_not_found',
      scanned: { sessions: found.sessionsRead },
      status: 'empty'
    }
  }
  const packet = await gesturePacket(found.occurrence, dependencies, input.includeImage === true)
  if (!packet) {
    return {
      reason: 'gesture_not_found',
      scanned: { sessions: found.sessionsRead },
      status: 'empty'
    }
  }
  return { gesture: packet, scanned: { sessions: found.sessionsRead }, status: 'matched' }
}

export async function getNarratedTraceGesture(
  input: NarratedTraceGestureLookupInput
): Promise<NarratedTraceGestureLookupResult> {
  try {
    return await getNarratedTraceGestureFromRecords(input, {
      currentSession: narratedTraceSession.value,
      readSession: readNarratedTraceRecord,
      records: await loadNarratedTraceHistory()
    })
  } catch {
    return { reason: 'trace_read_failed', scanned: { sessions: 0 }, status: 'error' }
  }
}
