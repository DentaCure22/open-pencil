import { describe, expect, test } from 'bun:test'

import { promiseTimeout } from '@vueuse/core'
import * as Y from 'yjs'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  cancelPreHydrationDelete,
  completeCollabHydration,
  createCollabHydrationState,
  queuePreHydrationDelete,
  resetCollabHydration
} from '@/app/collab/hydration'
import { connectDurableYjsProvider } from '@/app/collab/persistence/provider'
import type {
  DurableYjsDocumentState,
  DurableYjsStore,
  DurableYjsUpdate,
  DurableYjsUpdateListener
} from '@/app/collab/persistence/types'
import { createCollabRuntime } from '@/app/collab/session'
import {
  bindCollabGraphEvents,
  createYjsGraphSync,
  pruneGraphNodesMissingFromYjs,
  registerYjsObservers,
  syncNodePropsToYMap
} from '@/app/collab/yjs-sync'
import { createEditorStore } from '@/app/editor/session'

class DelayedDurableStore implements DurableYjsStore {
  readonly appended: DurableYjsUpdate[] = []
  private loadResolver: ((state: DurableYjsDocumentState) => void) | null = null
  private sequence: number

  constructor(private readonly state: DurableYjsDocumentState) {
    this.sequence = state.snapshotSequence
  }

  async append(clientUpdateId: string, data: Uint8Array) {
    const update = { clientUpdateId, data, sequence: (this.sequence += 1) }
    this.appended.push(update)
    return update
  }

  async checkpoint() {
    return true
  }

  load() {
    return new Promise<DurableYjsDocumentState>((resolve) => {
      this.loadResolver = resolve
    })
  }

  hasStartedLoad() {
    return this.loadResolver !== null
  }

  releaseLoad() {
    const resolve = this.loadResolver
    if (!resolve) throw new Error('Durable load has not started')
    this.loadResolver = null
    resolve(this.state)
  }

  async subscribe(_listener: DurableYjsUpdateListener) {
    return async () => undefined
  }

  snapshot() {
    return this.state.snapshot
  }
}

async function releaseLoadWhenStarted(store: DelayedDurableStore) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (store.hasStartedLoad()) {
      store.releaseLoad()
      return
    }
    await Promise.resolve()
  }
  throw new Error('Durable load did not start')
}

