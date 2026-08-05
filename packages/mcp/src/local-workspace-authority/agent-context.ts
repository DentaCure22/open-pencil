import { createHash } from 'node:crypto'
import path from 'node:path'

import { objectGraphConnectionsOnPage } from '@open-pencil/scene-graph'
import type { Rect, SceneNode } from '@open-pencil/scene-graph'

import type { AuthorityBoardDocument } from './document'
import type { LocalWorkspaceTraceGesture } from './trace'
import type { LocalWorkspaceIdentity } from './types'

export const LOCAL_WORKSPACE_TRACE_CONTEXT_FILE = 'trace-context.json'
export const LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY = 'trace-evidence'
export const LOCAL_WORKSPACE_TRACE_CONTEXT_TTL_MS = 15 * 60 * 1_000

type DirectTraceContextReason =
  | 'candidate_list_truncated'
  | 'connections_truncated'
  | 'page_missing'
  | 'target_missing'

type DirectTraceObject = {
  bounds?: Rect
  id: string
  name: string
  type: SceneNode['type']
  visible: boolean
}

export type LocalWorkspaceDirectTraceContext = {
  captured_at: string
  connections: Array<{
    id: string
    kind: string
    label?: string
    source_id: string
    source_port: string
    target_id: string
    target_port: string
  }>
  contract: 'trace-context/v1'
  evidence?: {
    evidence_id: string
    mime_type: 'image/png'
    path: string
    status: 'missing' | 'ready'
  }
  expires_at: string
  gesture_id: string
  objects: DirectTraceObject[]
  omissions: {
    collapsed_object_count: number
    connections_truncated: boolean
    missing_object_count: number
    objects_truncated: boolean
    recorded_object_count: number
    resolved_object_count: number
  }
  primary_object_id?: string
  reasons?: DirectTraceContextReason[]
  region: LocalWorkspaceTraceGesture['geometry']
  scope: {
    document_id: string
    page_id: string
    page_name?: string
    workspace_id: string
  }
  session_id: string
  status: 'ambiguous' | 'ready'
  workspace_revision: number
}

function finiteBounds(bounds: Rect): Rect | undefined {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    ? bounds
    : undefined
}

export function localWorkspaceTraceEvidencePath(root: string, evidenceId: string): string {
  const fileName = `${createHash('sha256').update(evidenceId).digest('hex')}.png`
  return path.join(root, LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY, fileName)
}

export function pageOwnedTraceAncestor(
  document: AuthorityBoardDocument,
  pageId: string,
  objectId: string
): SceneNode | undefined {
  let current = document.graph.getNode(objectId)
  if (!current || current.type === 'CANVAS' || !document.graph.isDescendant(current.id, pageId)) {
    return undefined
  }
  while (current.parentId !== pageId) {
    if (!current.parentId) return undefined
    const parent = document.graph.getNode(current.parentId)
    if (!parent || parent.type === 'CANVAS') return undefined
    current = parent
  }
  return current
}

function directTraceObject(document: AuthorityBoardDocument, node: SceneNode): DirectTraceObject {
  const bounds = finiteBounds(document.graph.getAbsoluteBounds(node.id))
  return {
    ...(bounds ? { bounds } : {}),
    id: node.id,
    name: node.name || node.id,
    type: node.type,
    visible: node.visible
  }
}

function directTraceConnections(
  document: AuthorityBoardDocument,
  pageId: string,
  ownerIds: ReadonlySet<string>
) {
  return objectGraphConnectionsOnPage(document.graph, pageId)
    .filter(
      (connection) => ownerIds.has(connection.sourceNodeId) || ownerIds.has(connection.targetNodeId)
    )
    .slice(0, 32)
}

function directTraceReasons(input: {
  connectionsTruncated: boolean
  missingObjectCount: number
  objectsTruncated: boolean
  pageResolved: boolean
}): DirectTraceContextReason[] {
  return [
    ...(!input.pageResolved ? (['page_missing'] as const) : []),
    ...(input.objectsTruncated ? (['candidate_list_truncated'] as const) : []),
    ...(input.missingObjectCount > 0 ? (['target_missing'] as const) : []),
    ...(input.connectionsTruncated ? (['connections_truncated'] as const) : [])
  ]
}

