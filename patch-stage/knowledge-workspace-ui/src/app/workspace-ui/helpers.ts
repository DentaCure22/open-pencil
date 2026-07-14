import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import {
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorStatus
} from '@/app/smylr-live-inspector/session'
import { isSmylrLiveAppFrameNode, smylrLiveAppFrameRoute } from '@/app/smylr-production/workspace'
import type {
  KnowledgeWorkspace,
  WorkspaceGeometry,
  WorkspaceObject,
  WorkspaceView,
  WorkspaceViewKind
} from '@/app/workspace'

import {
  defaultWorkspaceProjectionGeometry,
  sceneNodesForWorkspaceObject,
  workspaceBasePageIdForPage,
  workspaceViewKindForPage
} from './projection'
import type { WorkspaceScope } from './types'

export const VIEW_KINDS: WorkspaceViewKind[] = ['canvas', 'document', 'graph', 'atlas', 'review']

export function smylrPluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === 'smylr-production' && entry.key === key)
    ?.value
}

export function workspaceView(
  workspace: KnowledgeWorkspace,
  kind: WorkspaceViewKind
): WorkspaceView {
  const view = Object.values(workspace.views).find(
    (candidate) => candidate.lifecycle === 'active' && candidate.kind === kind
  )
  if (!view) throw new Error(`workspace_view_not_found: ${kind}`)
  return view
}

export function activeWorkspaceObjects(workspace: KnowledgeWorkspace): WorkspaceObject[] {
  return Object.values(workspace.objects).filter(
    (object) => object.lifecycle === 'active' && object.type !== 'saved-view'
  )
}

export function projectionGeometryForObject(
  object: WorkspaceObject,
  view: WorkspaceView,
  ordinal: number
): WorkspaceGeometry {
  return (
    object.projections[view.id]?.geometry ??
    defaultWorkspaceProjectionGeometry(object, view.kind, ordinal)
  )
}

function productionBaseForFlow(store: EditorStore, current: SceneNode): SceneNode | null {
  if (smylrPluginValue(current, 'kind') !== 'smylr-flow-page') return null
  const productionPageId = smylrPluginValue(current, 'pageId')
  if (!productionPageId) return null
  return (
    store.graph
      .getPages()
      .find(
        (page) =>
          smylrPluginValue(page, 'kind') === 'smylr-production-page' &&
          smylrPluginValue(page, 'pageId') === productionPageId
      ) ?? null
  )
}

function basePageId(store: EditorStore, current: SceneNode | null): string {
  if (!current) return store.state.currentPageId
  const workspaceBaseId = workspaceBasePageIdForPage(current)
  if (workspaceBaseId) return workspaceBaseId
  const productionBase = productionBaseForFlow(store, current)
  return productionBase?.id ?? current.id
}

export function baseScope(store: EditorStore): WorkspaceScope {
  const current = store.graph.getNode(store.state.currentPageId)
  const resolvedBasePageId = basePageId(store, current ?? null)
  const base = store.graph.getNode(resolvedBasePageId)
  const basePageName = base?.name ?? current?.name ?? 'Workspace'
  return {
    basePageId: resolvedBasePageId,
    basePageName,
    route: base ? (smylrPluginValue(base, 'route') ?? null) : null
  }
}

export function activeViewKindForStore(store: EditorStore): WorkspaceViewKind {
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page) return 'canvas'
  if (smylrPluginValue(page, 'kind') === 'smylr-flow-page') return 'graph'
  return workspaceViewKindForPage(page) ?? 'canvas'
}

export function selectedDesignNode(store: EditorStore): SceneNode | null {
  for (const id of store.state.selectedIds) {
    const node = store.graph.getNode(id)
    if (node && !isSmylrLiveAppFrameNode(node)) return node
  }
  return null
}

export function liveFrameForObject(store: EditorStore, object: WorkspaceObject): SceneNode | null {
  if (object.type !== 'live-app-block') return null
  const bound = sceneNodesForWorkspaceObject(store.graph, object.id).find(isSmylrLiveAppFrameNode)
  if (bound) return bound
  return (
    store.graph
      .getChildren(object.pageId)
      .find(
        (node) => isSmylrLiveAppFrameNode(node) && smylrLiveAppFrameRoute(node) === object.route
      ) ?? null
  )
}

export function runtimeStatusForFrame(
  frame: SceneNode
): Extract<WorkspaceObject, { type: 'live-app-block' }>['runtime'] {
  if (
    liveInspectorStatus.value === 'connected' &&
    liveInspectorActiveFrameId.value === frame.id &&
    liveInspectorDocument.value
  ) {
    return {
      lastHandshakeAt: liveInspectorDocument.value.capturedAt,
      status: 'live'
    }
  }
  if (liveInspectorStatus.value === 'loading' && liveInspectorActiveFrameId.value === frame.id) {
    return { status: 'loading' }
  }
  return { status: 'unavailable' }
}
