import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import {
  OBJECT_GRAPH_SCHEMA_VERSION,
  objectGraphConnectionsOnPage,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection
} from '@open-pencil/scene-graph'

import { getObjectGraphYRecords } from '@/app/collab/yjs/object-graph'
import { syncNodePropsToYMap } from '@/app/collab/yjs'
import { createEditorStore } from '@/app/editor/session'
import { disconnectObjects } from '@/app/object-graph'

import {
  applyMissingUpdate,
  cloneStore,
  createSyncHarness,
  exchangeMissingUpdates
} from '#tests/helpers/collab-yjs'

function connection(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  label = id
): ObjectGraphConnection {
  return {
    automatic: false,
    id,
    kind: 'visual',
    label,
    permissions: [],
    schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
    sourceNodeId,
    sourcePort: 'right',
    targetNodeId,
    targetPort: 'left'
  }
}

function connectedStores(initialConnections: ObjectGraphConnection[] = []) {
  const firstStore = createEditorStore()
  const pageId = firstStore.state.currentPageId
  const source = firstStore.graph.createNode('RECTANGLE', pageId, {
    height: 100,
    name: 'Source',
    width: 160,
    x: 100,
    y: 120
  })
  const target = firstStore.graph.createNode('RECTANGLE', pageId, {
    height: 100,
    name: 'Target',
    width: 160,
    x: 500,
    y: 120
  })
  setObjectGraphConnectionsOnPage(firstStore.graph, pageId, initialConnections)
  const secondStore = cloneStore(firstStore)
  const first = createSyncHarness(firstStore)
  first.sync.syncAllNodesToYjs()
  const second = createSyncHarness(secondStore)
  applyMissingUpdate(first, second)
  const unbindFirst = first.bindGraph()
  const unbindSecond = second.bindGraph()
  return {
    first,
    firstStore,
    pageId,
    second,
    secondStore,
    source,
    target,
    destroy() {
      unbindFirst()
      unbindSecond()
      first.destroy()
      second.destroy()
    }
  }
}

function ids(store: ReturnType<typeof createEditorStore>, pageId: string): string[] {
  return objectGraphConnectionsOnPage(store.graph, pageId).map(({ id }) => id)
}