export function buildLocalWorkspaceDirectTraceContext(input: {
  document: AuthorityBoardDocument
  evidencePath?: string
  evidenceReady: boolean
  gesture: LocalWorkspaceTraceGesture
  identity: LocalWorkspaceIdentity
  revision: number
}): LocalWorkspaceDirectTraceContext {
  const { document, gesture, identity } = input
  const page = document.graph.getNode(gesture.boardOrigin.pageId)
  const resolvedPage =
    page?.type === 'CANVAS' && page.parentId === document.graph.rootId ? page : undefined
  const requestedIds = [
    ...new Set([
      ...(gesture.candidates.primaryTargetId ? [gesture.candidates.primaryTargetId] : []),
      ...gesture.candidates.items.map(({ stableId }) => stableId)
    ])
  ]
  const resolved = resolvedPage
    ? requestedIds.flatMap((id) => {
        const node = document.graph.getNode(id)
        return node && document.graph.isDescendant(node.id, resolvedPage.id) ? [node] : []
      })
    : []
  const resolvedIds = new Set(resolved.map(({ id }) => id))
  const ownerIds = new Set<string>()
  const owners = resolvedPage
    ? resolved.flatMap((node) => {
        const owner = pageOwnedTraceAncestor(document, resolvedPage.id, node.id)
        if (!owner || ownerIds.has(owner.id)) return []
        ownerIds.add(owner.id)
        return [owner]
      })
    : []
  const primaryOwner =
    resolvedPage && gesture.candidates.primaryTargetId
      ? pageOwnedTraceAncestor(document, resolvedPage.id, gesture.candidates.primaryTargetId)
      : undefined
  const connections = resolvedPage
    ? directTraceConnections(document, resolvedPage.id, ownerIds)
    : []
  const missingObjectCount = requestedIds.filter((id) => !resolvedIds.has(id)).length
  const connectionsTruncated = connections.length === 32
  const reasons = directTraceReasons({
    connectionsTruncated,
    missingObjectCount,
    objectsTruncated: gesture.candidates.truncated,
    pageResolved: Boolean(resolvedPage)
  })
  const capturedAt = Date.parse(gesture.capturedAt)

  return {
    captured_at: gesture.capturedAt,
    connections: connections.map((connection) => ({
      id: connection.id,
      kind: connection.kind,
      ...(connection.label ? { label: connection.label } : {}),
      source_id: connection.sourceNodeId,
      source_port: connection.sourcePortId ?? connection.sourcePort,
      target_id: connection.targetNodeId,
      target_port: connection.targetPortId ?? connection.targetPort
    })),
    contract: 'trace-context/v1',
    ...(gesture.evidence && input.evidencePath
      ? {
          evidence: {
            evidence_id: gesture.evidence.evidenceId,
            mime_type: 'image/png' as const,
            path: input.evidencePath,
            status: input.evidenceReady ? ('ready' as const) : ('missing' as const)
          }
        }
      : {}),
    expires_at: new Date(capturedAt + LOCAL_WORKSPACE_TRACE_CONTEXT_TTL_MS).toISOString(),
    gesture_id: gesture.gestureId,
    objects: owners.map((owner) => directTraceObject(document, owner)),
    omissions: {
      collapsed_object_count: Math.max(0, resolved.length - owners.length),
      connections_truncated: connectionsTruncated,
      missing_object_count: missingObjectCount,
      objects_truncated: gesture.candidates.truncated,
      recorded_object_count: gesture.candidates.count,
      resolved_object_count: owners.length
    },
    ...(primaryOwner ? { primary_object_id: primaryOwner.id } : {}),
    ...(reasons.length > 0 ? { reasons } : {}),
    region: structuredClone(gesture.geometry),
    scope: {
      document_id: identity.documentId,
      page_id: gesture.boardOrigin.pageId,
      ...(resolvedPage ? { page_name: resolvedPage.name } : {}),
      workspace_id: identity.workspaceId
    },
    session_id: gesture.sessionId,
    status: reasons.length > 0 ? 'ambiguous' : 'ready',
    workspace_revision: input.revision
  }
}
