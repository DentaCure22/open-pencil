import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { LocalWorkspaceIdentity } from './types'

export const LOCAL_WORKSPACE_TRACE_GESTURE_VERSION = 1
export const LOCAL_WORKSPACE_TRACE_GESTURE_LIMIT = 64
const MAX_TRACE_CANDIDATES = 25

type JsonRecord = Record<string, unknown>

export type LocalWorkspaceTraceRegion = Rect

export type LocalWorkspaceTraceEvidenceReference = {
  evidenceId: string
  mimeType?: 'image/png'
}

export type LocalWorkspaceTraceImageStatus =
  | 'included'
  | 'missing'
  | 'not_requested'
  | 'unavailable'

export type LocalWorkspaceTraceGesture = {
  boardOrigin: {
    contentDocumentId: string
    documentId: string
    pageId: string
    runtimeInstanceId: string
    workspaceId: string
  }
  candidates: {
    count: number
    /** stableId is the precise recorded hit; ownerId, when present, is its page-owned container. */
    items: Array<{ ownerId?: string; stableId: string }>
    primaryTargetId?: string
    truncated: boolean
  }
  capturedAt: string
  contract: 'trace-gesture-agent/v1'
  evidence?: LocalWorkspaceTraceEvidenceReference
  geometry: {
    kind: 'focus' | 'ink'
    pageRegion: LocalWorkspaceTraceRegion
  }
  gestureId: string
  sessionId: string
}

export type LocalWorkspaceTraceGestureRead = LocalWorkspaceTraceGesture & {
  evidence?: LocalWorkspaceTraceEvidenceReference & {
    image?: { base64: string; mimeType: 'image/png' }
  }
  imageStatus: LocalWorkspaceTraceImageStatus
}

