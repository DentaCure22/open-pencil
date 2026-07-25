import type { Room } from 'trystero'
import type { Ref } from 'vue'
import { IndexeddbPersistence } from 'y-indexeddb'
import * as awarenessProtocol from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { randomIndex } from '@open-pencil/core/random'

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
  registerYjsObservers
} from '@/app/collab/yjs-sync'
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
  connectedStore: EditorStore | null
  hydration: CollabHydrationState
  suppressGraphSync: boolean
  suppressYjsEvents: boolean
  unbindGraphEvents: (() => void) | null
  stopZoomWatch: (() => void) | null
}

type ConnectCollabSessionOptions = {
  roomId: string
  runtime: CollabRuntime
  state: Ref<CollabState>
  store: EditorStore
  disconnect: () => void
  updatePeersList: () => void
  tickFollow: () => void
  broadcastAwareness: () => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  syncNodeToYjs: (nodeId: string) => void
  syncAllNodesToYjs: () => void
  durableStore?: DurableYjsStore
  localOnly?: boolean
  onDurableReady?: DurableYjsHydratedHandler
}

type CollabConnectionActionsOptions = {
  runtime: CollabRuntime
  state: Ref<CollabState>
  getStore: () => EditorStore
  updatePeersList: () => void
  tickFollow: () => void
  broadcastAwareness: () => void
  applyYjsToGraph: (events: Y.YEvent<Y.Map<unknown>>[]) => void
  syncNodeToYjs: (nodeId: string) => void
  syncAllNodesToYjs: () => void
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
  syncNodeToYjs,
  syncAllNodesToYjs,
  resetFollow
}: CollabConnectionActionsOptions) {
  function connect(
    roomId: string,
    durableStore?: DurableYjsStore,
    onDurableReady?: DurableYjsHydratedHandler,
    localOnly = false
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
      syncNodeToYjs,
      syncAllNodesToYjs,
      durableStore,
      localOnly,
      onDurableReady
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
  syncNodeToYjs,
  syncAllNodesToYjs,
  durableStore,
  localOnly,
  onDurableReady
}: ConnectCollabSessionOptions) {
  if (runtime.ydoc) disconnect()

  runtime.connectedStore = store
  resetCollabHydration(runtime.hydration)
  state.value.roomId = roomId
  runtime.ydoc = new Y.Doc()
  runtime.awareness = new awarenessProtocol.Awareness(runtime.ydoc)
  runtime.ynodes = runtime.ydoc.getMap('nodes')
  runtime.yimages = runtime.ydoc.getMap('images')
  // Supabase is the offline-capable source of truth for cloud workspaces. Loading a
  // second, device-local Yjs history here can create a very large duplicate diff
  // that blocks newer edits behind a permanently retrying upload.
  runtime.persistence = durableStore
    ? null
    : new IndexeddbPersistence(`op-room-${roomId}`, runtime.ydoc)
  const sessionDocument = runtime.ydoc

  runtime.awareness.on('change', () => {
    updatePeersList()
    tickFollow()
  })

  registerYjsObservers({
    store,
    ynodes: runtime.ynodes,
    yimages: runtime.yimages,
    getSuppressYjsEvents: () => runtime.suppressYjsEvents,
    setSuppressGraphSync: (value) => {
      runtime.suppressGraphSync = value
    },
    applyYjsToGraph
  })

  if (localOnly) {
    runtime.localWorkspaceChannel = connectLocalWorkspaceChannel(roomId, runtime.ydoc)
    state.value.connected = true
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

  function acceptHydratedDocument() {
    completeCollabHydration(runtime.hydration, runtime.ydoc, runtime.ynodes)
    const ynodes = runtime.ynodes
    if (!ynodes) return
    if (ynodes.size === 0) {
      syncAllNodesToYjs()
      return
    }
    runtime.suppressGraphSync = true
    try {
      pruneGraphNodesMissingFromYjs(store, ynodes)
    } finally {
      runtime.suppressGraphSync = false
    }
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
  resources.store.requestRender()
}
