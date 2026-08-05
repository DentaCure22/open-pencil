import * as Y from 'yjs'

import { readContentSource } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import {
  cancelPreHydrationDelete,
  type CollabHydrationState,
  queuePreHydrationDelete
} from '@/app/collab/hydration'
import { YJS_STRUCTURE_REPAIR_ORIGIN } from '@/app/collab/origins'
import { isSourceInvalidationYKey, resolveYjsSourceMetadata } from '@/app/collab/source-metadata'
import {
  isStructureYKey,
  reconcileGraphStructure,
  reconcileYjsParentChildIds,
  syncParentChildIdsFromGraph,
  syncPreviousPlacement,
  type StructuralSyncTargets,
  type YNodes,
  yParentId
} from '@/app/collab/structure'
import { createGraphReplacementPublisher } from '@/app/collab/yjs/graph-replacement'
import {
  collabValuesEqual,
  hasStructuralNodeChange,
  shouldSyncObjectGraphPage,
  syncNodeFieldsToYMap,
  syncNodePropsToYMap
} from '@/app/collab/yjs/node-record'
import {
  getObjectGraphYRecords,
  objectGraphPageIdsFromYjsEvents,
  objectGraphPluginDataFromYjs,
  readObjectGraphYConnections,
  readYNodePluginData,
  syncObjectGraphPageToYjs,
  tombstoneObjectGraphPageInYjs
} from '@/app/collab/yjs/object-graph'
import type { EditorStore } from '@/app/editor/active-store'

export { registerYjsObservers } from '@/app/collab/yjs/observers'
export { syncNodePropsToYMap } from '@/app/collab/yjs/node-record'

type YImages = Y.Map<Uint8Array>

const SYNC_ALL_NODE_BATCH_SIZE = 64

export type SyncNodeToYjs = (
  nodeId: string,
  changes?: Partial<SceneNode>,
  relatedParentIds?: ReadonlyArray<string | null>
) => void

