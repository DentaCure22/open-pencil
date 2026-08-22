import { createHash } from 'node:crypto'
import path from 'node:path'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { AuthorityBoardDocument } from './document'

export const LOCAL_WORKSPACE_TRACE_CONTEXT_FILE = 'trace-context.json'
export const LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY = 'trace-evidence'
export const LOCAL_WORKSPACE_TRACE_CONTEXT_TTL_MS = 15 * 60 * 1_000

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
