import {
  createCollectionRecord,
  createReviewObject,
  createWorkspaceContext,
  createWorkspaceRelation,
  getKnowledgeWorkspace,
  workspaceRegistry,
  type WorkspaceObject,
  type WorkspaceOperation
} from '@/app/workspace'

import { activeWorkspaceObjects, projectionGeometryForObject, workspaceView } from './helpers'
import { labelPatchOperation } from './object-label'
import {
  createWorkspaceObjectProjection,
  defaultWorkspaceProjectionGeometry,
  removeWorkspaceObjectSceneBindings,
  sceneNodesForWorkspaceObject,
  syncWorkspaceRelationProjections,
  updateWorkspaceObjectProjection,
  workspaceObjectIdForSceneNode,
  workspacePluginValue
} from './projection'
import type { WorkspaceMutationApi, WorkspaceUiState } from './types'
import type { WorkspaceViewActions } from './view-actions'

export type WorkspaceObjectActions = {
  archive: (object: WorkspaceObject) => Promise<void>
  beginRelation: (object: WorkspaceObject) => Promise<void>
  createRecord: (object: WorkspaceObject) => Promise<void>
  objectForSceneNode: (sceneNodeId: string) => WorkspaceObject | null
  sendToReview: (object: WorkspaceObject) => Promise<void>
  updateLabel: (object: WorkspaceObject, value: string) => Promise<void>
}

export function createWorkspaceObjectActions(
  state: WorkspaceUiState,
  api: WorkspaceMutationApi,
  viewActions: WorkspaceViewActions
): WorkspaceObjectActions {
  function objectForSceneNode(sceneNodeId: string): WorkspaceObject | null {
    void state.store.state.sceneVersion
    const objectId = workspaceObjectIdForSceneNode(state.store.graph, sceneNodeId)
    if (!objectId) return null
    for (const workspace of workspaceRegistry.list()) {
      if (Object.hasOwn(workspace.objects, objectId)) return workspace.objects[objectId]
    }
    return null
  }

  async function updateLabel(object: WorkspaceObject, value: string): Promise<void> {
    const workspace = getKnowledgeWorkspace(object.documentId, object.pageId)
    const current = workspace?.objects[object.id]
    if (!workspace || !current) return
    const operation = labelPatchOperation(current, value.trim())
    if (!operation) return
    const updatedWorkspace = api.mutate(workspace, [operation])
    const updated = updatedWorkspace.objects[object.id]
    sceneNodesForWorkspaceObject(state.store.graph, object.id).forEach((node) =>
      updateWorkspaceObjectProjection(state.store.graph, node, updated)
    )
    await api.persist()
  }

  async function archive(object: WorkspaceObject): Promise<void> {
    const workspace = getKnowledgeWorkspace(object.documentId, object.pageId)
    const current = workspace?.objects[object.id]
    if (!workspace || !current) return
    const operations: WorkspaceOperation[] = [
      {
        expectedObjectRevision: current.revision,
        objectId: current.id,
        type: 'archive-object'
      }
    ]
    if (workspace.activeRuntimeBlockId === current.id) {
      operations.push({ blockId: null, type: 'set-runtime-owner' })
    }
    api.mutate(workspace, operations)
    removeWorkspaceObjectSceneBindings(state.store.graph, object.id)
    state.store.select([])
    await api.persist()
  }

  async function createRecord(object: WorkspaceObject): Promise<void> {
    if (object.type !== 'collection') return
    const workspace = getKnowledgeWorkspace(object.documentId, object.pageId)
    if (!workspace || !Object.hasOwn(workspace.objects, object.id)) return
    const current = workspace.objects[object.id]
    if (current.type !== 'collection') return
    const view = workspaceView(workspace, state.activeViewKind.value)
    const ordinal = activeWorkspaceObjects(workspace).length
    const record = createCollectionRecord(createWorkspaceContext(workspace), {
      collectionId: current.id,
      projections: {
        [view.id]: {
          geometry: defaultWorkspaceProjectionGeometry(current, view.kind, ordinal)
        }
      },
      title: `Record ${current.recordIds.length + 1}`
    })
    const updatedWorkspace = api.mutate(workspace, [{ object: record, type: 'create-object' }])
    const created = updatedWorkspace.objects[record.id]
    const page = state.store.graph.getNode(state.store.state.currentPageId)
    if (page) {
      const projection = createWorkspaceObjectProjection(
        state.store.graph,
        page.id,
        created,
        view,
        projectionGeometryForObject(created, view, ordinal)
      )
      state.store.select([projection.id])
    }
    await api.persist()
  }

  async function sendToReview(object: WorkspaceObject): Promise<void> {
    const existing = getKnowledgeWorkspace(object.documentId, object.pageId)
    const current = existing?.objects[object.id]
    if (!existing || !current) return
    let workspace = api.ensureViews(existing)
    const reviewView = workspaceView(workspace, 'review')
    const ordinal = activeWorkspaceObjects(workspace).length
    const selectedNodeId = state.store.selectedNode.value?.id ?? ''
    const selectedIsWorkspaceObject = Boolean(
      workspaceObjectIdForSceneNode(state.store.graph, selectedNodeId)
    )
    const reviewTarget = selectedIsWorkspaceObject ? 'selected object' : current.type
    const review = createReviewObject(createWorkspaceContext(workspace), {
      attachedObjectIds: [current.id],
      attachedRevisions: { [current.id]: current.revision },
      body: `Review ${reviewTarget}`,
      projections: {
        [reviewView.id]: {
          geometry: defaultWorkspaceProjectionGeometry(current, 'review', ordinal)
        }
      },
      reviewKind: 'question'
    })
    workspace = api.mutate(workspace, [{ object: review, type: 'create-object' }])
    await viewActions.openView({
      basePageId: workspace.pageId,
      basePageName: state.store.graph.getNode(workspace.pageId)?.name ?? workspace.name,
      kind: 'review',
      route: null
    })
    await api.persist()
  }

  async function beginRelation(object: WorkspaceObject): Promise<void> {
    const sourceId = state.relationSourceId.value
    if (!sourceId) {
      state.relationSourceId.value = object.id
      return
    }
    if (sourceId === object.id) {
      state.relationSourceId.value = null
      return
    }
    const workspace = getKnowledgeWorkspace(object.documentId, object.pageId)
    const source = workspace?.objects[sourceId]
    const target = workspace?.objects[object.id]
    if (!workspace || !source || !target) {
      state.relationSourceId.value = null
      return
    }
    const relation = createWorkspaceRelation({
      label: 'Related to',
      relationType: 'related-to',
      sourceId,
      targetId: object.id,
      workspaceId: workspace.id
    })
    const updated = api.mutate(workspace, [{ relation, type: 'connect-relation' }])
    state.relationSourceId.value = null
    for (const view of Object.values(updated.views)) {
      if (view.lifecycle !== 'active') continue
      const page = state.store.graph
        .getPages()
        .find(
          (candidate) =>
            workspacePluginValue(candidate, 'workspaceId') === updated.id &&
            workspacePluginValue(candidate, 'viewId') === view.id
        )
      if (page) syncWorkspaceRelationProjections(state.store.graph, page.id, updated, view)
    }
    await api.persist()
  }

  return { archive, beginRelation, createRecord, objectForSceneNode, sendToReview, updateLabel }
}
