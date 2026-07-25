import * as Y from 'yjs'

import { readContentSource } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import {
  cancelPreHydrationDelete,
  type CollabHydrationState,
  queuePreHydrationDelete
} from '@/app/collab/hydration'
import type { EditorStore } from '@/app/editor/active-store'

type YNodes = Y.Map<Y.Map<unknown>>
type YImages = Y.Map<Uint8Array>

const SYNC_ALL_NODE_BATCH_SIZE = 64

type GraphBindingOptions = {
  store: EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getSuppressGraphSync: () => boolean
  hydration: CollabHydrationState
  setSuppressYjsEvents: (value: boolean) => void
  syncNodeToYjs: (nodeId: string) => void
}

type YjsObserverOptions = {
  store: EditorStore
  ynodes: Y.Map<Y.Map<unknown>>
  yimages: Y.Map<Uint8Array>
  getSuppressYjsEvents: () => boolean
  setSuppressGraphSync: (value: boolean) => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
}

type YjsGraphSyncOptions = {
  getStore: () => EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getYimages: () => YImages | null
  setSuppressYjsEvents: (value: boolean) => void
}

function logCollabSyncError(context: string, error: unknown) {
  console.error(`[Collab] ${context}:`, error)
}

function referencedAssetHashes(node: SceneNode): Set<string> {
  const hashes = new Set(node.fills.flatMap((fill) => (fill.imageHash ? [fill.imageHash] : [])))
  const contentSource = readContentSource(node)
  const sourceHash = contentSource ? assetHashFromReference(contentSource.source) : null
  if (sourceHash) hashes.add(sourceHash)
  return hashes
}

// Clone across the graph/Yjs boundary to avoid shared mutable nested data.
export function syncNodePropsToYMap(node: SceneNode, ynode: Y.Map<unknown>) {
  for (const [key, value] of Object.entries(node)) {
    ynode.set(key, structuredClone(value))
  }
}