export type PersistedLocalWorkspaceTraceGestures = {
  gestures: LocalWorkspaceTraceGesture[]
  version: typeof LOCAL_WORKSPACE_TRACE_GESTURE_VERSION
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`Trace gesture ${field} must be a non-empty string.`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Trace gesture ${field} must be finite.`)
  }
  return value
}

function traceRegion(value: unknown): LocalWorkspaceTraceRegion {
  if (!isRecord(value)) throw new TypeError('Trace gesture pageRegion must be an object.')
  const region = {
    height: finiteNumber(value.height, 'pageRegion.height'),
    width: finiteNumber(value.width, 'pageRegion.width'),
    x: finiteNumber(value.x, 'pageRegion.x'),
    y: finiteNumber(value.y, 'pageRegion.y')
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new TypeError('Trace gesture pageRegion must have positive width and height.')
  }
  return region
}

type TraceCandidateItem = { ownerId?: string; stableId: string }

function candidateItems(value: unknown): { items: TraceCandidateItem[]; observedCount: number } {
  if (!Array.isArray(value)) return { items: [], observedCount: 0 }
  const seen = new Set<string>()
  const observed = value.flatMap((item): TraceCandidateItem[] => {
    if (!isRecord(item)) return []
    const stableId = optionalString(item.stableId)
    if (!stableId || seen.has(stableId)) return []
    seen.add(stableId)
    const ownerId = optionalString(item.ownerId)
    return [{ ...(ownerId && ownerId !== stableId ? { ownerId } : {}), stableId }]
  })
  return { items: observed.slice(0, MAX_TRACE_CANDIDATES), observedCount: observed.length }
}

function candidateCount(value: unknown, minimum: number): number {
  if (value === undefined) return minimum
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new TypeError('Trace gesture candidates.count must cover the recorded candidate items.')
  }
  return value as number
}

function evidenceReference(value: unknown): LocalWorkspaceTraceEvidenceReference | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new TypeError('Trace gesture evidence must be an object.')
  const evidenceId = requiredString(value.evidenceId, 'evidence.evidenceId')
  const mimeType = optionalString(value.mimeType)
  if (mimeType !== undefined && mimeType !== 'image/png') {
    throw new TypeError('Trace gesture evidence.mimeType must be image/png.')
  }
  return { evidenceId, ...(mimeType ? { mimeType } : {}) }
}

export function normalizeLocalWorkspaceTraceGesture(
  value: unknown,
  authority: { authorityId: string; identity: LocalWorkspaceIdentity }
): LocalWorkspaceTraceGesture {
  if (!isRecord(value)) throw new TypeError('Trace gesture must be an object.')
  const boardOrigin = isRecord(value.boardOrigin) ? value.boardOrigin : null
  const candidates = isRecord(value.candidates) ? value.candidates : null
  const geometry = isRecord(value.geometry) ? value.geometry : null
  if (!boardOrigin || !candidates || !geometry) {
    throw new TypeError('Trace gesture requires boardOrigin, candidates, and geometry.')
  }
  const contentDocumentId = requiredString(
    boardOrigin.contentDocumentId,
    'boardOrigin.contentDocumentId'
  )
  const workspaceId = requiredString(boardOrigin.workspaceId, 'boardOrigin.workspaceId')
  if (contentDocumentId !== authority.identity.documentId) {
    throw new TypeError(
      `Trace gesture content document "${contentDocumentId}" is not owned by this authority.`
    )
  }
  if (workspaceId !== authority.identity.workspaceId) {
    throw new TypeError(`Trace gesture workspace "${workspaceId}" is not owned by this authority.`)
  }
  const capturedAt = requiredString(value.capturedAt, 'capturedAt')
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new TypeError('Trace gesture capturedAt must be an ISO date.')
  }
  const kind = geometry.kind
  if (kind !== 'focus' && kind !== 'ink') {
    throw new TypeError('Trace gesture geometry.kind must be focus or ink.')
  }
  const { items, observedCount } = candidateItems(candidates.items)
  const count = candidateCount(candidates.count, observedCount)
  const primaryTargetId = optionalString(candidates.primaryTargetId)
  const evidence = evidenceReference(value.evidence)
  return {
    boardOrigin: {
      contentDocumentId: authority.identity.documentId,
      documentId: authority.identity.documentId,
      pageId: requiredString(boardOrigin.pageId, 'boardOrigin.pageId'),
      runtimeInstanceId: `local-authority:${authority.authorityId}`,
      workspaceId: authority.identity.workspaceId
    },
    candidates: {
      count,
      items,
      ...(primaryTargetId ? { primaryTargetId } : {}),
      truncated:
        candidates.truncated === true ||
        observedCount > MAX_TRACE_CANDIDATES ||
        count > items.length
    },
    capturedAt: new Date(capturedAt).toISOString(),
    contract: 'trace-gesture-agent/v1',
    ...(evidence ? { evidence } : {}),
    geometry: {
      kind,
      pageRegion: traceRegion(geometry.pageRegion)
    },
    gestureId: requiredString(value.gestureId, 'gestureId'),
    sessionId: requiredString(value.sessionId, 'sessionId')
  }
}

export function isPersistedLocalWorkspaceTraceGestures(
  value: unknown
): value is PersistedLocalWorkspaceTraceGestures {
  if (!isRecord(value) || value.version !== LOCAL_WORKSPACE_TRACE_GESTURE_VERSION) return false
  return Array.isArray(value.gestures) && value.gestures.every(isLocalWorkspaceTraceGesture)
}

function isLocalWorkspaceTraceGesture(value: unknown): value is LocalWorkspaceTraceGesture {
  if (!isRecord(value)) return false
  try {
    const boardOrigin = isRecord(value.boardOrigin) ? value.boardOrigin : null
    if (!boardOrigin) return false
    const identity: LocalWorkspaceIdentity = {
      documentId: requiredString(boardOrigin.contentDocumentId, 'boardOrigin.contentDocumentId'),
      documentName: 'OpenPencil Workspace',
      roomId: 'persisted-trace-validation',
      schemaVersion: 1,
      workspaceId: requiredString(boardOrigin.workspaceId, 'boardOrigin.workspaceId')
    }
    const runtimeInstanceId = requiredString(
      boardOrigin.runtimeInstanceId,
      'boardOrigin.runtimeInstanceId'
    )
    if (!runtimeInstanceId.startsWith('local-authority:')) return false
    const normalized = normalizeLocalWorkspaceTraceGesture(value, {
      authorityId: runtimeInstanceId.slice('local-authority:'.length),
      identity
    })
    return JSON.stringify(normalized) === JSON.stringify(value)
  } catch {
    return false
  }
}
