import * as Y from 'yjs'

import { readContentSource } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

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
import {
  createGraphReplacementPublisher,
  syncGraphImagesToYjs
} from '@/app/collab/yjs/graph-replacement'
import {
  collabValuesEqual,
  hasStructuralNodeChange,
  syncNodeFieldsToYMap,
  syncNodePropsToYMap
} from '@/app/collab/yjs/node-record'
import type { EditorStore } from '@/app/editor/active-store'

type YImages = Y.Map<Uint8Array>

export type SyncNodeToYjs = (
  nodeId: string,
  changes?: Partial<SceneNode>,
  relatedParentIds?: ReadonlyArray<string | null>
) => void

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
  let indexedYnodes: YNodes | null = null
  let nodeIdsByMap = new WeakMap<Y.Map<unknown>, string>()

  function refreshYnodeIndex(ynodes: YNodes, events: Y.YEvent<Y.Map<unknown>>[] = []): void {
    if (indexedYnodes !== ynodes) {
      indexedYnodes = ynodes
      nodeIdsByMap = new WeakMap()
      for (const [nodeId, ynode] of ynodes) nodeIdsByMap.set(ynode, nodeId)
    }
    for (const event of events) {
      if (event.target !== ynodes) continue
      for (const nodeId of event.changes.keys.keys()) {
        const ynode = ynodes.get(nodeId)
        if (ynode) nodeIdsByMap.set(ynode, nodeId)
      }
    }
  }

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
        if (!ynode) {
          ynode = new Y.Map()
          ynodes.set(nodeId, ynode)
          if (indexedYnodes === ynodes) nodeIdsByMap.set(ynode, nodeId)
        }
        syncNodeFieldsToYMap(node, changes, ynode, materializingNode)

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

  function syncNodeBatchToYjs(nodes: SceneNode[], ynodes: YNodes): void {
    for (const node of nodes) {
      let ynode = ynodes.get(node.id)
      if (!ynode) {
        ynode = new Y.Map()
        ynodes.set(node.id, ynode)
        if (indexedYnodes === ynodes) nodeIdsByMap.set(ynode, node.id)
      }
      syncNodePropsToYMap(node, ynode)
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
      ydoc.transact(() => {
        syncNodeBatchToYjs(nodes, ynodes)
        syncGraphImagesToYjs(store, localYimages)
      })
    } catch (error) {
      logCollabSyncError('Failed to sync document', error)
    } finally {
      setSuppressYjsEvents(false)
    }
  }

  const publishGraphReplacementToYjs = createGraphReplacementPublisher({
    getStore,
    getYdoc,
    getYnodes,
    getYimages,
    setSuppressYjsEvents
  })

  function syncGraphReplacementToYjs() {
    publishGraphReplacementToYjs()
    indexedYnodes = null
    nodeIdsByMap = new WeakMap()
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
          const ynode = ynodes.get(nodeId)
          addStructuralChildIds(targets, ynode?.get('childIds'))
          const currentParentId = yParentId(ynode)
          if (currentParentId) targets.parentIds.add(currentParentId)
          if (change.oldValue instanceof Y.Map) {
            addStructuralChildIds(targets, change.oldValue.get('childIds'))
            const previousParentId = yParentId(change.oldValue)
            if (previousParentId) targets.parentIds.add(previousParentId)
          }
        }
        continue
      }
      if (event.target.parent !== ynodes) continue
      const nodeId = nodeIdsByMap.get(event.target)
      if (!nodeId) continue
      const parentChange = event.changes.keys.get('parentId')
      if (parentChange) {
        targets.childIds.add(nodeId)
        if (typeof parentChange.oldValue === 'string') targets.parentIds.add(parentChange.oldValue)
        const parentId = yParentId(event.target)
        if (parentId) targets.parentIds.add(parentId)
      }
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
    refreshYnodeIndex(ynodes, events)
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
        const nodeId = nodeIdsByMap.get(event.target)
        if (nodeId) {
          const ynode = ynodes.get(nodeId)
          if (ynode) applyYnodeChangesToGraph(nodeId, ynode, event)
        }
      }
    }
    if (structuralTargets.childIds.size > 0 || structuralTargets.parentIds.size > 0) {
      reconcileGraphStructure(store, ynodes, structuralTargets)
    }
    ensureCurrentPageExists(store)
  }

  function applyYnodeToGraph(nodeId: string, ynode: Y.Map<unknown>) {
    applyNodePropsToGraph(nodeId, yNodeToProps(ynode), ynode)
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
    applyNodePropsToGraph(nodeId, props, ynode)
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
      const nodeChanges = Object.fromEntries(
        Object.entries(props).filter(
          ([key, value]) =>
            key !== 'parentId' && !collabValuesEqual(existing[key as keyof SceneNode], value)
        )
      ) as Partial<SceneNode>
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
      if (Object.keys(nodeChanges).length > 0) store.graph.updateNode(nodeId, nodeChanges)
      if (hasParentChange && syncedParentId === null && store.graph.rootId !== nodeId) {
        store.graph.rootId = nodeId
        store.requestRender()
      }
      return
    }

    const fullProps = yNodeToProps(ynode)
    const type = fullProps.type as SceneNode['type'] | undefined
    if (!type) return
    const parentId = typeof fullProps.parentId === 'string' ? fullProps.parentId : null
    store.graph.createNodeWithId(nodeId, type, parentId, fullProps as Partial<SceneNode>)
    if (parentId === null) store.graph.rootId = nodeId
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
    applyYjsToGraph
  }
}
