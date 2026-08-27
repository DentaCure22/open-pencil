import { tryOnScopeDispose, useLocalStorage } from '@vueuse/core'
import { computed, ref } from 'vue'

import { randomIndex } from '@open-pencil/core/random'

import { createFollowActions, generateRoomId } from '@/app/collab/awareness'
import { createLocalAwarenessActions } from '@/app/collab/local-awareness'
import type { DurableYjsHydratedHandler, DurableYjsStore } from '@/app/collab/persistence/types'
import type { CollabRuntime } from '@/app/collab/session'
import { DEFAULT_COLLAB_STATE, type CollabState, type RemotePeer } from '@/app/collab/types'
import type { EditorStore } from '@/app/editor/active-store'
import { PEER_COLORS } from '@/constants'

export { COLLAB_KEY, useCollabInjected } from '@/app/collab/context'
export { DEFAULT_COLLAB_STATE }
export type { CollabState, RemotePeer }

type CollabActions = {
  connect: (
    roomId: string,
    durableStore?: DurableYjsStore,
    onDurableReady?: DurableYjsHydratedHandler
  ) => void
  disconnect: () => void
  syncGraphReplacementToYjs: () => void
  syncAllNodesToYjs: () => void
}

function createInitialCollabState(localName: string): CollabState {
  return {
    connected: false,
    roomId: null,
    peers: [],
    localName,
    localColor: PEER_COLORS[randomIndex(PEER_COLORS.length)]
  }
}

export function useCollab(storeOrGetter: EditorStore | (() => EditorStore)) {
  const getStore = () =>
    typeof storeOrGetter === 'function' ? (storeOrGetter)() : storeOrGetter
  const storedName = useLocalStorage('op-collab-name', '')
  const state = ref<CollabState>(createInitialCollabState(storedName.value))
  let runtime: CollabRuntime | null = null
  let collabActionsPromise: Promise<CollabActions> | null = null
  const remotePeers = computed(() => state.value.peers)
  const getActiveStore = () => runtime?.connectedStore ?? getStore()

  const { followingPeer, followPeer, resetFollow, tickFollow } = createFollowActions(
    getActiveStore,
    () => runtime?.awareness ?? null
  )
  const { broadcastAwareness, updateCursor, updateSelection, updatePeersList, setLocalName } =
    createLocalAwarenessActions({
      state,
      storedName,
      getStore: getActiveStore,
      getAwareness: () => runtime?.awareness ?? null
    })

  function loadCollabActions() {
    collabActionsPromise ??= Promise.all([
      import('@/app/collab/session'),
      import('@/app/collab/yjs')
    ]).then(([session, yjsSync]) => {
      runtime = session.createCollabRuntime()
      const activeRuntime = runtime
      const { syncNodeToYjs, syncAllNodesToYjs, syncGraphReplacementToYjs, applyYjsToGraph } =
        yjsSync.createYjsGraphSync({
          getStore: getActiveStore,
          getYdoc: () => activeRuntime.ydoc,
          getYnodes: () => activeRuntime.ynodes,
          getYimages: () => activeRuntime.yimages,
          setSuppressYjsEvents: (value) => {
            activeRuntime.suppressYjsEvents = value
          }
        })
      const { connect, disconnect } = session.createCollabConnectionActions({
        runtime: activeRuntime,
        state,
        getStore,
        updatePeersList,
        tickFollow,
        broadcastAwareness,
        applyYjsToGraph,
        syncNodeToYjs,
        syncAllNodesToYjs,
        resetFollow
      })
      return { connect, disconnect, syncAllNodesToYjs, syncGraphReplacementToYjs }
    })
    return collabActionsPromise
  }

  function connect(roomId: string) {
    void loadCollabActions().then((actions) => actions.connect(roomId))
  }

  function connectSharedWorkspace(
    roomId: string,
    durableStore: DurableYjsStore,
    onDurableReady?: DurableYjsHydratedHandler
  ) {
    void loadCollabActions().then((actions) =>
      actions.connect(roomId, durableStore, onDurableReady)
    )
  }

  function disconnect() {
    if (collabActionsPromise) {
      void collabActionsPromise.then((actions) => actions.disconnect())
    }
  }

  function publishGraphReplacement() {
    if (!collabActionsPromise) return
    void collabActionsPromise.then((actions) => actions.syncGraphReplacementToYjs())
  }

  function shareCurrentDoc(): string {
    if (state.value.connected && state.value.roomId) return state.value.roomId
    const roomId = generateRoomId()
    void loadCollabActions().then((actions) => {
      actions.connect(roomId)
      return actions.syncAllNodesToYjs()
    })
    return roomId
  }

  tryOnScopeDispose(disconnect)

  return {
    state,
    remotePeers,
    followingPeer,
    connect,
    connectSharedWorkspace,
    disconnect,
    publishGraphReplacement,
    shareCurrentDoc,
    updateCursor,
    updateSelection,
    setLocalName,
    followPeer,
    tickFollow
  }
}
