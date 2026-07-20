import { computed, ref } from 'vue'

import type { EditorStore } from '@/app/editor/session'

import { activeViewKindForStore, experienceProjectionForStore } from './helpers'
import { createWorkspaceInsertAction } from './insert-action'
import { createWorkspaceMutationApi } from './mutations'
import { createWorkspaceObjectActions } from './object-actions'
import { ensureKnowledgeWorkspacesHydrated } from './persistence'
import { createWorkspaceRuntimeActions } from './runtime-actions'
import type { KnowledgeWorkspaceUi, WorkspaceUiState } from './types'
import { createWorkspaceViewActions } from './view-actions'

export type {
  ActivateExperienceProjectionInput,
  ActivateExperienceProjectionResult,
  ExperienceProjectionNavigationState,
  KnowledgeWorkspaceUi,
  OpenExperienceProjectionInput,
  OpenExperienceProjectionOptions,
  OpenExperienceProjectionResult,
  OpenWorkspaceViewInput,
  WorkspaceInsertKind,
  WorkspaceInsertOptions
} from './types'

const controllers = new WeakMap<EditorStore, KnowledgeWorkspaceUi>()

function createController(store: EditorStore): KnowledgeWorkspaceUi {
  ensureKnowledgeWorkspacesHydrated(store.graph)
  const state: WorkspaceUiState = {
    activeViewKind: computed(() => {
      void store.state.sceneVersion
      return activeViewKindForStore(store)
    }),
    relationSourceId: ref<string | null>(null),
    revision: ref(0),
    store
  }
  const mutationApi = createWorkspaceMutationApi(state)
  const viewActions = createWorkspaceViewActions(state, mutationApi)
  const objectActions = createWorkspaceObjectActions(state, mutationApi, viewActions)
  const runtimeActions = createWorkspaceRuntimeActions(
    state,
    mutationApi,
    objectActions.objectForSceneNode
  )

  return {
    activateExperienceProjection: viewActions.activateExperienceProjection,
    activeViewForPage: viewActions.activeViewForPage,
    activeViewKind: state.activeViewKind,
    activateLive: runtimeActions.activateLive,
    archive: objectActions.archive,
    beginRelation: objectActions.beginRelation,
    createRecord: objectActions.createRecord,
    experienceProjection: computed(() => {
      void state.revision.value
      void store.state.sceneVersion
      void store.state.currentPageId
      void store.state.selectedIds.size
      return experienceProjectionForStore(store)
    }),
    insert: createWorkspaceInsertAction(state, mutationApi),
    objectForSceneNode: objectActions.objectForSceneNode,
    openExperienceProjection: viewActions.openExperienceProjection,
    openView: viewActions.openView,
    relationSourceId: state.relationSourceId,
    revision: state.revision,
    sendToReview: objectActions.sendToReview,
    updateLabel: objectActions.updateLabel
  }
}

export function useKnowledgeWorkspaceUi(store: EditorStore): KnowledgeWorkspaceUi {
  const existing = controllers.get(store)
  if (existing) return existing
  const controller = createController(store)
  controllers.set(store, controller)
  return controller
}
