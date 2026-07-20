/**
 * Keep live frames deleted for real.
 *
 * Three resurrection paths this closes:
 * 1) ensureWorkspaceFrames() re-materializes frames from workspace items
 * 2) openSmylrProductionWorkspace() re-seeds every live iframe on boot
 * 3) selection.delete / layers / menus that bypass keyboard hooks
 */
import type { SceneGraph } from '@open-pencil/scene-graph'

import { removeLiveWorkspaceItem } from '@/app/smylr-live-inspector/workspace'

import {
  addLiveFrameTombstone,
  applyLiveFrameTombstones,
  isLiveAppFrameNode,
  loadLiveFrameTombstones,
  tombstoneForNode
} from './live-frame-tombstones'

export {
  applyLiveFrameTombstones,
  clearLiveFrameTombstones,
  isLiveFrameTombstoned,
  isWorkspaceItemTombstoned,
  loadLiveFrameTombstones,
  type LiveFrameTombstone
} from './live-frame-tombstones'

type LiveFrameHost = {
  deleteSelected?: () => void
  graph: SceneGraph
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEditorEvent: (event: any, handler: (...args: any[]) => void) => () => void
  requestRender?: () => void
  state: { selectedIds: Set<string> }
}

const frameToWorkspaceItemId = new Map<string, string>()
const boundStores = new WeakSet<object>()
const wrappedDeleteStores = new WeakSet<object>()

function reindexLiveFrameWorkspaceLinks(store: LiveFrameHost) {
  frameToWorkspaceItemId.clear()
  for (const node of store.graph.getAllNodes()) {
    const tombstone = tombstoneForNode(node)
    if (tombstone?.workspaceItemId) {
      frameToWorkspaceItemId.set(node.id, tombstone.workspaceItemId)
    }
  }
}

function rememberDeletedLiveFrame(node: Parameters<typeof tombstoneForNode>[0]) {
  const tombstone = tombstoneForNode(node)
  if (!tombstone) return
  addLiveFrameTombstone(tombstone)
  if (tombstone.workspaceItemId) {
    frameToWorkspaceItemId.delete(node.id)
    removeLiveWorkspaceItem(tombstone.workspaceItemId)
  }
}

/**
 * Call before selection.delete / cut so pluginData is still on the graph.
 * Also covers multi-select of parents that own live frames.
 */
export function removeWorkspaceItemsForSelectedLiveFrames(store: LiveFrameHost) {
  void loadLiveFrameTombstones()
  const seen = new Set<string>()
  const visit = (id: string) => {
    const node = store.graph.getNode(id)
    if (!node) return
    if (isLiveAppFrameNode(node)) {
      if (!seen.has(node.id)) {
        seen.add(node.id)
        rememberDeletedLiveFrame(node)
      }
    }
    for (const childId of node.childIds) visit(childId)
  }
  for (const id of store.state.selectedIds) visit(id)
}

function removeWorkspaceItemForDeletedFrame(frameId: string) {
  const itemId = frameToWorkspaceItemId.get(frameId)
  if (!itemId) return
  frameToWorkspaceItemId.delete(frameId)
  addLiveFrameTombstone({
    pageId: '',
    route: '',
    state: itemId,
    workspaceItemId: itemId
  })
  removeLiveWorkspaceItem(itemId)
}

function wrapDeleteSelected(store: LiveFrameHost) {
  if (!store.deleteSelected || wrappedDeleteStores.has(store as object)) return
  const original = store.deleteSelected.bind(store)
  store.deleteSelected = () => {
    removeWorkspaceItemsForSelectedLiveFrames(store)
    original()
    store.requestRender?.()
  }
  wrappedDeleteStores.add(store as object)
}

/** Bind once per editor store — wraps deleteSelected + tracks residual deletions. */
export function bindLiveFrameDeletionSync(store: LiveFrameHost): () => void {
  void loadLiveFrameTombstones()
  wrapDeleteSelected(store)

  if (boundStores.has(store as object)) {
    reindexLiveFrameWorkspaceLinks(store)
    return () => {}
  }
  boundStores.add(store as object)
  reindexLiveFrameWorkspaceLinks(store)

  const stops = [
    store.onEditorEvent('node:deleted', (id: string) => {
      removeWorkspaceItemForDeletedFrame(id)
    }),
    store.onEditorEvent('node:created', () => {
      reindexLiveFrameWorkspaceLinks(store)
    }),
    store.onEditorEvent('graph:replaced', () => {
      void loadLiveFrameTombstones().then(() => {
        const removed = applyLiveFrameTombstones(store.graph)
        reindexLiveFrameWorkspaceLinks(store)
        if (removed > 0) store.requestRender?.()
      })
    }),
    store.onEditorEvent('page:changed', () => {
      reindexLiveFrameWorkspaceLinks(store)
    })
  ]

  return () => {
    for (const stop of stops) stop()
    boundStores.delete(store as object)
  }
}

export function reindexLiveFrameWorkspaceItemLinks(store: LiveFrameHost) {
  reindexLiveFrameWorkspaceLinks(store)
}
