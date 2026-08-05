import { rpcEnvelopeExact, type AppRpcEnvelope, type AppRpcTarget } from '#cli/app-client'

type BoardJsonObject = { [key: string]: unknown }

export type TraceEditSelectorArgs = {
  'gesture-id'?: string
  intent?: string
  'latest-gesture'?: boolean
}

type TraceGestureResult = {
  gesture?: {
    boardOrigin: {
      contentDocumentId: string
      documentId?: string
      pageId: string
      runtimeInstanceId?: string
      workspaceId?: string
    }
    candidates: {
      items: Array<{ stableId: string }>
      primaryTargetId?: string
    }
    geometry: { pageRegion: BoardJsonObject }
    gestureId: string
  }
  reason?: string
  status: 'empty' | 'error' | 'matched'
}

export type TraceEditPreparation = {
  response: AppRpcEnvelope<BoardJsonObject>
  semanticRpcCalls: {
    board_prepare_edit: 1
    total: 2
    trace_get_gesture: 1
  }
  traceGesture: TraceGestureResult['gesture']
}

export type TraceEditRpcSender = (
  command: string,
  args: Record<string, unknown>
) => Promise<AppRpcEnvelope<unknown>>

function required(value: string | undefined, flag: string) {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${flag} is required.`)
  return trimmed
}

function boardJsonObject(value: unknown, label: string): BoardJsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} returned no result.`)
  }
  return value
}

function traceGestureResult(value: unknown): TraceGestureResult {
  const result = boardJsonObject(value, 'trace_get_gesture')
  if (result.status !== 'matched') {
    return {
      reason: typeof result.reason === 'string' ? result.reason : undefined,
      status: result.status === 'empty' || result.status === 'error' ? result.status : 'error'
    }
  }
  const gesture = boardJsonObject(result.gesture, 'trace_get_gesture gesture')
  const boardOrigin = boardJsonObject(gesture.boardOrigin, 'Trace gesture Board origin')
  const candidates = boardJsonObject(gesture.candidates, 'Trace gesture candidates')
  const geometry = boardJsonObject(gesture.geometry, 'Trace gesture geometry')
  const candidateItems = Array.isArray(candidates.items) ? candidates.items : []
  return {
    gesture: {
      boardOrigin: {
        contentDocumentId: requiredString(boardOrigin.contentDocumentId, 'contentDocumentId'),
        ...(optionalString(boardOrigin.documentId) ? { documentId: boardOrigin.documentId } : {}),
        pageId: requiredString(boardOrigin.pageId, 'pageId'),
        ...(optionalString(boardOrigin.runtimeInstanceId)
          ? { runtimeInstanceId: boardOrigin.runtimeInstanceId }
          : {}),
        ...(optionalString(boardOrigin.workspaceId) ? { workspaceId: boardOrigin.workspaceId } : {})
      },
      candidates: {
        items: candidateItems.flatMap((item) => {
          const candidate = boardJsonObject(item, 'Trace gesture candidate')
          return [{ stableId: requiredString(candidate.stableId, 'candidate stableId') }]
        }),
        ...(optionalString(candidates.primaryTargetId)
          ? { primaryTargetId: candidates.primaryTargetId }
          : {})
      },
      geometry: { pageRegion: boardJsonObject(geometry.pageRegion, 'Trace gesture page region') },
      gestureId: requiredString(gesture.gestureId, 'gestureId')
    },
    status: 'matched'
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)
  if (!result) throw new TypeError(`Trace gesture ${field} must be a non-empty string.`)
  return result
}

export function traceEditGestureRpcArgs(args: TraceEditSelectorArgs) {
  const gestureId = args['gesture-id']?.trim()
  const latest = args['latest-gesture'] === true
  if (Boolean(gestureId) === latest) {
    throw new Error('Choose exactly one of --latest-gesture or --gesture-id.')
  }
  return {
    ...(gestureId ? { gesture_id: gestureId } : {}),
    include_image: false,
    latest
  }
}

function traceEditBoardRpcArgs(gestureResult: TraceGestureResult, intent: string) {
  const gesture = gestureResult.gesture
  if (gestureResult.status !== 'matched' || !gesture) {
    const reason = gestureResult.reason ? `: ${gestureResult.reason}` : ''
    throw new Error(`Trace gesture could not be prepared${reason}.`)
  }
  const origin = gesture.boardOrigin
  if (!origin.workspaceId && !origin.documentId) {
    throw new Error(
      'Trace gesture has no exact workspace or document tab; capture a fresh gesture.'
    )
  }
  return {
    candidate_object_ids: [
      ...new Set(gesture.candidates.items.map((candidate) => candidate.stableId))
    ].slice(0, 25),
    content_document_id: origin.contentDocumentId,
    ...(origin.documentId ? { document_id: origin.documentId } : {}),
    gesture_id: gesture.gestureId,
    intent,
    page_id: origin.pageId,
    ...(gesture.candidates.primaryTargetId
      ? { primary_target_id: gesture.candidates.primaryTargetId }
      : {}),
    region: gesture.geometry.pageRegion,
    ...(origin.runtimeInstanceId ? { runtime_instance_id: origin.runtimeInstanceId } : {}),
    ...(origin.workspaceId ? { workspace_id: origin.workspaceId } : {})
  }
}

export async function prepareTraceEdit(
  args: TraceEditSelectorArgs,
  send: TraceEditRpcSender = rpcEnvelopeExact
): Promise<TraceEditPreparation> {
  const intent = required(args.intent, '--intent')
  const trace = await send('trace_get_gesture', traceEditGestureRpcArgs(args))
  const gesture = traceGestureResult(trace.result)
  const prepared = await send('board_prepare_edit', traceEditBoardRpcArgs(gesture, intent))
  return {
    response: {
      result: boardJsonObject(prepared.result, 'board_prepare_edit'),
      ...(prepared.target ? { target: prepared.target } : {})
    },
    semanticRpcCalls: {
      board_prepare_edit: 1,
      total: 2,
      trace_get_gesture: 1
    },
    traceGesture: gesture.gesture
  }
}

export function traceEditPreparationResult(preparation: TraceEditPreparation): BoardJsonObject {
  return {
    ...preparation.response.result,
    semantic_rpc_calls: preparation.semanticRpcCalls,
    trace_gesture: preparation.traceGesture
  }
}

export function traceEditPreparationTarget(
  preparation: TraceEditPreparation
): AppRpcTarget | undefined {
  return preparation.response.target
}
