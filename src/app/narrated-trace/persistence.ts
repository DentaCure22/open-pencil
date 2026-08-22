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
    /** stableId is the precise hit (a leaf, or content inside a Code Object); ownerId is its page-owned container. */
    items: Array<{ ownerId?: string; stableId: string }>
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
  // Persist the precise hits, not just their page-owned owners: collapsing here permanently
  // destroys leaf and Code Object internal IDs that workers need to bind "this exact thing".
  const seenLeafIds = new Set<string>()
  const preciseItems = gesture.candidates.flatMap((candidate) => {
    const stableId = candidate.stableId.trim()
    if (!stableId || seenLeafIds.has(stableId)) return []
    seenLeafIds.add(stableId)
    const ownerId = candidate.ownerId?.trim()
    return [{ ...(ownerId && ownerId !== stableId ? { ownerId } : {}), stableId }]
  })
  const items = preciseItems.slice(0, 25)
  const primaryTargetId = gesture.primaryTargetId?.trim()
  return {
    boardOrigin: {
      contentDocumentId: scope.documentId,
      pageId: scope.pageId,
      workspaceId: scope.workspaceId
    },
    candidates: {
      count: items.length,
      items,
      ...(primaryTargetId ? { primaryTargetId } : {}),
      truncated:
        gesture.candidatesTruncated ||
        preciseItems.length > items.length ||
        gesture.candidateCount > preciseItems.length
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
