import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import { deserializeSceneGraph, serializeSceneGraph } from '@open-pencil/core/kiwi'

import { createCodeObject, createUserCodeObjectDocument } from '@/app/code-object/model'
import {
  connectCollabSession,
  createCollabRuntime,
  createInitialCollabState,
  disposeCollabSessionResources
} from '@/app/collab/session'
import { createYjsGraphSync } from '@/app/collab/yjs'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'
import { connectObjects, objectGraphReactFlowSnapshot } from '@/app/object-graph'

function connectLocalTestSession(store: EditorStore, roomId: string, seedLocalWorkspace = true) {
  const runtime = createCollabRuntime()
  const state = ref(createInitialCollabState('Local persistence test'))
  const sync = createYjsGraphSync({
    getStore: () => store,
    getYdoc: () => runtime.ydoc,
    getYnodes: () => runtime.ynodes,
    getYimages: () => runtime.yimages,
    setSuppressYjsEvents: (value) => {
      runtime.suppressYjsEvents = value
    }
  })
  let resolveReady: (() => void) | null = null
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  connectCollabSession({
    roomId,
    runtime,
    state,
    store,
    disconnect: () => undefined,
    updatePeersList: () => undefined,
    tickFollow: () => undefined,
    broadcastAwareness: () => undefined,
    applyYjsToGraph: sync.applyYjsToGraph,
    applyYjsObjectGraphToGraph: sync.applyYjsObjectGraphToGraph,
    syncNodeToYjs: sync.syncNodeToYjs,
    syncAllNodesToYjs: sync.syncAllNodesToYjs,
    migrateObjectGraphRecordsToYjs: sync.migrateObjectGraphRecordsToYjs,
    localOnly: true,
    onDurableReady: () => resolveReady?.(),
    seedLocalWorkspace
  })

  return {
    ready,
    runtime,
    state,
    dispose() {
      disposeCollabSessionResources({
        store,
        room: runtime.room,
        awareness: runtime.awareness,
        persistence: runtime.persistence,
        durablePersistence: runtime.durablePersistence,
        durableConnectionAbort: runtime.durableConnectionAbort,
        localWorkspaceChannel: runtime.localWorkspaceChannel,
        dragPreviewSession: runtime.dragPreviewSession,
        ydoc: runtime.ydoc,
        unbindGraphEvents: runtime.unbindGraphEvents,
        stopZoomWatch: runtime.stopZoomWatch,
        resetFollow: () => undefined
      })
    }
  }
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error('Timed out waiting for local workspace convergence')
}

