import type { TraceQuerySpokenTurn } from '@open-pencil/core/rpc'

import type { LocalWorkspaceTraceGesture } from './trace'
import type {
  LocalWorkspaceTraceEvidenceStatus,
  LocalWorkspaceTraceFileEvidenceReference
} from './trace-evidence-store'

export const LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT = 'trace-context/v2'

export type LocalWorkspaceTraceCurrentContext = {
  captured_at: string
  contract: typeof LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT
  evidence?: {
    evidence_id: string
    mime_type: 'image/png'
    path: string
    status: LocalWorkspaceTraceEvidenceStatus
  }
  expires_at: string
  gesture_id?: string
  reasons?: Array<'candidate_list_truncated' | 'page_missing' | 'target_missing'>
  region?: LocalWorkspaceTraceGesture['geometry']
  scope: {
    document_id: string
    page_id: string
    page_name?: string
    workspace_id: string
  }
  session_id?: string
  spoken_turn?: {
    ended_at: string
    id: string
    runtime_tab_binding_id?: string
    sequence: number
    started_at: string
    text: string
  }
  status: 'ambiguous' | 'ready'
  targets: {
    count: number
    items: Array<{ owner_id?: string; stable_id: string }>
    primary_stable_id?: string
    truncated: boolean
  }
  workspace_revision?: number
}

export type LocalWorkspaceTraceCurrentContextInput = {
  gesture?: LocalWorkspaceTraceGesture
  pageMissing?: boolean
  pageName?: string
  spokenTurn?: TraceQuerySpokenTurn
  targetMissing?: boolean
  workspaceRevision?: number
}

export type LocalWorkspaceTraceCurrentContextEvidence = {
  reference: LocalWorkspaceTraceFileEvidenceReference
  status: LocalWorkspaceTraceEvidenceStatus
}

type LocalWorkspaceTraceContextScope = {
  documentId: string
  pageId: string
  workspaceId: string
}

function contextScope(
  gesture?: LocalWorkspaceTraceGesture,
  spokenTurn?: TraceQuerySpokenTurn
): LocalWorkspaceTraceContextScope {
  if (!gesture && !spokenTurn) {
    throw new TypeError('Trace context requires a gesture or spoken turn.')
  }
  const gestureScope = gesture
    ? {
        documentId: gesture.boardOrigin.contentDocumentId,
        pageId: gesture.boardOrigin.pageId,
        workspaceId: gesture.boardOrigin.workspaceId
      }
    : undefined
  if (
    gestureScope &&
    spokenTurn &&
    (gestureScope.workspaceId !== spokenTurn.scope.workspaceId ||
      gestureScope.documentId !== spokenTurn.scope.documentId ||
      gestureScope.pageId !== spokenTurn.scope.pageId)
  ) {
    throw new TypeError('Trace context gesture and spoken turn must share one Board scope.')
  }
  return gestureScope ?? spokenTurn?.scope ?? unreachableTraceContext()
}

function unreachableTraceContext(): never {
  throw new TypeError('Trace context scope is unavailable.')
}

function contextCapturedAt(
  gesture?: LocalWorkspaceTraceGesture,
  spokenTurn?: TraceQuerySpokenTurn
): number {
  const capturedAt = Date.parse(gesture?.capturedAt ?? spokenTurn?.endedAt ?? '')
  if (!Number.isFinite(capturedAt)) {
    throw new TypeError('Trace gesture capturedAt must be an ISO date.')
  }
  return capturedAt
}

function contextReasons(
  input: LocalWorkspaceTraceCurrentContextInput
): NonNullable<LocalWorkspaceTraceCurrentContext['reasons']> {
  const reasons: NonNullable<LocalWorkspaceTraceCurrentContext['reasons']> = []
  if (input.pageMissing) reasons.push('page_missing')
  if (input.targetMissing) reasons.push('target_missing')
  if (input.gesture?.candidates.truncated) reasons.push('candidate_list_truncated')
  return reasons
}

