import { nextTick } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  fitSmylrPageToViewport,
  findCurrentSmylrLiveAppFrame
} from '@/app/smylr-production/workspace'
import { createWorkspaceId, getKnowledgeWorkspace } from '@/app/workspace'
import type {
  ExperienceProjectionPurpose,
  KnowledgeWorkspace,
  SurfaceRun,
  WorkspaceGeometry,
  WorkspaceObject,
  WorkspaceOperation,
  WorkspaceView,
  WorkspaceViewKind
} from '@/app/workspace'

import { runWorkspaceDocumentTransaction } from './document-transaction'
import {
  experienceProjectionGeometry,
  removeStaleWorkspaceProjectionScene,
  syncExperienceRelationProjections
} from './experience-projection-scene'
import {
  resolveExperienceProjections,
  type ExperienceProjectionMember
} from './experience-projections'
import {
  activeWorkspaceObjects,
  liveFrameForObject,
  projectionGeometryForObject,
  workspaceView
} from './helpers'
import { workspaceDocumentId } from './persistence'
import {
  bindWorkspaceObjectToSceneNode,
  createWorkspaceObjectProjection,
  defaultWorkspaceProjectionGeometry,
  ensureWorkspaceProjectionPage,
  workspaceBasePageIdForPage,
  workspacePluginValue,
  workspaceViewKindForPage
} from './projection'
import type {
  ActivateExperienceProjectionInput,
  ActivateExperienceProjectionResult,
  OpenExperienceProjectionInput,
  OpenExperienceProjectionOptions,
  OpenExperienceProjectionResult,
  OpenWorkspaceViewInput,
  WorkspaceMutationApi,
  WorkspaceUiState
} from './types'
import { syncWorkspaceRelationProjections } from './workspace-relation-scene'

export type WorkspaceViewActions = {
  activeViewForPage: (
    basePageId: string,
    pages: { canvasPageId: string; graphPageId?: string }
  ) => WorkspaceViewKind
  activateExperienceProjection: (
    input: ActivateExperienceProjectionInput
  ) => Promise<ActivateExperienceProjectionResult>
  openExperienceProjection: (
    input: OpenExperienceProjectionInput,
    options?: OpenExperienceProjectionOptions
  ) => Promise<OpenExperienceProjectionResult>
  openView: (input: OpenWorkspaceViewInput) => Promise<void>
}

