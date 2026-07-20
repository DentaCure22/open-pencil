import type { ComputedRef, Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import type {
  ExperienceProjectionPurpose,
  KnowledgeWorkspace,
  WorkspaceObject,
  WorkspaceObjectRevisionRef,
  WorkspaceOperation,
  WorkspaceView,
  WorkspaceViewKind
} from '@/app/workspace'

import type {
  ExperienceComparisonResolution,
  ResolvedExperienceProjections
} from './experience-projections'

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

export type OpenExperienceProjectionInput = WorkspaceScope & {
  purpose: ExperienceProjectionPurpose
  rootSurface: WorkspaceObjectRevisionRef
  viewId?: string
}

export type ActivateExperienceProjectionInput = OpenExperienceProjectionInput & {
  pageId: string
  viewId: string
}

export type ActivateExperienceProjectionResult = {
  alreadyActive: boolean
  pageId: string
  purpose: ExperienceProjectionPurpose
  viewId: string
}

export type OpenExperienceProjectionOptions = {
  beforePersist?: (result: Omit<OpenExperienceProjectionResult, 'historyEntryId'>) => void
  historyEntryId?: string
  requireDurablePersistence?: boolean
}

export type OpenExperienceProjectionResult = {
  historyEntryId: string
  pageId: string
  persisted: boolean
  viewId: string
  workspaceRevision: number
}

export type ExperienceProjectionNavigationState = {
  activePurpose: ExperienceProjectionPurpose
  availablePurposes: ExperienceProjectionPurpose[]
  comparison: ExperienceComparisonResolution
  resolved: ResolvedExperienceProjections
  rootSurface: WorkspaceObjectRevisionRef
  viewIds: Partial<Record<ExperienceProjectionPurpose, string>>
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
  activateExperienceProjection: (
    input: ActivateExperienceProjectionInput
  ) => Promise<ActivateExperienceProjectionResult>
  activateLive: (object: WorkspaceObject) => Promise<void>
  archive: (object: WorkspaceObject) => Promise<void>
  beginRelation: (object: WorkspaceObject) => Promise<void>
  createRecord: (object: WorkspaceObject) => Promise<void>
  experienceProjection: ComputedRef<ExperienceProjectionNavigationState | null>
  insert: (kind: WorkspaceInsertKind, options?: WorkspaceInsertOptions) => Promise<void>
  objectForSceneNode: (sceneNodeId: string) => WorkspaceObject | null
  openView: (input: OpenWorkspaceViewInput) => Promise<void>
  openExperienceProjection: (
    input: OpenExperienceProjectionInput,
    options?: OpenExperienceProjectionOptions
  ) => Promise<OpenExperienceProjectionResult>
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
  ensureExperienceView: (
    workspace: KnowledgeWorkspace,
    input: Pick<OpenExperienceProjectionInput, 'purpose' | 'rootSurface' | 'viewId'>
  ) => { view: WorkspaceView; workspace: KnowledgeWorkspace }
  ensureViews: (workspace: KnowledgeWorkspace) => KnowledgeWorkspace
  mutate: (workspace: KnowledgeWorkspace, operations: WorkspaceOperation[]) => KnowledgeWorkspace
  persist: () => Promise<boolean>
  resolveWorkspace: (scope: WorkspaceScope) => KnowledgeWorkspace
}