describe('collaboration hydration deletion', () => {
  test('cancels a queued delete when Undo restores the node before hydration', () => {
    const hydration = createCollabHydrationState()
    queuePreHydrationDelete(hydration, 'restored-node')
    cancelPreHydrationDelete(hydration, 'restored-node')

    expect(hydration.pendingDeletedNodeIds.size).toBe(0)
  })

  test('drops queued deletes when the collaboration session resets', () => {
    const hydration = createCollabHydrationState()
    queuePreHydrationDelete(hydration, 'old-room-node')
    resetCollabHydration(hydration)

    expect(hydration.pendingDeletedNodeIds.size).toBe(0)
    expect(hydration.hydrated).toBe(false)
  })

  test('removes stale preview nodes absent from a hydrated Yjs checkpoint', () => {
    const store = createEditorStore(new SceneGraph())
    const page = store.graph.getPages()[0]
    if (!page) throw new Error('Missing test page')
    const staleRectangle = store.graph.createNode('RECTANGLE', page.id, {
      name: 'Stale preview rectangle'
    })
    const ydoc = new Y.Doc()
    const ynodes = ydoc.getMap<Y.Map<unknown>>('nodes')

    for (const node of [store.graph.getNode(store.graph.rootId), page]) {
      if (!node) continue
      const ynode = new Y.Map<unknown>()
      ynodes.set(node.id, ynode)
      syncNodePropsToYMap(node, ynode)
    }

    expect(pruneGraphNodesMissingFromYjs(store, ynodes)).toEqual([staleRectangle.id])
    expect(store.graph.getNode(staleRectangle.id)).toBeUndefined()
    expect(store.graph.getNode(page.id)).toBeDefined()

    ydoc.destroy()
  })

  test('replays a local delete made before the durable snapshot loads', async () => {
    const store = createEditorStore(new SceneGraph())
    store.setViewportSize(1200, 800)
    const page = store.graph.getPages()[0]
    if (!page) throw new Error('Missing test page')
    const rectangle = store.graph.createNode('RECTANGLE', page.id, {
      name: 'Hydration delete probe',
      width: 80,
      height: 80
    })

    const remoteDocument = new Y.Doc()
    const remoteNodes = remoteDocument.getMap<Y.Map<unknown>>('nodes')
    remoteDocument.transact(() => {
      for (const node of store.graph.getAllNodes()) {
        const ynode = new Y.Map<unknown>()
        remoteNodes.set(node.id, ynode)
        syncNodePropsToYMap(node, ynode)
      }
    })

    const durableStore = new DelayedDurableStore({
      snapshot: Y.encodeStateAsUpdate(remoteDocument),
      snapshotSequence: 1,
      updates: []
    })
    const runtime = createCollabRuntime()
    const localDocument = new Y.Doc()
    const localNodes = localDocument.getMap<Y.Map<unknown>>('nodes')
    const localImages = localDocument.getMap<Uint8Array>('images')
    runtime.ydoc = localDocument
    runtime.ynodes = localNodes
    runtime.yimages = localImages
    runtime.connectedStore = store

    const sync = createYjsGraphSync({
      getStore: () => store,
      getYdoc: () => runtime.ydoc,
      getYnodes: () => runtime.ynodes,
      getYimages: () => runtime.yimages,
      setSuppressYjsEvents: (value) => {
        runtime.suppressYjsEvents = value
      }
    })
    registerYjsObservers({
      store,
      ynodes: localNodes,
      yimages: localImages,
      getSuppressYjsEvents: () => runtime.suppressYjsEvents,
      setSuppressGraphSync: (value) => {
        runtime.suppressGraphSync = value
      },
      applyYjsToGraph: sync.applyYjsToGraph
    })
    const unbind = bindCollabGraphEvents({
      store,
      getYdoc: () => runtime.ydoc,
      getYnodes: () => runtime.ynodes,
      getSuppressGraphSync: () => runtime.suppressGraphSync,
      hydration: runtime.hydration,
      setSuppressYjsEvents: (value) => {
        runtime.suppressYjsEvents = value
      },
      syncNodeToYjs: sync.syncNodeToYjs
    })

    const providerPromise = connectDurableYjsProvider({
      store: durableStore,
      ydoc: localDocument,
      onHydrated: () => {
        completeCollabHydration(runtime.hydration, runtime.ydoc, runtime.ynodes)
      }
    })
    await Promise.resolve()

    localDocument.getMap('probe').set('during-hydration', 'preserved')
    store.graph.deleteNode(rectangle.id)
    expect(store.graph.getNode(rectangle.id)).toBeUndefined()
    expect(runtime.hydration.pendingDeletedNodeIds).toContain(rectangle.id)
    expect(localNodes.has(rectangle.id)).toBe(false)
    await promiseTimeout(250)
    expect(durableStore.appended).toHaveLength(0)

    await releaseLoadWhenStarted(durableStore)
    const provider = await providerPromise

    expect(runtime.hydration.hydrated).toBe(true)
    expect(runtime.hydration.pendingDeletedNodeIds.size).toBe(0)
    expect(store.graph.getNode(rectangle.id)).toBeUndefined()
    expect(localNodes.has(rectangle.id)).toBe(false)

    await provider.destroy()
    const replay = new Y.Doc()
    const snapshot = durableStore.snapshot()
    if (snapshot) Y.applyUpdate(replay, snapshot)
    for (const update of durableStore.appended) Y.applyUpdate(replay, update.data)
    expect(replay.getMap('nodes').has(rectangle.id)).toBe(false)
    expect(replay.getMap('probe').get('during-hydration')).toBe('preserved')

    unbind()
    remoteDocument.destroy()
    localDocument.destroy()
    replay.destroy()
  })
})