function exactExperienceProjectionPage(
  state: WorkspaceUiState,
  workspace: KnowledgeWorkspace,
  view: WorkspaceView,
  input: ActivateExperienceProjectionInput
): SceneNode {
  const page = state.store.graph.getNode(input.pageId)
  if (
    page?.type !== 'CANVAS' ||
    workspacePluginValue(page, 'kind') !== 'workspace-projection-page' ||
    workspacePluginValue(page, 'workspaceId') !== workspace.id ||
    workspacePluginValue(page, 'basePageId') !== input.basePageId ||
    workspacePluginValue(page, 'experiencePurpose') !== input.purpose ||
    workspacePluginValue(page, 'viewId') !== view.id
  ) {
    throw new Error(`workspace_experience_projection_page_mismatch: ${input.pageId}`)
  }
  return page
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

function experiencePage(
  state: WorkspaceUiState,
  workspace: KnowledgeWorkspace,
  view: WorkspaceView,
  input: OpenExperienceProjectionInput
): SceneNode {
  const purpose = view.experienceProjection?.purpose
  if (!purpose) throw new Error(`workspace_experience_view_missing_projection: ${view.id}`)
  return ensureWorkspaceProjectionPage(state.store.graph, {
    basePageId: input.basePageId,
    basePageName: input.basePageName,
    kind: view.kind,
    pageName:
      purpose === 'knowledge' || purpose === 'review'
        ? `${input.basePageName} — ${purpose.charAt(0).toLocaleUpperCase()}${purpose.slice(1)}`
        : undefined,
    purpose,
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

function exactMemberObject(
  workspace: KnowledgeWorkspace,
  member: ExperienceProjectionMember
): WorkspaceObject {
  if (!Object.hasOwn(workspace.objects, member.objectId)) {
    throw new Error(`workspace_experience_member_not_exact: ${member.objectId}@${member.revision}`)
  }
  const object = workspace.objects[member.objectId]
  if (object.lifecycle !== 'active' || object.revision !== member.revision) {
    throw new Error(`workspace_experience_member_not_exact: ${member.objectId}@${member.revision}`)
  }
  return object
}

function surfaceArtifactNode(state: WorkspaceUiState, surface: SurfaceRun): SceneNode {
  const board = state.store.graph.getNode(surface.artifact.boardId)
  if (!board) throw new Error(`workspace_experience_board_not_found: ${surface.artifact.boardId}`)
  return board
}

function geometryForNode(node: SceneNode): WorkspaceGeometry {
  return {
    height: node.height,
    rotation: node.rotation,
    width: node.width,
    x: node.x,
    y: node.y
  }
}

function enclosingGeometry(nodes: SceneNode[]): WorkspaceGeometry | undefined {
  if (nodes.length === 0) return undefined
  const left = Math.min(...nodes.map((node) => node.x))
  const top = Math.min(...nodes.map((node) => node.y))
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const bottom = Math.max(...nodes.map((node) => node.y + node.height))
  return { height: bottom - top, width: right - left, x: left, y: top }
}

function sameProjection(
  current: WorkspaceObject['projections'][string] | undefined,
  next: WorkspaceObject['projections'][string]
): boolean {
  return JSON.stringify(current) === JSON.stringify(next)
}

function protectedSurfaceBoardIds(workspace: KnowledgeWorkspace): Set<string> {
  return new Set(
    Object.values(workspace.objects)
      .filter((object): object is SurfaceRun => object.type === 'surface-run')
      .map((surface) => surface.artifact.boardId)
  )
}

function syncSurfaceArtifactVisibility(
  state: WorkspaceUiState,
  workspace: KnowledgeWorkspace,
  pageId: string,
  visibleBoardIds?: Set<string>
): void {
  for (const surface of Object.values(workspace.objects).filter(
    (object): object is SurfaceRun => object.type === 'surface-run'
  )) {
    const board = state.store.graph.getNode(surface.artifact.boardId)
    if (!board || board.parentId !== pageId) continue
    const visible = visibleBoardIds?.has(board.id) ?? true
    if (board.visible !== visible) state.store.graph.updateNode(board.id, { visible })
  }
}

function layoutOrder(
  purpose: ExperienceProjectionPurpose,
  member: ExperienceProjectionMember,
  order: number,
  companionCount: number
): number {
  if (member.role === 'root-surface' || member.role === 'companion-surface') return order
  if (purpose === 'compare') return order + 1 - companionCount
  if (purpose === 'knowledge' && member.role !== 'intent' && member.role !== 'evidence-manifest') {
    return order + 2 - companionCount
  }
  if (purpose === 'review' && member.role !== 'intent' && member.role !== 'evidence-manifest') {
    return order + 1 - companionCount
  }
  return order
}

function reconcileExperienceProjection(
  state: WorkspaceUiState,
  api: WorkspaceMutationApi,
  source: KnowledgeWorkspace,
  view: WorkspaceView,
  page: SceneNode,
  purpose: ExperienceProjectionPurpose,
  members: ExperienceProjectionMember[]
): { fitNodeIds: string[]; workspace: KnowledgeWorkspace } {
  const entries = members.map((member, order) => ({
    member,
    object: exactMemberObject(source, member),
    order
  }))
  const artifactEntries =
    purpose === 'focus' || purpose === 'compare'
      ? entries.filter(
          (entry): entry is typeof entry & { object: SurfaceRun } =>
            entry.object.type === 'surface-run' &&
            (entry.member.role === 'root-surface' || entry.member.role === 'companion-surface')
        )
      : []
  const artifactNodes = artifactEntries.map((entry) => surfaceArtifactNode(state, entry.object))
  if (purpose === 'focus' || purpose === 'compare') {
    syncSurfaceArtifactVisibility(
      state,
      source,
      page.id,
      new Set(artifactNodes.map((node) => node.id))
    )
  }
  const anchor = enclosingGeometry(artifactNodes)
  const companionCount = entries.filter((entry) => entry.member.role === 'companion-surface').length
  const geometries = new Map<string, WorkspaceGeometry>()
  for (const entry of entries) {
    const artifactIndex = artifactEntries.findIndex(
      (artifactEntry) => artifactEntry.object.id === entry.object.id
    )
    const geometry =
      artifactIndex !== -1
        ? geometryForNode(artifactNodes[artifactIndex])
        : experienceProjectionGeometry(
            entry.object,
            purpose,
            entry.member.role,
            layoutOrder(purpose, entry.member, entry.order, companionCount),
            anchor
          )
    geometries.set(entry.object.id, geometry)
  }

  const allowedObjectIds = new Set(entries.map((entry) => entry.object.id))
  const operations: WorkspaceOperation[] = []
  for (const object of Object.values(source.objects)) {
    const hasCurrentProjection = Object.hasOwn(object.projections, view.id)
    const current = hasCurrentProjection ? object.projections[view.id] : undefined
    if (!allowedObjectIds.has(object.id)) {
      if (hasCurrentProjection) {
        operations.push({
          expectedObjectRevision: object.revision,
          objectId: object.id,
          type: 'remove-projection',
          viewId: view.id
        })
      }
      continue
    }
    const entry = entries.find((candidate) => candidate.object.id === object.id)
    const geometry = geometries.get(object.id)
    if (!entry || !geometry) continue
    const projection = {
      geometry,
      order: entry.order,
      presentation: { order: entry.order, role: entry.member.role }
    }
    if (sameProjection(current, projection)) continue
    operations.push({
      expectedObjectRevision: object.revision,
      objectId: object.id,
      projection,
      type: 'set-projection',
      viewId: view.id
    })
  }
  const workspace = operations.length > 0 ? api.mutate(source, operations) : source

  removeStaleWorkspaceProjectionScene(
    state.store.graph,
    page.id,
    view.id,
    allowedObjectIds,
    protectedSurfaceBoardIds(workspace)
  )
  const fitNodeIds = artifactNodes.map((node) => node.id)
  for (const entry of entries) {
    const object = workspace.objects[entry.object.id]
    const geometry = geometries.get(entry.object.id)
    if (!geometry) continue
    const artifactIndex = artifactEntries.findIndex(
      (artifactEntry) => artifactEntry.object.id === object.id
    )
    if (artifactIndex !== -1) {
      bindWorkspaceObjectToSceneNode(state.store.graph, artifactNodes[artifactIndex], object, view)
      continue
    }
    const projection = createWorkspaceObjectProjection(
      state.store.graph,
      page.id,
      object,
      view,
      geometry,
      { order: entry.order, role: entry.member.role }
    )
    if (purpose !== 'compare') fitNodeIds.push(projection.id)
  }
  syncExperienceRelationProjections(state.store.graph, page.id, workspace, view, allowedObjectIds)
  return { fitNodeIds, workspace }
}

export function createWorkspaceViewActions(
  state: WorkspaceUiState,
  api: WorkspaceMutationApi
): WorkspaceViewActions {
  async function activateExperienceProjection(
    input: ActivateExperienceProjectionInput
  ): Promise<ActivateExperienceProjectionResult> {
    const documentId = workspaceDocumentId(state.store.graph)
    const source = getKnowledgeWorkspace(documentId, input.basePageId)
    if (!source) {
      throw new Error(`knowledge_workspace_not_found: ${documentId}/${input.basePageId}`)
    }
    if (!Object.hasOwn(source.views, input.viewId)) {
      throw new Error(`workspace_experience_view_not_found: ${input.viewId}`)
    }
    const view = source.views[input.viewId]
    if (
      view.lifecycle !== 'active' ||
      view.experienceProjection?.purpose !== input.purpose ||
      view.experienceProjection.rootSurface.objectId !== input.rootSurface.objectId ||
      view.experienceProjection.rootSurface.revision !== input.rootSurface.revision
    ) {
      throw new Error(`workspace_experience_view_mismatch: ${input.viewId}`)
    }
    const resolved = resolveExperienceProjections(source, input.rootSurface)
    if (!resolved.availablePurposes.includes(input.purpose)) {
      throw new Error(`workspace_experience_projection_unavailable: ${input.purpose}`)
    }
    const fitNodeIds = resolved.members[input.purpose]
      .map((member) => exactMemberObject(source, member))
      .map((object) => {
        if (!object.permissions.canView) {
          throw new Error(`projection_permission_denied: ${object.id}@${object.revision}`)
        }
        return object.type === 'surface-run' ? object.artifact.boardId : null
      })
      .filter((id): id is string => Boolean(id && state.store.graph.getNode(id)))
    exactExperienceProjectionPage(state, source, view, input)
    const alreadyActive = state.store.state.currentPageId === input.pageId
    await state.store.switchPage(input.pageId)
    state.store.select(fitNodeIds)
    await nextTick()
    await fitSmylrPageToViewport(state.store, fitNodeIds)
    return { alreadyActive, pageId: input.pageId, purpose: input.purpose, viewId: view.id }
  }

  async function openExperienceProjection(
    input: OpenExperienceProjectionInput,
    options: OpenExperienceProjectionOptions = {}
  ): Promise<OpenExperienceProjectionResult> {
    const historyEntryId = options.historyEntryId ?? createWorkspaceId('mutation')
    const opened = await runWorkspaceDocumentTransaction(
      state.store,
      { historyEntryId, label: `Open ${input.purpose} projection` },
      async () => {
        const source = api.resolveWorkspace(input)
        const resolved = resolveExperienceProjections(source, input.rootSurface)
        if (!resolved.availablePurposes.includes(input.purpose)) {
          throw new Error(`workspace_experience_projection_unavailable: ${input.purpose}`)
        }
        const ensured = api.ensureExperienceView(source, input)
        const view = ensured.view
        const page = experiencePage(state, ensured.workspace, view, input)
        const result = reconcileExperienceProjection(
          state,
          api,
          ensured.workspace,
          view,
          page,
          input.purpose,
          resolved.members[input.purpose]
        )
        await state.store.switchPage(page.id)
        const root = result.workspace.objects[input.rootSurface.objectId]
        const rootArtifactId =
          (input.purpose === 'focus' || input.purpose === 'compare') && root.type === 'surface-run'
            ? root.artifact.boardId
            : null
        state.store.select(
          input.purpose === 'compare' ? result.fitNodeIds : rootArtifactId ? [rootArtifactId] : []
        )
        await nextTick()
        await fitSmylrPageToViewport(state.store, result.fitNodeIds)
        const outcome = {
          pageId: page.id,
          persisted: false,
          viewId: view.id,
          workspaceRevision: result.workspace.revision
        }
        options.beforePersist?.(outcome)
        const persisted = await api.persist()
        if (options.requireDurablePersistence && !persisted) {
          throw new Error('workspace_projection_persistence_failed')
        }
        return { ...outcome, persisted }
      }
    )
    return { ...opened, historyEntryId }
  }

  async function openView(input: OpenWorkspaceViewInput): Promise<void> {
    const resolved = api.resolveWorkspace({
      basePageId: input.basePageId,
      basePageName: input.basePageName,
      route: input.route ?? null
    })
    const workspace = api.ensureViews(resolved)
    const view = workspaceView(workspace, input.kind)
    const page = projectionPage(state, workspace, view, input)
    syncSurfaceArtifactVisibility(state, workspace, page.id)
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

  return { activateExperienceProjection, activeViewForPage, openExperienceProjection, openView }
}
