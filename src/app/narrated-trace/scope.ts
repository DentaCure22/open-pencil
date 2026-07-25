import type { EditorStore } from '@/app/editor/session'
import { readOpenPencilWorkspaceIdentity } from '@/app/workspace-document/identity'
import { workspaceDocumentId } from '@/app/workspace-ui/persistence'

import type { NarratedTraceScope } from './types'

export function narratedTraceScopeForStore(
  store: EditorStore,
  pageId = store.state.currentPageId
): NarratedTraceScope {
  const page = store.graph.getNode(pageId)
  const workspaceIdentity = readOpenPencilWorkspaceIdentity(store.graph)
  return {
    documentId: workspaceIdentity?.documentId ?? workspaceDocumentId(store.graph),
    documentName: store.state.documentName,
    pageId,
    pageName: page?.name,
    workspaceId: workspaceIdentity?.workspaceId
  }
}
