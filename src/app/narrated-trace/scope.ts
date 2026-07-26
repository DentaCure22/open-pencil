import type { EditorStore } from '@/app/editor/session'
import { readOpenPencilWorkspaceIdentity } from '@/app/workspace-document/identity'

import type { NarratedTraceScope } from './types'

export function narratedTraceScopeForStore(
  store: EditorStore,
  pageId = store.state.currentPageId
): NarratedTraceScope {
  const page = store.graph.getNode(pageId)
  const workspaceIdentity = readOpenPencilWorkspaceIdentity(store.graph)
  return {
    documentId: workspaceIdentity?.documentId ?? store.graph.rootId,
    documentName: store.state.documentName,
    pageId,
    pageName: page?.name,
    workspaceId: workspaceIdentity?.workspaceId
  }
}
