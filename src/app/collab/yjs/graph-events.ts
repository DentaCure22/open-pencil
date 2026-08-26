import type { Doc } from 'yjs'

import type { SceneNode } from '@open-pencil/scene-graph'

import {
  cancelPreHydrationDelete,
  type CollabHydrationState,
  queuePreHydrationDelete
} from '@/app/collab/hydration'
import {
  reconcileYjsParentChildIds,
  syncParentChildIdsFromGraph,
  type YNodes,
  yParentId
} from '@/app/collab/structure'
import type { SyncNodeToYjs } from '@/app/collab/yjs/graph-sync'
import { syncNodePropsToYMap } from '@/app/collab/yjs/node-record'
import type { EditorStore } from '@/app/editor/active-store'

type GraphBindingOptions = {
  store: EditorStore
  getYdoc: () => Doc | null
  getYnodes: () => YNodes | null
  getSuppressGraphSync: () => boolean
  hydration: CollabHydrationState
  setSuppressYjsEvents: (value: boolean) => void
  syncNodeToYjs: SyncNodeToYjs
}

function logCollabSyncError(context: string, error: unknown) {
  console.error(`[Collab] ${context}:`, error)
}

export function bindCollabGraphEvents({
  store,
  getYdoc,
  getYnodes,
  getSuppressGraphSync,
  hydration,
  setSuppressYjsEvents,
  syncNodeToYjs
}: GraphBindingOptions) {
  function onGraphMutation(
    nodeId: string,
    changes?: Partial<SceneNode>,
    relatedParentIds?: ReadonlyArray<string | null>
  ) {
    if (getSuppressGraphSync()) return
    if (getYdoc() && getYnodes()) {
      syncNodeToYjs(nodeId, changes, relatedParentIds)
    }
  }

  function onStructureMutation(nodeId: string, relatedParentIds: ReadonlyArray<string | null>) {
    const node = store.graph.getNode(nodeId)
    if (!node) return
    onGraphMutation(nodeId, { parentId: node.parentId, x: node.x, y: node.y }, relatedParentIds)
  }

  function syncedParentId(nodeId: string): string | null {
    const value = getYnodes()?.get(nodeId)?.get('parentId')
    return typeof value === 'string' ? value : null
  }

  const unbinds = [
    store.onEditorEvent('node:updated', (id, changes) => onGraphMutation(id, changes)),
    store.onEditorEvent('node:created', (node) => {
      if (!getSuppressGraphSync()) cancelPreHydrationDelete(hydration, node.id)
      onGraphMutation(node.id, undefined, [node.parentId])
    }),
    store.onEditorEvent('node:reparented', (nodeId, oldParentId, newParentId) =>
      onStructureMutation(nodeId, [oldParentId, newParentId])
    ),
    store.onEditorEvent('node:reordered', (nodeId, parentId) =>
      onStructureMutation(nodeId, [syncedParentId(nodeId), parentId])
    ),
    store.onEditorEvent('node:deleted', (id) => {
      if (getSuppressGraphSync()) return
      queuePreHydrationDelete(hydration, id)
      const ydoc = getYdoc()
      const ynodes = getYnodes()
      if (ydoc && ynodes) {
        const parentId = yParentId(ynodes.get(id))
        setSuppressYjsEvents(true)
        try {
          ydoc.transact(() => {
            ynodes.delete(id)
            syncParentChildIdsFromGraph(store, ynodes, [parentId], syncNodePropsToYMap)
            reconcileYjsParentChildIds(ynodes, {
              childIds: new Set([id]),
              parentIds: new Set(parentId ? [parentId] : [])
            })
          })
        } catch (error) {
          logCollabSyncError('Failed to delete synced node', error)
        } finally {
          setSuppressYjsEvents(false)
        }
      }
    })
  ]

  return () => {
    for (const unbind of unbinds) unbind()
  }
}
