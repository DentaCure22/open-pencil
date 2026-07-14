import type { ComputedRef, Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import type {
  KnowledgeWorkspace,
  WorkspaceObject,
  WorkspaceOperation,
  WorkspaceViewKind
} from '@/app/workspace'

export type WorkspaceInsertKind =
  | 'heading'
  | 'paragraph'
  | 'task'
  | 'collection'
  | 'graph-node'
  | 'design-artifact'
  | 'live-app-block'

export type OpenWorkspaceViewInput = {
  basePageId: string
  basePageName: string
  graphPageId?: string
  kind: WorkspaceViewKind
  route?: string | null
}

export type WorkspaceInsertOptions = {
  liveFrame?: SceneNode | null
}

export type KnowledgeWorkspaceUi = {
  activeViewForPage: (
    basePageId: string,
    pages: { canvasPageId: string; graphPageId?: string }
  ) => WorkspaceViewKind
  activeViewKind: ComputedRef<WorkspaceViewKind>
  activateLive: (object: WorkspaceObject) => Promise<void>
  archive: (object: WorkspaceObject) => Promise<void>
  beginRelation: (object: WorkspaceObject) => Promise<void>
  createRecord: (object: WorkspaceObject) => Promise<void>
  insert: (kind: WorkspaceInsertKind, options?: WorkspaceInsertOptions) => Promise<void>
  objectForSceneNode: (sceneNodeId: string) => WorkspaceObject | null
  openView: (input: OpenWorkspaceViewInput) => Promise<void>
  relationSourceId: Ref<string | null>
  revision: Ref<number>
  sendToReview: (object: WorkspaceObject) => Promise<void>
  updateLabel: (object: WorkspaceObject, value: string) => Promise<void>
}

export type WorkspaceScope = {
  basePageId: string
  basePageName: string
  route: string | null
}

export type WorkspaceUiState = {
  activeViewKind: ComputedRef<WorkspaceViewKind>
  relationSourceId: Ref<string | null>
  revision: Ref<number>
  store: EditorStore
}

export type WorkspaceMutationApi = {
  ensureViews: (workspace: KnowledgeWorkspace) => KnowledgeWorkspace
  mutate: (workspace: KnowledgeWorkspace, operations: WorkspaceOperation[]) => KnowledgeWorkspace
  persist: () => Promise<void>
  resolveWorkspace: (scope: WorkspaceScope) => KnowledgeWorkspace
}
