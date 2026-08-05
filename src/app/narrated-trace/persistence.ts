import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { NarratedTraceEvent, NarratedTraceSession } from './types'

export type PersistedNarratedTraceGesture = {
  boardOrigin: {
    contentDocumentId: string
    pageId: string
    workspaceId: string
  }
  candidates: {
    count: number
    items: Array<{ stableId: string }>
    primaryTargetId?: string
    truncated: boolean
  }
  capturedAt: string
  contract: 'trace-gesture-agent/v1'
  evidence?: {
    evidenceId: string
    height: number
    mimeType: 'image/png'
    width: number
  }
  geometry: {
    kind: 'focus' | 'ink'
    pageRegion: Rect
  }
  gestureId: string
  sessionId: string
}

export function persistedNarratedTraceGesture(
  session: NarratedTraceSession,
  event: NarratedTraceEvent
): PersistedNarratedTraceGesture | null {
  const scope = session.scope
  const gesture = event.gesture
  const pageRegion = event.anchor?.pageRegion
  if (!scope?.workspaceId || !gesture || !pageRegion) return null
  const startedAt = Date.parse(session.startedAt)
  if (!Number.isFinite(startedAt)) return null
  const ownerIds = [
    ...new Set(
      gesture.candidates.flatMap((candidate) =>
        candidate.ownerId?.trim()
          ? [candidate.ownerId.trim()]
          : candidate.stableId.trim()
            ? [candidate.stableId.trim()]
            : []
      )
    )
  ]
  const items = ownerIds.slice(0, 25)
  const hasCompleteOwnerContract = gesture.candidates.every((candidate) =>
    candidate.ownerId?.trim()
  )
  const primaryTargetId = gesture.primaryTargetId?.trim()
  const primaryOwnerId = primaryTargetId
    ? (gesture.candidates
        .find(
          (candidate) =>
            candidate.stableId === primaryTargetId || candidate.ownerId === primaryTargetId
        )
        ?.ownerId?.trim() ?? primaryTargetId)
    : undefined
  return {
    boardOrigin: {
      contentDocumentId: scope.documentId,
      pageId: scope.pageId,
      workspaceId: scope.workspaceId
    },
    candidates: {
      count: items.length,
      items: items.map((stableId) => ({ stableId })),
      ...(primaryOwnerId ? { primaryTargetId: primaryOwnerId } : {}),
      truncated:
        gesture.candidatesTruncated ||
        ownerIds.length > items.length ||
        (!hasCompleteOwnerContract && gesture.candidateCount > items.length)
    },
    capturedAt: new Date(startedAt + event.atMs).toISOString(),
    contract: 'trace-gesture-agent/v1',
    ...(event.evidence
      ? {
          evidence: {
            evidenceId: event.evidence.evidenceId,
            height: event.evidence.height,
            mimeType: event.evidence.mimeType,
            width: event.evidence.width
          }
        }
      : {}),
    geometry: {
      kind: gesture.kind,
      pageRegion: structuredClone(pageRegion)
    },
    gestureId: event.id,
    sessionId: session.id
  }
}

export function persistedNarratedTraceGestures(
  session: NarratedTraceSession
): PersistedNarratedTraceGesture[] {
  return session.events.flatMap((event) => {
    const gesture = persistedNarratedTraceGesture(session, event)
    return gesture ? [gesture] : []
  })
}

export function latestNarratedTraceGestureEvent(
  session: NarratedTraceSession
): NarratedTraceEvent | null {
  return session.events.findLast((event) => event.gesture && event.anchor?.pageRegion) ?? null
}
