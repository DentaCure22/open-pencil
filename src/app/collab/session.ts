import type { Room } from 'trystero'
import type { Ref } from 'vue'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { randomIndex } from '@open-pencil/core/random'

import { createDragPreviewSession } from '@/app/collab/drag-preview'
import {
  completeCollabHydration,
  createCollabHydrationState,
  type CollabHydrationState,
  resetCollabHydration
} from '@/app/collab/hydration'
import {
  connectLocalWorkspaceChannel,
  type LocalWorkspaceChannel
} from '@/app/collab/local-workspace-channel'
import { createCacheDurableYjsOutbox } from '@/app/collab/persistence/outbox'
import {
  connectDurableYjsProvider,
  type DurableYjsProvider
} from '@/app/collab/persistence/provider'
import type { DurableYjsHydratedHandler, DurableYjsStore } from '@/app/collab/persistence/types'
import { connectCollabRoom } from '@/app/collab/room'
import type { CollabState } from '@/app/collab/types'
import {
  bindCollabGraphEvents,
  pruneGraphNodesMissingFromYjs,
  registerYjsObservers,
  type SyncNodeToYjs
} from '@/app/collab/yjs'
import { getObjectGraphYRecords } from '@/app/collab/yjs/object-graph'
import type { EditorStore } from '@/app/editor/active-store'
import { PEER_COLORS } from '@/constants'

export type CollabRuntime = {
  ydoc: Y.Doc | null
  awareness: awarenessProtocol.Awareness | null
  ynodes: Y.Map<Y.Map<unknown>> | null
  yimages: Y.Map<Uint8Array> | null
  room: Room | null
  persistence: IndexeddbPersistence | null
  durablePersistence: DurableYjsProvider | null
  durableConnectionAbort: AbortController | null
  localWorkspaceChannel: LocalWorkspaceChannel | null
  dragPreviewSession: { dispose: () => void } | null
  connectedStore: EditorStore | null
  hydration: CollabHydrationState
  suppressGraphSync: boolean
  suppressYjsEvents: boolean
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
}

type CollabSessionBindings = {
  updatePeersList: () => void
  tickFollow: () => void
  broadcastAwareness: () => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  applyYjsObjectGraphToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  syncNodeToYjs: SyncNodeToYjs
  syncAllNodesToYjs: () => void
  migrateObjectGraphRecordsToYjs: () => void
}

type AwarenessChange = {
  added: number[]
  updated: number[]
  removed: number[]
}

export function hasRemoteAwarenessChange(change: AwarenessChange, localClientId: number) {
  return [...change.added, ...change.updated, ...change.removed].some(
    (clientId) => clientId !== localClientId
  )
}

type ConnectCollabSessionOptions = CollabSessionBindings & {
  roomId: string
  runtime: CollabRuntime
  state: Ref<CollabState>
  store: EditorStore
  disconnect: () => void
  durableStore?: DurableYjsStore
  localOnly?: boolean
  onDurableReady?: DurableYjsHydratedHandler
  seedLocalWorkspace?: boolean
}

type CollabConnectionActionsOptions = CollabSessionBindings & {
  runtime: CollabRuntime
  state: Ref<CollabState>
  getStore: () => EditorStore
  resetFollow: () => void
}

type CollabSessionResources = {
  store: EditorStore
  room: Room | null
  awareness: awarenessProtocol.Awareness | null
  persistence: IndexeddbPersistence | null
  durablePersistence: DurableYjsProvider | null
  durableConnectionAbort: AbortController | null
  localWorkspaceChannel: LocalWorkspaceChannel | null
  dragPreviewSession: { dispose: () => void } | null
  ydoc: Y.Doc | null
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
  resetFollow: () => void
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function createCollabRuntime(): CollabRuntime {
  return {
    ydoc: null,
    awareness: null,
    ynodes: null,
    yimages: null,
    room: null,
    persistence: null,
    durablePersistence: null,
    durableConnectionAbort: null,
    localWorkspaceChannel: null,
    dragPreviewSession: null,
    connectedStore: null,
    hydration: createCollabHydrationState(),
    suppressGraphSync: false,
    suppressYjsEvents: false,
    unbindGraphEvents: null,
    stopZoomWatch: null
  }
}

export function createInitialCollabState(localName: string): CollabState {
  return {
    connected: false,
    roomId: null,
    peers: [],
    localName,
    localColor: PEER_COLORS[randomIndex(PEER_COLORS.length)]
  }
}

export function createCollabConnectionActions({
  runtime,
  state,
  getStore,
  updatePeersList,
  tickFollow,
  broadcastAwareness,
  applyYjsToGraph,
  applyYjsObjectGraphToGraph,
  syncNodeToYjs,
  syncAllNodesToYjs,
  migrateObjectGraphRecordsToYjs,
  resetFollow
}: CollabConnectionActionsOptions) {
  function connect(
    roomId: string,
    durableStore?: DurableYjsStore,
    onDurableReady?: DurableYjsHydratedHandler,
    localOnly = false,
    seedLocalWorkspace = true
  ) {
    connectCollabSession({
      roomId,
      runtime,
      state,
      store: getStore(),
      disconnect,
      updatePeersList,
      tickFollow,
      broadcastAwareness,
      applyYjsToGraph,
      applyYjsObjectGraphToGraph,
      syncNodeToYjs,
      syncAllNodesToYjs,
      migrateObjectGraphRecordsToYjs,
      durableStore,
      localOnly,
      onDurableReady,
      seedLocalWorkspace
    })
  }

  function disconnect() {
    const store = runtime.connectedStore ?? getStore()
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
      resetFollow
    })
    resetCollabRuntime(runtime)
    resetCollabConnectionState(state)
  }

  return { connect, disconnect }
}

