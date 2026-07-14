import { saveSmylrProductionDocument } from '@/app/smylr-production/document-state'
import {
  createWorkspaceId,
  createWorkspaceView,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type KnowledgeWorkspace,
  type WorkspaceOperation
} from '@/app/workspace'

import { VIEW_KINDS } from './helpers'
import { persistKnowledgeWorkspacesToScene, workspaceDocumentId } from './persistence'
import type { WorkspaceMutationApi, WorkspaceScope, WorkspaceUiState } from './types'

export function createWorkspaceMutationApi(state: WorkspaceUiState): WorkspaceMutationApi {
  function resolveWorkspace(scope: WorkspaceScope): KnowledgeWorkspace {
    return resolveKnowledgeWorkspace({
      documentId: workspaceDocumentId(state.store.graph),
      name: `${scope.basePageName} Knowledge Workspace`,
      pageId: scope.basePageId
    })
  }

  function mutate(
    workspace: KnowledgeWorkspace,
    operations: WorkspaceOperation[]
  ): KnowledgeWorkspace {
    const outcome = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
      dryRun: false,
      expectedRevision: workspace.revision,
      idempotencyKey: createWorkspaceId('mutation'),
      operations
    })
    state.revision.value += 1
    return outcome.workspace
  }

  async function persist(): Promise<void> {
    persistKnowledgeWorkspacesToScene(state.store.graph)
    state.store.requestRender()
    await saveSmylrProductionDocument(state.store)
  }

  function ensureViews(source: KnowledgeWorkspace): KnowledgeWorkspace {
    const existingKinds = new Set(
      Object.values(source.views)
        .filter((view) => view.lifecycle === 'active')
        .map((view) => view.kind)
    )
    const operations: WorkspaceOperation[] = VIEW_KINDS.filter(
      (kind) => !existingKinds.has(kind)
    ).map((kind) => ({
      type: 'create-view',
      view: createWorkspaceView({
        kind,
        name: `${kind.charAt(0).toLocaleUpperCase()} view`,
        primary: kind === 'canvas' && existingKinds.size === 0,
        workspaceId: source.id
      })
    }))
    return operations.length > 0 ? mutate(source, operations) : source
  }

  return { ensureViews, mutate, persist, resolveWorkspace }
}
