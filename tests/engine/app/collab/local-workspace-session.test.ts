import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import { createCodeObject, createUserCodeObjectDocument } from '@/app/code-object/model'
import {
  connectCollabSession,
  createCollabRuntime,
  createInitialCollabState,
  disposeCollabSessionResources
} from '@/app/collab/session'
import { createYjsGraphSync } from '@/app/collab/yjs-sync'
import { createEditorStore } from '@/app/editor/session'
import { connectObjects, objectGraphReactFlowSnapshot } from '@/app/object-graph'

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
      roomId: `workspace-room-${crypto.randomUUID()}`,
      runtime,
      state,
      store,
      disconnect: () => undefined,
      updatePeersList: () => undefined,
      tickFollow: () => undefined,
      broadcastAwareness: () => undefined,
      applyYjsToGraph: sync.applyYjsToGraph,
      syncNodeToYjs: sync.syncNodeToYjs,
      syncAllNodesToYjs: sync.syncAllNodesToYjs,
      localOnly: true,
      onDurableReady: () => resolveReady?.()
    })
    await ready

    expect(runtime.persistence).toBeNull()
    expect(runtime.hydration.hydrated).toBe(true)
    expect(runtime.ynodes?.has('stale-earth-orbit')).toBe(false)
    expect(runtime.ynodes?.get(source.id)?.get('pluginData')).toEqual(source.pluginData)
    expect(runtime.ynodes?.get(target.id)?.get('pluginData')).toEqual(target.pluginData)
    expect(runtime.ynodes?.get(store.state.currentPageId)?.get('pluginData')).toEqual(
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

    disposeCollabSessionResources({
      store,
      room: runtime.room,
      awareness: runtime.awareness,
      persistence: runtime.persistence,
      durablePersistence: runtime.durablePersistence,
      durableConnectionAbort: runtime.durableConnectionAbort,
      localWorkspaceChannel: runtime.localWorkspaceChannel,
      ydoc: runtime.ydoc,
      unbindGraphEvents: runtime.unbindGraphEvents,
      stopZoomWatch: runtime.stopZoomWatch,
      resetFollow: () => undefined
    })
  })
})
