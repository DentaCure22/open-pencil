import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/session'
import { narratedTraceScopeForStore } from '@/app/narrated-trace'
import { narratedTraceTargetForLiveInspectorSelection } from '@/app/narrated-trace/live-inspector-target'
import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import {
  findLiveInspectorNode,
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorSelectedId,
  liveInspectorSelectedRect
} from '@/app/smylr-live-inspector/session'

import { liveSelectionFromNode } from './selection-brief'
import { openContextComment } from './state'
import type { ContextCommentTarget } from './types'

function findLiveInspectorParent(
  root: SmylrLiveContainerNode,
  selectedId: string
): SmylrLiveContainerNode | null {
  for (const child of root.children ?? []) {
    if (child.id === selectedId) return root
    const match = findLiveInspectorParent(child, selectedId)
    if (match) return match
  }
  return null
}

function nodePath(store: EditorStore, node: SceneNode) {
  const path: string[] = []
  let current: SceneNode | undefined = node
  const visited = new Set<string>()
  while (current && path.length < 32 && !visited.has(current.id)) {
    visited.add(current.id)
    path.unshift(current.name || current.type)
    current = current.parentId ? store.graph.getNode(current.parentId) : undefined
  }
  return path
}

function routeForNode(node: SceneNode) {
  return node.pluginData.find((entry) => entry.key === 'route')?.value
}

function unionBounds(bounds: Rect[]) {
  if (bounds.length === 0) return undefined
  const left = Math.min(...bounds.map((rect) => rect.x))
  const top = Math.min(...bounds.map((rect) => rect.y))
  const right = Math.max(...bounds.map((rect) => rect.x + rect.width))
  const bottom = Math.max(...bounds.map((rect) => rect.y + rect.height))
  return { height: bottom - top, width: right - left, x: left, y: top }
}

export function contextCommentTargetForSelection(store: EditorStore): ContextCommentTarget {
  const nodes = [...store.state.selectedIds].flatMap((id) => {
    const node = store.graph.getNode(id)
    return node ? [node] : []
  })
  const page = store.graph.getNode(store.state.currentPageId)
  if (nodes.length === 0) {
    return {
      kind: 'board',
      label: page?.name || 'Current Board',
      path: [page?.name || 'Board'],
      scope: narratedTraceScopeForStore(store),
      stableIds: [store.state.currentPageId]
    }
  }
  const first = nodes[0]
  return {
    bounds: unionBounds(nodes.map((node) => store.graph.getAbsoluteBounds(node.id))),
    kind: 'selection',
    label:
      nodes.length === 1 ? first?.name || first?.type || 'Selection' : `${nodes.length} selected`,
    path: first ? nodePath(store, first) : [page?.name || 'Board'],
    ...(first && routeForNode(first) ? { route: routeForNode(first) } : {}),
    scope: narratedTraceScopeForStore(store),
    stableIds: nodes.map((node) => node.id)
  }
}

export function contextCommentTargetForLiveInspector(
  store: EditorStore
): ContextCommentTarget | null {
  const frameId = liveInspectorActiveFrameId.value
  const document = liveInspectorDocument.value
  const selectedId = liveInspectorSelectedId.value
  const selectedRect = liveInspectorSelectedRect.value
  const frame = frameId ? store.graph.getNode(frameId) : undefined
  if (!frameId || !document || !selectedId || !selectedRect || !frame) return null
  const target = narratedTraceTargetForLiveInspectorSelection({
    document,
    frameBounds: store.graph.getAbsoluteBounds(frameId),
    frameId,
    framePath: nodePath(store, frame),
    selectedId,
    selectedRect
  })
  if (!target) return null
  const node = findLiveInspectorNode(document.tree, selectedId)
  const parent = findLiveInspectorParent(document.tree, selectedId)
  return {
    anchorBounds: store.graph.getAbsoluteBounds(frameId),
    bounds: target.bounds,
    ...(target.elementKind ? { elementKind: target.elementKind } : {}),
    frameId,
    ...(target.hierarchy ? { hierarchy: target.hierarchy } : {}),
    kind: 'live-container',
    label: target.name,
    ...(node ? { live: liveSelectionFromNode(node, parent) } : {}),
    path: target.path,
    ...(target.route ? { route: target.route } : {}),
    ...(target.source ? { source: target.source } : {}),
    scope: narratedTraceScopeForStore(store),
    stableIds: [target.stableId]
  }
}

export function openContextCommentForSelection(store: EditorStore) {
  openContextComment(contextCommentTargetForSelection(store))
}

export function openContextCommentForLiveInspector(store: EditorStore) {
  const target = contextCommentTargetForLiveInspector(store)
  if (!target) return false
  openContextComment(target)
  return true
}