describe('local OpenPencil workspace session', () => {
  test('keeps the restored Code Object graph authoritative during local collaboration startup', async () => {
    const store = createEditorStore()
    const source = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Dental Chart / Current' }),
      height: 900,
      name: 'Dental Chart / Current',
      width: 1440,
      x: -7829,
      y: -4126
    })
    const target = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Dental Chart / Current copy' }),
      height: 900,
      name: 'Dental Chart / Current copy',
      width: 1440,
      x: -5724,
      y: -4409
    })
    const connection = connectObjects(store, {
      kind: 'action',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')

    const before = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    const session = connectLocalTestSession(store, `workspace-room-${crypto.randomUUID()}`)
    await session.ready

    expect(session.runtime.persistence).toBeNull()
    expect(session.runtime.hydration.hydrated).toBe(true)
    expect(session.runtime.ynodes?.has('stale-earth-orbit')).toBe(false)
    expect(session.runtime.ynodes?.get(source.id)?.get('pluginData')).toEqual(source.pluginData)
    expect(session.runtime.ynodes?.get(target.id)?.get('pluginData')).toEqual(target.pluginData)
    expect(session.runtime.ynodes?.get(store.state.currentPageId)?.get('pluginData')).toEqual(
      store.graph.getNode(store.state.currentPageId)?.pluginData
    )
    expect(store.graph.getNode(source.id)).toMatchObject({
      height: 900,
      width: 1440,
      x: -7829,
      y: -4126
    })
    expect(store.graph.getNode(target.id)).toMatchObject({
      height: 900,
      width: 1440,
      x: -5724,
      y: -4409
    })
    expect(objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)).toEqual(before)

    session.dispose()
  })

  test('hydrates a stale hot joiner from the active Board and syncs geometry both ways', async () => {
    const writerStore = createEditorStore()
    const source = createCodeObject(writerStore, {
      document: createUserCodeObjectDocument({ name: 'Dental Chart / Current' }),
      height: 900,
      name: 'Dental Chart / Current',
      width: 1440,
      x: -7829,
      y: -4126
    })
    const target = createCodeObject(writerStore, {
      document: createUserCodeObjectDocument({ name: 'Dental Chart / Current copy' }),
      height: 900,
      name: 'Dental Chart / Current copy',
      width: 1440,
      x: -5724,
      y: -4409
    })
    const connection = connectObjects(writerStore, {
      kind: 'action',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')

    const followerGraph = deserializeSceneGraph(
      structuredClone(serializeSceneGraph(writerStore.graph))
    )
    const followerStore = createEditorStore(followerGraph)
    followerStore.graph.updateNode(source.id, { x: -9999, y: -9999 })
    followerStore.graph.createNodeWithId(
      'stale-earth-orbit',
      'ELLIPSE',
      followerStore.state.currentPageId,
      { height: 240, name: 'Earth orbit', width: 240, x: 8000, y: 8000 }
    )

    const roomId = `workspace-room-${crypto.randomUUID()}`
    const writerSession = connectLocalTestSession(writerStore, roomId)
    await writerSession.ready
    const followerSession = connectLocalTestSession(followerStore, roomId, false)
    await followerSession.ready

    expect(followerStore.graph.getNode('stale-earth-orbit')).toBeUndefined()
    expect(followerStore.graph.getNode(source.id)).toMatchObject({ x: -7829, y: -4126 })
    expect(
      objectGraphReactFlowSnapshot(followerStore.graph, followerStore.state.currentPageId)
    ).toEqual(objectGraphReactFlowSnapshot(writerStore.graph, writerStore.state.currentPageId))

    writerStore.updateNodeWithUndo(source.id, { x: -7797 }, 'Move source Code Object')
    await waitFor(() => followerStore.graph.getNode(source.id)?.x === -7797)
    expect(writerStore.undo.undo()).toBe('Move source Code Object')
    await waitFor(() => followerStore.graph.getNode(source.id)?.x === -7829)
    expect(writerStore.undo.redo()).toBe('Move source Code Object')
    await waitFor(() => followerStore.graph.getNode(source.id)?.x === -7797)

    followerStore.updateNodeWithUndo(target.id, { y: -4369 }, 'Move target Code Object')
    await waitFor(() => writerStore.graph.getNode(target.id)?.y === -4369)
    expect(followerStore.undo.undo()).toBe('Move target Code Object')
    await waitFor(() => writerStore.graph.getNode(target.id)?.y === -4409)
    expect(followerStore.undo.redo()).toBe('Move target Code Object')
    await waitFor(() => writerStore.graph.getNode(target.id)?.y === -4369)

    expect(followerStore.graph.getNode(source.id)?.pluginData).toEqual(
      writerStore.graph.getNode(source.id)?.pluginData
    )
    expect(followerStore.graph.getNode(target.id)?.pluginData).toEqual(
      writerStore.graph.getNode(target.id)?.pluginData
    )
    expect(
      objectGraphReactFlowSnapshot(followerStore.graph, followerStore.state.currentPageId)
    ).toEqual(objectGraphReactFlowSnapshot(writerStore.graph, writerStore.state.currentPageId))

    followerSession.dispose()
    writerSession.dispose()
  })
})
