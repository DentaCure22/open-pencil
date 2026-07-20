import { persistOpenPencilDocument } from '@/app/document/persistence-target'
import {
  createWorkspaceId,
  createWorkspaceView,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type ExperienceProjectionPurpose,
  type KnowledgeWorkspace,
  type WorkspaceObjectRevisionRef,
  type WorkspaceOperation,
  type WorkspaceViewKind
} from '@/app/workspace'

import { VIEW_KINDS } from './helpers'
import { persistKnowledgeWorkspacesToScene, workspaceDocumentId } from './persistence'
import type { WorkspaceMutationApi, WorkspaceScope, WorkspaceUiState } from './types'

function experienceViewKind(purpose: ExperienceProjectionPurpose): WorkspaceViewKind {
  if (purpose === 'knowledge') return 'atlas'
  if (purpose === 'review') return 'review'
  return 'canvas'
}

function sameRoot(left: WorkspaceObjectRevisionRef, right: WorkspaceObjectRevisionRef): boolean {
  return left.objectId === right.objectId && left.revision === right.revision
}

function rendererViewId(
  workspace: KnowledgeWorkspace,
  rootSurface: WorkspaceObjectRevisionRef,
  purpose: ExperienceProjectionPurpose
): string | undefined {
  if (!Object.hasOwn(workspace.objects, rootSurface.objectId)) return undefined
  const root = workspace.objects[rootSurface.objectId]
  if (root.type !== 'surface-run' || root.revision !== rootSurface.revision) return undefined
  const modeKind = purpose === 'knowledge' ? 'overview' : purpose
  const mode = root.modes.find((candidate) => candidate.kind === modeKind)
  return mode?.rendererViewId
}

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

  async function persist(): Promise<boolean> {
    persistKnowledgeWorkspacesToScene(state.store.graph)
    state.store.requestRender()
    return persistOpenPencilDocument(state.store)
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

  function ensureExperienceView(
    source: KnowledgeWorkspace,
    input: Parameters<WorkspaceMutationApi['ensureExperienceView']>[1]
  ): ReturnType<WorkspaceMutationApi['ensureExperienceView']> {
    const requested = input.viewId ? source.views[input.viewId] : undefined
    if (input.viewId && !requested) {
      throw new Error(`workspace_experience_view_not_found: ${input.viewId}`)
    }
    if (
      requested &&
      (requested.lifecycle !== 'active' ||
        !requested.experienceProjection ||
        requested.experienceProjection.purpose !== input.purpose ||
        !sameRoot(requested.experienceProjection.rootSurface, input.rootSurface))
    ) {
      throw new Error(`workspace_experience_view_mismatch: ${input.viewId}`)
    }
    const existing =
      requested ??
      Object.values(source.views).find(
        (view) =>
          view.lifecycle === 'active' &&
          view.experienceProjection?.purpose === input.purpose &&
          sameRoot(view.experienceProjection.rootSurface, input.rootSurface)
      )
    if (existing) return { view: existing, workspace: source }

    const view = createWorkspaceView({
      experienceProjection: {
        purpose: input.purpose,
        rendererViewId: rendererViewId(source, input.rootSurface, input.purpose),
        rootSurface: input.rootSurface
      },
      kind: experienceViewKind(input.purpose),
      name: `${input.purpose.charAt(0).toLocaleUpperCase()} projection`,
      workspaceId: source.id
    })
    const workspace = mutate(source, [{ type: 'create-view', view }])
    const created = workspace.views[view.id]
    return { view: created, workspace }
  }

  return { ensureExperienceView, ensureViews, mutate, persist, resolveWorkspace }
}