describe('Object Graph Yjs records', () => {
  test('merges concurrent additions by stable connection ID', () => {
    const harness = connectedStores()
    const firstConnection = connection('connection:first', harness.source.id, harness.target.id)
    const secondConnection = connection('connection:second', harness.source.id, harness.target.id)

    setObjectGraphConnectionsOnPage(harness.firstStore.graph, harness.pageId, [firstConnection])
    setObjectGraphConnectionsOnPage(harness.secondStore.graph, harness.pageId, [secondConnection])
    exchangeMissingUpdates(harness.first, harness.second)

    expect(ids(harness.firstStore, harness.pageId)).toEqual([
      firstConnection.id,
      secondConnection.id
    ])
    expect(ids(harness.secondStore, harness.pageId)).toEqual([
      firstConnection.id,
      secondConnection.id
    ])
    harness.destroy()
  })

  test('makes a concurrent delete win over an update to the same connection', () => {
    const base = connection('connection:shared', 'pending-source', 'pending-target', 'Before')
    const harness = connectedStores()
    base.sourceNodeId = harness.source.id
    base.targetNodeId = harness.target.id
    setObjectGraphConnectionsOnPage(harness.firstStore.graph, harness.pageId, [base])
    applyMissingUpdate(harness.first, harness.second)

    setObjectGraphConnectionsOnPage(harness.firstStore.graph, harness.pageId, [
      { ...base, label: 'Updated offline' }
    ])
    setObjectGraphConnectionsOnPage(harness.secondStore.graph, harness.pageId, [])
    exchangeMissingUpdates(harness.first, harness.second)

    expect(ids(harness.firstStore, harness.pageId)).toEqual([])
    expect(ids(harness.secondStore, harness.pageId)).toEqual([])
    harness.destroy()
  })

  test('causally restores a deleted connection through normal Undo', () => {
    const harness = connectedStores()
    const base = connection('connection:undo', harness.source.id, harness.target.id)
    setObjectGraphConnectionsOnPage(harness.firstStore.graph, harness.pageId, [base])
    applyMissingUpdate(harness.first, harness.second)

    expect(disconnectObjects(harness.secondStore, base.id)).toBe(true)
    applyMissingUpdate(harness.second, harness.first)
    expect(ids(harness.firstStore, harness.pageId)).toEqual([])

    expect(harness.secondStore.undo.undo()).toBe('Disconnect visual objects')
    applyMissingUpdate(harness.second, harness.first)
    expect(ids(harness.firstStore, harness.pageId)).toEqual([base.id])
    expect(ids(harness.secondStore, harness.pageId)).toEqual([base.id])
    harness.destroy()
  })

  test('migrates legacy page JSON without losing unrelated plugin data', () => {
    const writerStore = createEditorStore()
    const pageId = writerStore.state.currentPageId
    const source = writerStore.graph.createNode('RECTANGLE', pageId, { height: 80, width: 120 })
    const target = writerStore.graph.createNode('RECTANGLE', pageId, { height: 80, width: 120 })
    const legacy = connection('connection:legacy', source.id, target.id)
    setObjectGraphConnectionsOnPage(writerStore.graph, pageId, [legacy])
    const page = writerStore.graph.getNode(pageId)
    if (!page) throw new Error('Expected page')
    writerStore.graph.updateNode(pageId, {
      pluginData: [...page.pluginData, { key: 'kept', pluginId: 'test-plugin', value: 'yes' }]
    })

    const legacyDocument = new Y.Doc()
    const legacyNodes = legacyDocument.getMap<Y.Map<unknown>>('nodes')
    legacyDocument.transact(() => {
      for (const node of writerStore.graph.getAllNodes()) {
        const ynode = new Y.Map<unknown>()
        legacyNodes.set(node.id, ynode)
        syncNodePropsToYMap(node, ynode)
      }
    })
    const reopenedStore = cloneStore(writerStore)
    const reopened = createSyncHarness(reopenedStore)
    Y.applyUpdate(reopened.ydoc, Y.encodeStateAsUpdate(legacyDocument))

    reopened.sync.migrateObjectGraphRecordsToYjs()

    expect(ids(reopenedStore, pageId)).toEqual([legacy.id])
    const records = getObjectGraphYRecords(reopened.ydoc)
    expect(records.size).toBeGreaterThan(1)

    const freshStore = createEditorStore()
    freshStore.setViewportSize(1200, 800)
    const fresh = createSyncHarness(freshStore)
    applyMissingUpdate(reopened, fresh)
    expect(ids(freshStore, pageId)).toEqual([legacy.id])
    expect(freshStore.graph.getNode(pageId)?.pluginData).toContainEqual({
      key: 'kept',
      pluginId: 'test-plugin',
      value: 'yes'
    })

    reopened.destroy()
    fresh.destroy()
  })

  test('seeds endpoint nodes before publishing their connection records', () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const source = store.graph.createNode('RECTANGLE', pageId, { height: 80, width: 120 })
    const target = store.graph.createNode('RECTANGLE', pageId, { height: 80, width: 120 })
    setObjectGraphConnectionsOnPage(store.graph, pageId, [
      connection('connection:ordered', source.id, target.id)
    ])
    const writer = createSyncHarness(store)
    const followerStore = createEditorStore()
    followerStore.setViewportSize(1200, 800)
    const follower = createSyncHarness(followerStore)
    let endpointsExistedWhenRecordArrived = false
    getObjectGraphYRecords(follower.ydoc).observeDeep(() => {
      endpointsExistedWhenRecordArrived = Boolean(
        followerStore.graph.getNode(source.id) && followerStore.graph.getNode(target.id)
      )
    })

    writer.sync.syncAllNodesToYjs()
    applyMissingUpdate(writer, follower)

    expect(endpointsExistedWhenRecordArrived).toBe(true)
    expect(ids(followerStore, pageId)).toEqual(['connection:ordered'])
    writer.destroy()
    follower.destroy()
  })
})
