import { nextTick } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  fitSmylrPageToViewport,
  findCurrentSmylrLiveAppFrame
} from '@/app/smylr-production/workspace'
import type {
  KnowledgeWorkspace,
  WorkspaceOperation,
  WorkspaceView,
  WorkspaceViewKind
} from '@/app/workspace'

import {
  activeWorkspaceObjects,
  liveFrameForObject,
  projectionGeometryForObject,
  workspaceView
} from './helpers'
import {
  bindWorkspaceObjectToSceneNode,
  createWorkspaceObjectProjection,
  defaultWorkspaceProjectionGeometry,
  ensureWorkspaceProjectionPage,
  syncWorkspaceRelationProjections,
  workspaceBasePageIdForPage,
  workspaceViewKindForPage
} from './projection'
import type { OpenWorkspaceViewInput, WorkspaceMutationApi, WorkspaceUiState } from './types'

export type WorkspaceViewActions = {
  activeViewForPage: (
    basePageId: string,
    pages: { canvasPageId: string; graphPageId?: string }
  ) => WorkspaceViewKind
  openView: (input: OpenWorkspaceViewInput) => Promise<void>
}

function projectionPage(
  state: WorkspaceUiState,
  workspace: KnowledgeWorkspace,
  view: WorkspaceView,
  input: OpenWorkspaceViewInput
): SceneNode {
  return ensureWorkspaceProjectionPage(state.store.graph, {
    basePageId: input.basePageId,
    basePageName: input.basePageName,
    existingGraphPageId: input.graphPageId,
    kind: view.kind,
    viewId: view.id,
    workspaceId: workspace.id
  })
}

function ensureObjectProjections(
  state: WorkspaceUiState,
  api: WorkspaceMutationApi,
  source: KnowledgeWorkspace,
  view: WorkspaceView,
  page: SceneNode
): KnowledgeWorkspace {
  const objects = activeWorkspaceObjects(source)
  const operations: WorkspaceOperation[] = []
  objects.forEach((object, ordinal) => {
    if (Object.hasOwn(object.projections, view.id)) return
    const liveFrame = view.kind === 'canvas' ? liveFrameForObject(state.store, object) : null
    const geometry = liveFrame
      ? {
          height: liveFrame.height,
          rotation: liveFrame.rotation,
          width: liveFrame.width,
          x: liveFrame.x,
          y: liveFrame.y
        }
      : defaultWorkspaceProjectionGeometry(object, view.kind, ordinal)
    operations.push({
      expectedObjectRevision: object.revision,
      objectId: object.id,
      projection: { geometry },
      type: 'set-projection',
      viewId: view.id
    })
  })

  const workspace = operations.length > 0 ? api.mutate(source, operations) : source
  activeWorkspaceObjects(workspace).forEach((object, ordinal) => {
    const geometry = projectionGeometryForObject(object, view, ordinal)
    const frame = view.kind === 'canvas' ? liveFrameForObject(state.store, object) : null
    if (frame) {
      bindWorkspaceObjectToSceneNode(state.store.graph, frame, object, view)
      return
    }
    createWorkspaceObjectProjection(state.store.graph, page.id, object, view, geometry)
  })
  syncWorkspaceRelationProjections(state.store.graph, page.id, workspace, view)
  return workspace
}

export function createWorkspaceViewActions(
  state: WorkspaceUiState,
  api: WorkspaceMutationApi
): WorkspaceViewActions {
  async function openView(input: OpenWorkspaceViewInput): Promise<void> {
    const resolved = api.resolveWorkspace({
      basePageId: input.basePageId,
      basePageName: input.basePageName,
      route: input.route ?? null
    })
    const workspace = api.ensureViews(resolved)
    const view = workspaceView(workspace, input.kind)
    const page = projectionPage(state, workspace, view, input)
    ensureObjectProjections(state, api, workspace, view, page)
    await state.store.switchPage(page.id)
    state.store.select([])
    await nextTick()
    const focus = view.kind === 'canvas' ? findCurrentSmylrLiveAppFrame(state.store) : null
    await fitSmylrPageToViewport(state.store, focus ? [focus.id] : [])
    await api.persist()
  }

  function activeViewForPage(
    basePageId: string,
    pages: { canvasPageId: string; graphPageId?: string }
  ): WorkspaceViewKind {
    void state.store.state.sceneVersion
    if (state.store.state.currentPageId === pages.canvasPageId) return 'canvas'
    if (pages.graphPageId && state.store.state.currentPageId === pages.graphPageId) return 'graph'
    const current = state.store.graph.getNode(state.store.state.currentPageId)
    if (current && workspaceBasePageIdForPage(current) === basePageId) {
      return workspaceViewKindForPage(current) ?? 'canvas'
    }
    return 'canvas'
  }

  return { activeViewForPage, openView }
}
