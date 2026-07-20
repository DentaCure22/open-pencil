import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import {
  HTML_BOARD_SCHEMA_VERSION,
  htmlBoardDocument,
  htmlBoardViewportInsets,
  isHtmlBoardFrame
} from '@/app/html-board/workspace'
import { saveSmylrProductionDocument } from '@/app/smylr-production/document-state'
import {
  WorkspaceDomainError,
  createWorkspaceView,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type KnowledgeWorkspace,
  type SurfaceRun,
  type WorkspaceOperation,
  type WorkspaceView
} from '@/app/workspace'
import { baseScope } from '@/app/workspace-ui/helpers'
import {
  ensureKnowledgeWorkspacesHydrated,
  persistKnowledgeWorkspacesToScene,
  workspaceDocumentId
} from '@/app/workspace-ui/persistence'
import { sceneNodesForWorkspaceObject } from '@/app/workspace-ui/projection'
import { IS_BROWSER } from '@/constants'

export function canonicalWorkspace(store: EditorStore): KnowledgeWorkspace {
  ensureKnowledgeWorkspacesHydrated(store.graph)
  const scope = baseScope(store)
  return resolveKnowledgeWorkspace({
    documentId: workspaceDocumentId(store.graph),
    name: `${scope.basePageName} Knowledge Workspace`,
    pageId: scope.basePageId
  })
}

export function ensureRecordExplorerViews(workspace: KnowledgeWorkspace): KnowledgeWorkspace {
  const required = [
    { kind: 'canvas' as const, name: 'Focus', primary: true },
    { kind: 'graph' as const, name: 'Overview', primary: false },
    { kind: 'review' as const, name: 'Review', primary: false }
  ]
  const operations: WorkspaceOperation[] = required.flatMap((candidate) => {
    const exists = Object.values(workspace.views).some(
      (view) => view.lifecycle === 'active' && view.kind === candidate.kind
    )
    return exists
      ? []
      : [
          {
            type: 'create-view' as const,
            view: createWorkspaceView({
              kind: candidate.kind,
              name: candidate.name,
              primary: candidate.primary && Object.keys(workspace.views).length === 0,
              workspaceId: workspace.id
            })
          }
        ]
  })
  if (operations.length === 0) return workspace
  return mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: workspace.revision,
    idempotencyKey: 'record-explorer-ensure-views-v1',
    operations
  }).workspace
}

export function viewFor(workspace: KnowledgeWorkspace, kind: WorkspaceView['kind']): WorkspaceView {
  const view = Object.values(workspace.views).find(
    (candidate) => candidate.lifecycle === 'active' && candidate.kind === kind
  )
  if (!view) throw new WorkspaceDomainError('not_found', `record explorer ${kind} view`)
  return view
}

export function artifactRef(board: SceneNode, surfaceId: string, sourceHash: string) {
  const document = htmlBoardDocument(board)
  return {
    artifactId: surfaceId,
    boardId: board.id,
    boardRevision: document.revision,
    boardSchemaVersion: HTML_BOARD_SCHEMA_VERSION,
    kind: 'html-board' as const,
    sourceHash
  }
}

export function surfaceFor(workspace: KnowledgeWorkspace, surfaceId: string): SurfaceRun {
  if (!Object.hasOwn(workspace.objects, surfaceId)) {
    throw new WorkspaceDomainError('not_found', `surface run ${surfaceId}`)
  }
  const object = workspace.objects[surfaceId]
  if (object.type !== 'surface-run') {
    throw new WorkspaceDomainError('not_found', `surface run ${surfaceId}`)
  }
  return object
}

export function boardForSurface(store: EditorStore, surface: SurfaceRun): SceneNode {
  const board = sceneNodesForWorkspaceObject(store.graph, surface.id).find(isHtmlBoardFrame)
  if (!board) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `surface ${surface.id} has no bound HTML board`
    )
  }
  return board
}

export async function focusBoard(store: EditorStore, board: SceneNode): Promise<void> {
  if (board.parentId && board.parentId !== store.state.currentPageId) {
    await store.switchPage(board.parentId)
  }
  store.select([board.id])
  if (IS_BROWSER) store.zoomToSelection(htmlBoardViewportInsets())
}

export async function persist(store: EditorStore): Promise<void> {
  persistKnowledgeWorkspacesToScene(store.graph)
  store.requestRender()
  await saveSmylrProductionDocument(store)
}