type GraphBindingOptions = {
  store: EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getSuppressGraphSync: () => boolean
  hydration: CollabHydrationState
  setSuppressYjsEvents: (value: boolean) => void
  syncNodeToYjs: SyncNodeToYjs
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

export function yNodeToProps(ynode: Y.Map<unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [key, value] of ynode.entries()) {
    if (isSourceInvalidationYKey(key) || isStructureYKey(key)) continue
    props[key] = structuredClone(value)
  }
  const source = resolveYjsSourceMetadata(ynode)
  if (source) props.source = source
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
        const deletedYnode = ynodes.get(id)
        const parentId = yParentId(ynodes.get(id))
        setSuppressYjsEvents(true)
        try {
          ydoc.transact(() => {
            if (deletedYnode?.get('type') === 'CANVAS') {
              tombstoneObjectGraphPageInYjs(
                getObjectGraphYRecords(ydoc),
                id,
                readYNodePluginData(deletedYnode)
              )
            }
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
  const syncNodeToYjs: SyncNodeToYjs = (nodeId, changes, relatedParentIds = []) => {
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
        const materializingNode = !ynode
        const previousPluginData = readYNodePluginData(ynode)
        if (!ynode) {
          ynode = new Y.Map()
          ynodes.set(nodeId, ynode)
        }
        syncNodeFieldsToYMap(node, changes, ynode, materializingNode)

        if (shouldSyncObjectGraphPage(node, changes, materializingNode)) {
          syncObjectGraphPageToYjs(getObjectGraphYRecords(ydoc), node, previousPluginData)
        }

        syncParentChildIdsFromGraph(
          store,
          ynodes,
          relatedParentIds.filter((parentId) => parentId !== nodeId),
          syncNodePropsToYMap
        )
        syncPreviousPlacement(store, node, changes, relatedParentIds, ynode)

        if (hasStructuralNodeChange(changes, relatedParentIds, materializingNode)) {
          const childIds = new Set<string>([nodeId])
          if (materializingNode || !changes || Object.hasOwn(changes, 'childIds')) {
            for (const childId of node.childIds) childIds.add(childId)
          }
          reconcileYjsParentChildIds(ynodes, {
            childIds,
            parentIds: new Set(relatedParentIds.flatMap((parentId) => (parentId ? [parentId] : [])))
          })
        }

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
      const previousPagePluginData = new Map(
        nodes.flatMap((node) =>
          node.type === 'CANVAS'
            ? [[node.id, readYNodePluginData(ynodes.get(node.id))] as const]
            : []
        )
      )
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
      ydoc.transact(() => {
        const records = getObjectGraphYRecords(ydoc)
        for (const page of nodes.filter((node) => node.type === 'CANVAS')) {
          syncObjectGraphPageToYjs(records, page, previousPagePluginData.get(page.id))
        }
      })
      if (localYimages) {
        for (const hash of localYimages.keys()) {
          if (!store.graph.images.has(hash)) localYimages.delete(hash)
        }
        for (const [hash, data] of store.graph.images) {
          if (collabValuesEqual(localYimages.get(hash), data)) continue
          ydoc.transact(() => localYimages.set(hash, data))
        }
      }
    } catch (error) {
      logCollabSyncError('Failed to sync document', error)
    } finally {
      setSuppressYjsEvents(false)
    }
  }

  const syncGraphReplacementToYjs = createGraphReplacementPublisher({
    getStore,
    getYdoc,
    getYnodes,
    getYimages,
    setSuppressYjsEvents
  })

  function migrateObjectGraphRecordsToYjs() {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return
    setSuppressYjsEvents(true)
    try {
      ydoc.transact(() => {
        const records = getObjectGraphYRecords(ydoc)
        for (const page of store.graph.getPages()) {
          if (readObjectGraphYConnections(records, page.id) !== null) continue
          syncObjectGraphPageToYjs(records, page, readYNodePluginData(ynodes.get(page.id)))
        }
      })
    } catch (error) {
      logCollabSyncError('Failed to migrate Object Graph records', error)
    } finally {
      setSuppressYjsEvents(false)
    }
  }

  function addStructuralChildIds(targets: StructuralSyncTargets, value: unknown) {
    if (!Array.isArray(value)) return
    for (const childId of value) {
      if (typeof childId === 'string') targets.childIds.add(childId)
    }
  }

  function collectStructuralSyncTargets(
    events: Y.YEvent<Y.Map<unknown>>[],
    ynodes: YNodes
  ): StructuralSyncTargets {
    const targets: StructuralSyncTargets = {
      childIds: new Set(),
      parentIds: new Set()
    }
    for (const event of events) {
      if (event.target === ynodes) {
        for (const [nodeId, change] of event.changes.keys) {
          targets.childIds.add(nodeId)
          targets.parentIds.add(nodeId)
          addStructuralChildIds(targets, ynodes.get(nodeId)?.get('childIds'))
          if (change.oldValue instanceof Y.Map) {
            addStructuralChildIds(targets, change.oldValue.get('childIds'))
          }
        }
        continue
      }
      if (event.target.parent !== ynodes) continue
      const nodeId = findNodeIdForYMap(event.target)
      if (!nodeId) continue
      const parentChange = event.changes.keys.get('parentId')
      if (parentChange) targets.childIds.add(nodeId)
      const childIdsChange = event.changes.keys.get('childIds')
      if (!childIdsChange) continue
      targets.parentIds.add(nodeId)
      addStructuralChildIds(targets, childIdsChange.oldValue)
      addStructuralChildIds(targets, event.target.get('childIds'))
    }
    return targets
  }

  function applyYjsToGraph(events: Y.YEvent<Y.Map<unknown>>[]) {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ynodes) return
    const structuralTargets = collectStructuralSyncTargets(events, ynodes)
    if (ydoc && structuralTargets.childIds.size > 0) {
      ydoc.transact(
        () => reconcileYjsParentChildIds(ynodes, structuralTargets),
        YJS_STRUCTURE_REPAIR_ORIGIN
      )
    }
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
          if (ynode) applyYnodeChangesToGraph(nodeId, ynode, event)
        }
      }
    }
    if (structuralTargets.childIds.size > 0 || structuralTargets.parentIds.size > 0) {
      reconcileGraphStructure(store, ynodes, structuralTargets)
    }
    // Page records can be observed before endpoint nodes when a complete Yjs
    // document is applied in one update. Reapply the normalized projection
    // after the node batch so runtime reconciliation never prunes a valid edge
    // merely because its endpoints were still being materialized.
    applyObjectGraphProjection(store.graph.getPages().map((page) => page.id))
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
    applyNodePropsToGraph(nodeId, yNodeToPropsWithObjectGraph(nodeId, ynode), ynode)
  }

  function applyYnodeChangesToGraph(
    nodeId: string,
    ynode: Y.Map<unknown>,
    event: Y.YEvent<Y.Map<unknown>>
  ) {
    if (!getStore().graph.getNode(nodeId)) {
      applyYnodeToGraph(nodeId, ynode)
      return
    }
    const props: Record<string, unknown> = {}
    let sourceStateChanged = false
    for (const [key, change] of event.changes.keys) {
      if (key === 'source' || isSourceInvalidationYKey(key)) sourceStateChanged = true
      if (change.action === 'delete') continue
      if (isSourceInvalidationYKey(key) || isStructureYKey(key)) continue
      const value = ynode.get(key)
      if (value !== undefined) props[key] = structuredClone(value)
    }
    if (sourceStateChanged) {
      const source = resolveYjsSourceMetadata(ynode)
      if (source) props.source = source
    }
    if (ynode.get('type') === 'CANVAS') {
      const ydoc = getYdoc()
      if (ydoc) {
        props.pluginData = objectGraphPluginDataFromYjs(
          getObjectGraphYRecords(ydoc),
          nodeId,
          readYNodePluginData(ynode)
        )
      }
    }
    applyNodePropsToGraph(nodeId, props, ynode)
  }

  function yNodeToPropsWithObjectGraph(
    nodeId: string,
    ynode: Y.Map<unknown>
  ): Record<string, unknown> {
    const props = yNodeToProps(ynode)
    const ydoc = getYdoc()
    if (ydoc && props.type === 'CANVAS') {
      props.pluginData = objectGraphPluginDataFromYjs(
        getObjectGraphYRecords(ydoc),
        nodeId,
        readYNodePluginData(ynode)
      )
    }
    return props
  }

  function applyYjsObjectGraphToGraph(events: Y.YEvent<Y.Map<unknown>>[]) {
    const ydoc = getYdoc()
    if (!ydoc) return
    const records = getObjectGraphYRecords(ydoc)
    applyObjectGraphProjection(objectGraphPageIdsFromYjsEvents(records, events))
  }

  function applyObjectGraphProjection(pageIds: Iterable<string>) {
    const store = getStore()
    const ydoc = getYdoc()
    if (!ydoc) return
    const records = getObjectGraphYRecords(ydoc)
    for (const pageId of pageIds) {
      const page = store.graph.getNode(pageId)
      if (page?.type !== 'CANVAS') continue
      const nextPluginData = objectGraphPluginDataFromYjs(records, pageId, page.pluginData)
      if (JSON.stringify(nextPluginData) === JSON.stringify(page.pluginData)) continue
      store.graph.updateNode(pageId, { pluginData: nextPluginData })
    }
  }

  function applyNodePropsToGraph(
    nodeId: string,
    props: Record<string, unknown>,
    ynode: Y.Map<unknown>
  ) {
    const store = getStore()
    const existing = store.graph.getNode(nodeId)
    const syncedParentId = typeof props.parentId === 'string' ? props.parentId : null

    if (existing) {
      const hasParentChange = Object.hasOwn(props, 'parentId')
      const nodeChanges = { ...props } as Partial<SceneNode>
      delete nodeChanges.parentId
      if (hasParentChange && syncedParentId && existing.parentId !== syncedParentId) {
        store.graph.reparentNode(nodeId, syncedParentId)
      }
      if (
        hasParentChange &&
        syncedParentId &&
        store.graph.getNode(nodeId)?.parentId !== syncedParentId
      ) {
        delete nodeChanges.x
        delete nodeChanges.y
      }
      store.graph.updateNode(nodeId, nodeChanges)
      if (hasParentChange && syncedParentId === null) {
        store.graph.rootId = nodeId
      }
      ensureCurrentPageExists(store)
      return
    }

    const fullProps = yNodeToPropsWithObjectGraph(nodeId, ynode)
    const type = fullProps.type as SceneNode['type'] | undefined
    if (!type) return
    const parentId = typeof fullProps.parentId === 'string' ? fullProps.parentId : null
    // Parent childIds may arrive before or after the child node.
    store.graph.createNodeWithId(nodeId, type, parentId, fullProps as Partial<SceneNode>)
    if (parentId === null) store.graph.rootId = nodeId
    ensureCurrentPageExists(store)
  }

  function ensureCurrentPageExists(store: EditorStore) {
    const pages = store.graph.getPages()
    if (pages.some((page) => page.id === store.state.currentPageId)) return
    if (pages.length === 0) return
    void store.switchPage(pages[0].id)
  }

  return {
    syncNodeToYjs,
    syncAllNodesToYjs,
    syncGraphReplacementToYjs,
    migrateObjectGraphRecordsToYjs,
    applyYjsToGraph,
    applyYjsObjectGraphToGraph
  }
}
