import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  bindAutomationPersistence,
  requestAutomationPersistence
} from '@/app/automation/bridge/persistence'
import { createLocalAwarenessActions } from '@/app/collab/local-awareness'
import { createInitialCollabState, hasRemoteAwarenessChange } from '@/app/collab/session'
import { createEditorStore } from '@/app/editor/session'

function createAwarenessHarness() {
  const store = createEditorStore(new SceneGraph())
  const document = new Y.Doc()
  const awareness = new Awareness(document)
  const state = ref(createInitialCollabState('Performance test'))
  const actions = createLocalAwarenessActions({
    state,
    storedName: ref('Performance test'),
    getStore: () => store,
    getAwareness: () => awareness
  })
  return { actions, awareness, document, state, store }
}

describe('collaboration awareness performance', () => {
  test('does not rebuild peers or advance the scene for local pointer updates', () => {
    const { actions, awareness, document, store } = createAwarenessHarness()
    let peerRefreshes = 0
    let sceneRenders = 0
    awareness.on('change', (change: { added: number[]; updated: number[]; removed: number[] }) => {
      if (!hasRemoteAwarenessChange(change, awareness.clientID)) return
      peerRefreshes += 1
      actions.updatePeersList()
    })
    const stopRenderListener = store.onEditorEvent('render:requested', () => {
      sceneRenders += 1
    })
    const initialSceneVersion = store.state.sceneVersion

    for (let index = 0; index < 120; index += 1) {
      actions.updateCursor(index, index * 2, store.state.currentPageId)
    }

    expect(peerRefreshes).toBe(0)
    expect(sceneRenders).toBe(0)
    expect(store.state.sceneVersion).toBe(initialSceneVersion)

    stopRenderListener()
    awareness.destroy()
    document.destroy()
  })

  test('repaints the overlay without invalidating the scene when a remote peer changes', () => {
    const { actions, awareness, document, state, store } = createAwarenessHarness()
    const remoteClientId = awareness.clientID + 1
    expect(
      hasRemoteAwarenessChange(
        { added: [remoteClientId], removed: [], updated: [] },
        awareness.clientID
      )
    ).toBe(true)
    awareness.states.set(remoteClientId, {
      cursor: { pageId: store.state.currentPageId, x: 120, y: 240 },
      selection: [],
      user: {
        color: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
        name: 'Remote peer'
      }
    })
    let overlayRenders = 0
    let sceneRenders = 0
    const stopOverlayListener = store.onEditorEvent('overlay:requested', () => {
      overlayRenders += 1
    })
    const stopRenderListener = store.onEditorEvent('render:requested', () => {
      sceneRenders += 1
    })
    const initialSceneVersion = store.state.sceneVersion

    actions.updatePeersList()

    expect(state.value.peers).toHaveLength(1)
    expect(store.state.remoteCursors).toEqual([
      expect.objectContaining({ name: 'Remote peer', x: 120, y: 240 })
    ])
    expect(overlayRenders).toBe(1)
    expect(sceneRenders).toBe(0)
    expect(store.state.sceneVersion).toBe(initialSceneVersion)

    stopOverlayListener()
    stopRenderListener()
    awareness.destroy()
    document.destroy()
  })

  test('keeps an automation persistence receipt durable during local awareness traffic', async () => {
    const { actions, awareness, document, store } = createAwarenessHarness()
    let finishPersistence = () => undefined
    const persistenceGate = new Promise<void>((resolve) => {
      finishPersistence = resolve
    })
    const requestedRevision = store.state.sceneVersion
    bindAutomationPersistence(store, async (sceneRevision) => {
      await persistenceGate
      expect(sceneRevision).toBe(requestedRevision)
      return { status: 'durable', target: 'local_workspace_authority' }
    })

    const persistence = requestAutomationPersistence(store, requestedRevision, 250)
    for (let index = 0; index < 120; index += 1) {
      actions.updateCursor(index, index * 2, store.state.currentPageId)
      actions.updateSelection(index % 2 === 0 ? [] : ['selection-target'])
    }

    expect(store.state.sceneVersion).toBe(requestedRevision)
    finishPersistence()
    await expect(persistence).resolves.toMatchObject({
      requested_scene_revision: requestedRevision,
      status: 'durable',
      target: 'local_workspace_authority'
    })

    awareness.destroy()
    document.destroy()
  })
})
