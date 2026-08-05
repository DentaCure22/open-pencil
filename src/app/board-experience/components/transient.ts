import type { SceneNode } from '@open-pencil/scene-graph'

import { boardNodeMatchesOwner, type BoardPermissionDescriptor } from '@/app/board-permissions'
import type { EditorStore } from '@/app/editor/active-store'

import type { BoardComponentSessionContext } from './contracts'
import { componentLifecycle, componentSessionMatches } from './lifecycle'

function nodeMatchesMarker(node: SceneNode, marker: BoardPermissionDescriptor['marker']): boolean {
  return node.pluginData.some(
    (entry) =>
      entry.pluginId === marker.pluginId && entry.key === marker.key && entry.value === marker.value
  )
}

function removeTransientBoardComponents(
  store: EditorStore,
  pageId: string,
  matchesOwner: (node: SceneNode) => boolean
): string[] {
  const removedIds = store.graph
    .getChildren(pageId)
    .filter((node) => matchesOwner(node) && componentLifecycle(node) === 'transient')
    .map((node) => node.id)
  if (removedIds.length === 0) return []
  const removed = new Set(removedIds)
  for (const componentId of removedIds) store.graph.deleteNode(componentId)
  store.select([...store.state.selectedIds].filter((selectedId) => !removed.has(selectedId)))
  store.requestOverlayRepaint()
  return removedIds
}

export function removeOwnedTransientBoardComponents(
  store: EditorStore,
  owner: BoardComponentSessionContext
): string[] {
  if (!owner.isActive()) return []
  return removeTransientBoardComponents(
    store,
    owner.pageId,
    (node) => boardNodeMatchesOwner(node, owner) && componentSessionMatches(node, owner)
  )
}

export function removeTransientBoardComponentsByMarker(
  store: EditorStore,
  owner: Pick<BoardPermissionDescriptor, 'marker' | 'pageId'>
): string[] {
  return removeTransientBoardComponents(store, owner.pageId, (node) =>
    nodeMatchesMarker(node, owner.marker)
  )
}