export function watchAwarenessZoom(store: EditorStore, getAwareness: () => Awareness | null) {
  return store.onEditorEvent('viewport:changed', (viewport) => {
    const awareness = getAwareness()
    if (!awareness) return
    const prev = awareness.getLocalState()?.cursor as
      | { x: number; y: number; pageId: string; zoom: number }
      | undefined
    if (prev) {
      awareness.setLocalStateField('cursor', { ...prev, zoom: viewport.zoom })
    }
  })
}

export function connectCollabSession({
  roomId,
  runtime,
  state,
  store,
  disconnect,
  updatePeersList,
  tickFollow,
  broadcastAwareness,
  applyYjsToGraph,
  applyYjsObjectGraphToGraph,
  syncNodeToYjs,
  syncAllNodesToYjs,
  migrateObjectGraphRecordsToYjs,
  durableStore,
  localOnly,
  onDurableReady,
  seedLocalWorkspace = true
}: ConnectCollabSessionOptions) {
  if (runtime.ydoc) disconnect()

  runtime.connectedStore = store
  resetCollabHydration(runtime.hydration)
  state.value.roomId = roomId
  runtime.ydoc = new Y.Doc()
  runtime.awareness = new awarenessProtocol.Awareness(runtime.ydoc)
  runtime.ynodes = runtime.ydoc.getMap('nodes')
  runtime.yimages = runtime.ydoc.getMap('images')
  // The production workspace already restores its complete SceneGraph from the
  // document cache before opening the local BroadcastChannel. Replaying another
  // persisted Yjs history here can briefly resurrect deleted nodes, then replace
  // Code Object metadata and page-owned Object Graph records with stale values.
  // Keep IndexedDB room history only for explicit peer-collaboration rooms that
  // do not already have a document persistence owner.
  runtime.persistence =
    durableStore || localOnly ? null : new IndexeddbPersistence(`op-room-${roomId}`, runtime.ydoc)
  const sessionDocument = runtime.ydoc

  const awareness = runtime.awareness
  awareness.on('change', (change: AwarenessChange) => {
    if (!hasRemoteAwarenessChange(change, awareness.clientID)) return
    updatePeersList()
    tickFollow()
  })

  registerYjsObservers({
    store,
    ynodes: runtime.ynodes,
    yimages: runtime.yimages,
    yObjectGraphRecords: getObjectGraphYRecords(runtime.ydoc),
    getSuppressYjsEvents: () => runtime.suppressYjsEvents,
    setSuppressGraphSync: (value) => {
      runtime.suppressGraphSync = value
    },
    applyYjsToGraph,
    applyYjsObjectGraphToGraph
  })

  if (localOnly) {
    runtime.localWorkspaceChannel = connectLocalWorkspaceChannel(roomId, runtime.ydoc)
  } else {
    const roomConnection = connectCollabRoom({
      roomId,
      ydoc: runtime.ydoc,
      awareness: runtime.awareness,
      setConnected: () => {
        state.value.connected = true
      },
      syncDocument: !durableStore,
      updatePeersList
    })
    runtime.room = roomConnection.room
    state.value.connected = true
    broadcastAwareness()
    runtime.stopZoomWatch = watchAwarenessZoom(store, () => runtime.awareness)
  }

  function bindGraphEvents() {
    if (runtime.unbindGraphEvents) return
    runtime.unbindGraphEvents = bindCollabGraphEvents({
      store,
      getYdoc: () => runtime.ydoc,
      getYnodes: () => runtime.ynodes,
      getSuppressGraphSync: () => runtime.suppressGraphSync,
      hydration: runtime.hydration,
      setSuppressYjsEvents: (value) => {
        runtime.suppressYjsEvents = value
      },
      syncNodeToYjs
    })
  }
  if (!localOnly) bindGraphEvents()

  function acceptHydratedDocument(seedWhenEmpty = true) {
    completeCollabHydration(runtime.hydration, runtime.ydoc, runtime.ynodes)
    const ynodes = runtime.ynodes
    if (!ynodes) return
    if (ynodes.size === 0) {
      if (seedWhenEmpty) syncAllNodesToYjs()
      return
    }
    runtime.suppressGraphSync = true
    try {
      pruneGraphNodesMissingFromYjs(store, ynodes)
    } finally {
      runtime.suppressGraphSync = false
    }
    migrateObjectGraphRecordsToYjs()
  }

  const localPersistence = runtime.persistence
  if (localPersistence) {
    void localPersistence.whenSynced
      .then(async () => {
        if (runtime.ydoc !== sessionDocument || runtime.persistence !== localPersistence) {
          return undefined
        }
        acceptHydratedDocument()
        await onDurableReady?.()
        return undefined
      })
      .catch((error) => console.error('[OpenPencil Workspace] Local sync failed', error))
  } else if (durableStore) {
    const durableConnectionAbort = new AbortController()
    runtime.durableConnectionAbort = durableConnectionAbort
    void connectDurableYjsProvider({
      onHydrated: async () => {
        if (runtime.ydoc !== sessionDocument) return
        acceptHydratedDocument()
        await onDurableReady?.()
      },
      outbox: createCacheDurableYjsOutbox(roomId),
      signal: durableConnectionAbort.signal,
      store: durableStore,
      ydoc: sessionDocument
    })
      .then((provider) => {
        if (runtime.ydoc !== sessionDocument) {
          void provider.destroy()
          return undefined
        }
        runtime.durableConnectionAbort = null
        runtime.durablePersistence = provider
        return undefined
      })
      .catch((error) => {
        if (isAbortError(error)) return
        console.error('[OpenPencil Cloud] Durable sync failed', error)
      })
  } else if (localOnly) {
    const localChannel = runtime.localWorkspaceChannel
    if (!localChannel) {
      if (!seedLocalWorkspace) {
        console.error('[OpenPencil Workspace] Local live sync is unavailable for this follower')
        return
      }
      acceptHydratedDocument()
      bindGraphEvents()
      state.value.connected = true
      void Promise.resolve(onDurableReady?.()).catch((error) =>
        console.error('[OpenPencil Workspace] Local sync repair failed', error)
      )
      return
    }
    void localChannel
      .bootstrap(seedLocalWorkspace ? syncAllNodesToYjs : undefined)
      .then(async (result) => {
        if (
          result === 'closed' ||
          runtime.ydoc !== sessionDocument ||
          runtime.localWorkspaceChannel !== localChannel
        ) {
          return undefined
        }
        acceptHydratedDocument(false)
        // Publish the terminal preview before the final Yjs transform so peers
        // can interpolate into the durable pose instead of snapping to it.
        runtime.dragPreviewSession = createDragPreviewSession({
          store,
          transport: localChannel
        })
        bindGraphEvents()
        state.value.connected = true
        await onDurableReady?.()
        return undefined
      })
      .catch((error) => console.error('[OpenPencil Workspace] Local live sync failed', error))
  } else {
    acceptHydratedDocument()
    void Promise.resolve(onDurableReady?.()).catch((error) =>
      console.error('[OpenPencil Workspace] Collaboration sync repair failed', error)
    )
  }
}

