import type { SceneNode } from '@open-pencil/scene-graph'

import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'
import {
  createCollection,
  createDocumentBlock,
  createWorkspaceContext,
  type WorkspaceObject,
  type WorkspaceView
} from '@/app/workspace'

import {
  activeWorkspaceObjects,
  baseScope,
  projectionGeometryForObject,
  workspaceView
} from './helpers'
import { buildInsertCandidate } from './insert-builders'
import {
  bindWorkspaceObjectToSceneNode,
  createWorkspaceObjectProjection,
  defaultWorkspaceProjectionGeometry,
  ensureWorkspaceProjectionPage
} from './projection'
import type {
  WorkspaceInsertKind,
  WorkspaceInsertOptions,
  WorkspaceMutationApi,
  WorkspaceUiState
} from './types'

function geometrySeed(
  context: Parameters<typeof createDocumentBlock>[0],
  kind: WorkspaceInsertKind
): WorkspaceObject {
  if (kind === 'collection') return createCollection(context, { name: 'New collection' })
  return createDocumentBlock(context, { blockKind: 'paragraph' })
}

function validInsertOptions(kind: WorkspaceInsertKind, options: WorkspaceInsertOptions): boolean {
  if (kind !== 'live-app-block') return true
  return Boolean(options.liveFrame && isSmylrLiveAppFrameNode(options.liveFrame))
}

function projectionForCreatedObject(
  state: WorkspaceUiState,
  object: WorkspaceObject,
  view: WorkspaceView,
  page: SceneNode,
  ordinal: number,
  options: WorkspaceInsertOptions
): SceneNode {
  if (object.type === 'live-app-block' && view.kind === 'canvas' && options.liveFrame) {
    return options.liveFrame
  }
  return createWorkspaceObjectProjection(
    state.store.graph,
    page.id,
    object,
    view,
    projectionGeometryForObject(object, view, ordinal)
  )
}

export function createWorkspaceInsertAction(
  state: WorkspaceUiState,
  api: WorkspaceMutationApi
): (kind: WorkspaceInsertKind, options?: WorkspaceInsertOptions) => Promise<void> {
  return async function insert(
    kind: WorkspaceInsertKind,
    options: WorkspaceInsertOptions = {}
  ): Promise<void> {
    if (!validInsertOptions(kind, options)) return
    const scope = baseScope(state.store)
    let workspace = api.ensureViews(api.resolveWorkspace(scope))
    const view = workspaceView(workspace, state.activeViewKind.value)
    const page = ensureWorkspaceProjectionPage(state.store.graph, {
      basePageId: scope.basePageId,
      basePageName: scope.basePageName,
      existingGraphPageId: view.kind === 'graph' ? state.store.state.currentPageId : undefined,
      kind: view.kind,
      viewId: view.id,
      workspaceId: workspace.id
    })
    const context = createWorkspaceContext(workspace)
    const ordinal = activeWorkspaceObjects(workspace).length
    const geometry = defaultWorkspaceProjectionGeometry(
      geometrySeed(context, kind),
      view.kind,
      ordinal
    )
    const candidate = buildInsertCandidate(
      {
        context,
        kind,
        options,
        ordinal,
        projections: { [view.id]: { geometry } },
        state,
        view,
        workspace
      },
      workspaceView(workspace, 'canvas')
    )
    if (!candidate) return

    workspace = api.mutate(workspace, [
      { object: candidate.object, type: 'create-object' },
      ...candidate.extraOperations
    ])
    const created = workspace.objects[candidate.object.id]

    if (created.type === 'live-app-block' && options.liveFrame) {
      bindWorkspaceObjectToSceneNode(
        state.store.graph,
        options.liveFrame,
        created,
        workspaceView(workspace, 'canvas')
      )
    }
    const projection = projectionForCreatedObject(state, created, view, page, ordinal, options)
    state.store.select([projection.id])
    await api.persist()
  }
}