export function yNodeToProps(ynode: Y.Map<unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [key, value] of ynode.entries()) {
    props[key] = structuredClone(value)
  }
  return props
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
  function onGraphMutation(nodeId: string) {
    if (getSuppressGraphSync()) return
    if (getYdoc() && getYnodes()) {
      syncNodeToYjs(nodeId)
    }
  }

  const unbinds = [
    store.onEditorEvent('node:updated', (id) => onGraphMutation(id)),
    store.onEditorEvent('node:created', (node) => {
      if (!getSuppressGraphSync()) cancelPreHydrationDelete(hydration, node.id)
      onGraphMutation(node.id)
    }),
    store.onEditorEvent('node:reparented', (nodeId) => onGraphMutation(nodeId)),
    store.onEditorEvent('node:reordered', (nodeId) => onGraphMutation(nodeId)),
    store.onEditorEvent('node:deleted', (id) => {
      if (getSuppressGraphSync()) return
      queuePreHydrationDelete(hydration, id)
      const ydoc = getYdoc()
      const ynodes = getYnodes()
      if (ydoc && ynodes) {
        setSuppressYjsEvents(true)
        try {
          ydoc.transact(() => {
            ynodes.delete(id)
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

export function registerYjsObservers({
  store,
  ynodes,
  yimages,
  getSuppressYjsEvents,
  setSuppressGraphSync,
  applyYjsToGraph
}: YjsObserverOptions) {
  ynodes.observeDeep((events) => {
    if (getSuppressYjsEvents()) return
    setSuppressGraphSync(true)
    try {
      applyYjsToGraph(events)
      store.requestRender()
    } catch (error) {
      logCollabSyncError('Failed to apply remote graph changes', error)
    } finally {
      setSuppressGraphSync(false)
    }
  })

  yimages.observe((event) => {
    if (getSuppressYjsEvents()) return
    try {
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'add' || change.action === 'update') {
          const data = yimages.get(key)
          if (data) store.graph.images.set(key, new Uint8Array(data))
        } else {
          store.graph.images.delete(key)
        }
      }
      store.requestRender()
    } catch (error) {
      logCollabSyncError('Failed to apply remote image changes', error)
    }
  })
}

export function pruneGraphNodesMissingFromYjs(store: EditorStore, ynodes: YNodes): string[] {
  const depth = (node: SceneNode) => {
    let value = 0
    let parentId = node.parentId
    while (parentId) {
      value += 1
      parentId = store.graph.getNode(parentId)?.parentId ?? null
    }
    return value
  }
  const staleNodes = [...store.graph.getAllNodes()]
    .filter((node) => node.id !== store.graph.rootId && !ynodes.has(node.id))
    .sort((left, right) => depth(right) - depth(left))

  for (const node of staleNodes) {
    if (store.graph.getNode(node.id)) store.graph.deleteNode(node.id)
  }
  if (staleNodes.length > 0) store.requestRender()
  return staleNodes.map((node) => node.id)
}

export function createYjsGraphSync({
  getStore,
  getYdoc,
  getYnodes,
  getYimages,
  setSuppressYjsEvents
}: YjsGraphSyncOptions) {
  function syncNodeToYjs(nodeId: string) {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return
    const node = store.graph.getNode(nodeId)
    if (!node) return

    const localYimages = getYimages()
    setSuppressYjsEvents(true)
    try {
      ydoc.transact(() => {
        let ynode = ynodes.get(nodeId)
        if (!ynode) {
          ynode = new Y.Map()
          ynodes.set(nodeId, ynode)
        }
        syncNodePropsToYMap(node, ynode)

        if (localYimages) {
          for (const hash of referencedAssetHashes(node)) {
            if (localYimages.has(hash)) continue
            const data = store.graph.images.get(hash)
            if (data) localYimages.set(hash, data)
          }
        }
      })
    } catch (error) {
      logCollabSyncError(`Failed to sync node ${nodeId}`, error)
    } finally {
      setSuppressYjsEvents(false)
    }
  }

  function syncAllNodesToYjs() {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return
    const localYimages = getYimages()
    setSuppressYjsEvents(true)
    try {
      const nodes = [...store.graph.getAllNodes()]
      for (let index = 0; index < nodes.length; index += SYNC_ALL_NODE_BATCH_SIZE) {
        ydoc.transact(() => {
          for (const node of nodes.slice(index, index + SYNC_ALL_NODE_BATCH_SIZE)) {
            let ynode = ynodes.get(node.id)
            if (!ynode) {
              ynode = new Y.Map()
              ynodes.set(node.id, ynode)
            }
            syncNodePropsToYMap(node, ynode)
          }
        })
      }
      if (localYimages) {
        for (const [hash, data] of store.graph.images) {
          if (localYimages.has(hash)) continue
          ydoc.transact(() => {
            localYimages.set(hash, data)
          })
        }
      }
    } catch (error) {
      logCollabSyncError('Failed to sync document', error)
    } finally {
      setSuppressYjsEvents(false)
    }
  }

  function applyYjsToGraph(events: Y.YEvent<Y.Map<unknown>>[]) {
    const store = getStore()
    const ynodes = getYnodes()
    if (!ynodes) return
    for (const event of events) {
      if (event.target === ynodes) {
        for (const [key, change] of event.changes.keys) {
          if (change.action === 'add') {
            const ynode = ynodes.get(key)
            if (ynode) applyYnodeToGraph(key, ynode)
          } else if (change.action === 'delete') {
            store.graph.deleteNode(key)
          }
        }
      } else if (event.target.parent === ynodes) {
        const nodeId = findNodeIdForYMap(event.target)
        if (nodeId) {
          const ynode = ynodes.get(nodeId)
          if (ynode) applyYnodeToGraph(nodeId, ynode)
        }
      }
    }
  }

  function findNodeIdForYMap(ymap: Y.Map<unknown>): string | null {
    const ynodes = getYnodes()
    if (!ynodes) return null
    for (const [key, value] of ynodes.entries()) {
      if (value === ymap) return key
    }
    return null
  }

  function applyYnodeToGraph(nodeId: string, ynode: Y.Map<unknown>) {
    const store = getStore()
    const existing = store.graph.getNode(nodeId)
    const props = yNodeToProps(ynode)
    const parentId = typeof props.parentId === 'string' ? props.parentId : null

    if (existing) {
      store.graph.updateNode(nodeId, props as Partial<SceneNode>)
      if (parentId === null) store.graph.rootId = nodeId
      ensureCurrentPageExists(store)
      return
    }

    const type = props.type as SceneNode['type'] | undefined
    if (!type) return
    // Parent childIds may arrive before or after the child node.
    store.graph.createNodeWithId(nodeId, type, parentId, props as Partial<SceneNode>)
    if (parentId === null) store.graph.rootId = nodeId
    ensureCurrentPageExists(store)
  }

  function ensureCurrentPageExists(store: EditorStore) {
    const pages = store.graph.getPages()
    if (pages.some((page) => page.id === store.state.currentPageId)) return
    if (pages.length === 0) return
    void store.switchPage(pages[0].id)
  }

  return { syncNodeToYjs, syncAllNodesToYjs, applyYjsToGraph }
}