export function resetCollabRuntime(runtime: CollabRuntime) {
  runtime.unbindGraphEvents = null
  runtime.stopZoomWatch = null
  runtime.room = null
  runtime.awareness = null
  runtime.persistence = null
  runtime.durablePersistence = null
  runtime.durableConnectionAbort = null
  runtime.localWorkspaceChannel = null
  runtime.dragPreviewSession = null
  runtime.ydoc = null
  runtime.ynodes = null
  runtime.yimages = null
  runtime.connectedStore = null
  resetCollabHydration(runtime.hydration)
}

export function resetCollabConnectionState(state: Ref<CollabState>) {
  state.value.connected = false
  state.value.roomId = null
  state.value.peers = []
}

export function disposeCollabSessionResources(resources: CollabSessionResources) {
  resources.unbindGraphEvents?.()
  resources.stopZoomWatch?.()
  void resources.room?.leave()
  resources.dragPreviewSession?.dispose()
  resources.localWorkspaceChannel?.close()
  resources.durableConnectionAbort?.abort()
  if (resources.durablePersistence) {
    void resources.durablePersistence.destroy()
  }
  resources.awareness?.destroy()
  if (resources.persistence) {
    void resources.persistence.destroy()
  }
  resources.ydoc?.destroy()
  resources.resetFollow()
  resources.store.state.remoteCursors = []
  resources.store.requestOverlayRepaint()
}