function contextTargets(
  gesture?: LocalWorkspaceTraceGesture
): LocalWorkspaceTraceCurrentContext['targets'] {
  return {
    count: gesture?.candidates.count ?? 0,
    items: (gesture?.candidates.items ?? []).map(({ ownerId, stableId }) => ({
      ...(ownerId ? { owner_id: ownerId } : {}),
      stable_id: stableId
    })),
    ...(gesture?.candidates.primaryTargetId
      ? { primary_stable_id: gesture.candidates.primaryTargetId }
      : {}),
    truncated: gesture?.candidates.truncated ?? false
  }
}

function contextSpokenTurn(
  spokenTurn: TraceQuerySpokenTurn
): NonNullable<LocalWorkspaceTraceCurrentContext['spoken_turn']> {
  return {
    ended_at: spokenTurn.endedAt,
    id: spokenTurn.id,
    ...(spokenTurn.runtimeTabBindingId
      ? { runtime_tab_binding_id: spokenTurn.runtimeTabBindingId }
      : {}),
    sequence: spokenTurn.sequence,
    started_at: spokenTurn.startedAt,
    text: spokenTurn.text
  }
}

export function createTraceCurrentContext(
  input: LocalWorkspaceTraceCurrentContextInput,
  ttlMs: number,
  evidence?: LocalWorkspaceTraceCurrentContextEvidence
): LocalWorkspaceTraceCurrentContext {
  const { gesture, spokenTurn } = input
  const scope = contextScope(gesture, spokenTurn)
  const capturedAt = contextCapturedAt(gesture, spokenTurn)
  const reasons = contextReasons(input)
  return {
    captured_at: new Date(capturedAt).toISOString(),
    contract: LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT,
    ...(evidence
      ? {
          evidence: {
            evidence_id: evidence.reference.evidenceId,
            mime_type: evidence.reference.mimeType,
            path: evidence.reference.path,
            status: evidence.status
          }
        }
      : {}),
    expires_at: new Date(capturedAt + ttlMs).toISOString(),
    ...(gesture ? { gesture_id: gesture.gestureId } : {}),
    ...(reasons.length > 0 ? { reasons: [...reasons] } : {}),
    ...(gesture ? { region: structuredClone(gesture.geometry) } : {}),
    scope: {
      document_id: scope.documentId,
      page_id: scope.pageId,
      ...(input.pageName ? { page_name: input.pageName } : {}),
      workspace_id: scope.workspaceId
    },
    ...(gesture ? { session_id: gesture.sessionId } : {}),
    ...(spokenTurn ? { spoken_turn: contextSpokenTurn(spokenTurn) } : {}),
    status: reasons.length > 0 ? 'ambiguous' : 'ready',
    targets: contextTargets(gesture),
    ...(input.workspaceRevision === undefined
      ? {}
      : { workspace_revision: input.workspaceRevision })
  }
}

export function isTraceCurrentContext(value: unknown): value is LocalWorkspaceTraceCurrentContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const context = value as Partial<LocalWorkspaceTraceCurrentContext>
  const scope = context.scope
  const targets = context.targets
  if (
    context.contract !== LOCAL_WORKSPACE_TRACE_CONTEXT_CONTRACT ||
    typeof context.captured_at !== 'string' ||
    !Number.isFinite(Date.parse(context.captured_at)) ||
    typeof context.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(context.expires_at)) ||
    (context.status !== 'ready' && context.status !== 'ambiguous') ||
    !scope ||
    typeof scope.document_id !== 'string' ||
    typeof scope.page_id !== 'string' ||
    typeof scope.workspace_id !== 'string' ||
    !targets ||
    !Number.isInteger(targets.count) ||
    !Array.isArray(targets.items) ||
    typeof targets.truncated !== 'boolean'
  ) {
    return false
  }
  return targets.items.every(
    (target) =>
      Boolean(target) &&
      typeof target.stable_id === 'string' &&
      (target.owner_id === undefined || typeof target.owner_id === 'string')
  )
}
