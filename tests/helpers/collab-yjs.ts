import * as Y from 'yjs'

import { deserializeSceneGraph, serializeSceneGraph } from '@open-pencil/core/kiwi'

import { createCollabHydrationState } from '@/app/collab/hydration'
import { bindCollabGraphEvents, createYjsGraphSync, registerYjsObservers } from '@/app/collab/yjs'
import { createEditorStore } from '@/app/editor/session'
import type { EditorStore } from '@/app/editor/session'

export type SyncHarness = ReturnType<typeof createSyncHarness>

export function cloneStore(store: EditorStore): EditorStore {
  return createEditorStore(deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph))))
}

export function createSyncHarness(store: EditorStore, ydoc = new Y.Doc()) {
  const ynodes = ydoc.getMap<Y.Map<unknown>>('nodes')
  const yimages = ydoc.getMap<Uint8Array>('images')
  let suppressYjsEvents = false
  let suppressGraphSync = false
  const sync = createYjsGraphSync({
    getStore: () => store,
    getYdoc: () => ydoc,
    getYnodes: () => ynodes,
    getYimages: () => yimages,
    setSuppressYjsEvents: (value) => {
      suppressYjsEvents = value
    }
  })

  registerYjsObservers({
    store,
    ynodes,
    yimages,
    getSuppressYjsEvents: () => suppressYjsEvents,
    setSuppressGraphSync: (value) => {
      suppressGraphSync = value
    },
    applyYjsToGraph: sync.applyYjsToGraph
  })

  return {
    store,
    sync,
    ydoc,
    ynodes,
    bindGraph() {
      return bindCollabGraphEvents({
        store,
        getYdoc: () => ydoc,
        getYnodes: () => ynodes,
        getSuppressGraphSync: () => suppressGraphSync,
        hydration: createCollabHydrationState(),
        setSuppressYjsEvents: (value) => {
          suppressYjsEvents = value
        },
        syncNodeToYjs: sync.syncNodeToYjs
      })
    },
    destroy() {
      ydoc.destroy()
    }
  }
}

export function applyMissingUpdate(source: SyncHarness, target: SyncHarness) {
  Y.applyUpdate(target.ydoc, Y.encodeStateAsUpdate(source.ydoc, Y.encodeStateVector(target.ydoc)))
}

export function exchangeMissingUpdates(first: SyncHarness, second: SyncHarness) {
  const firstUpdate = Y.encodeStateAsUpdate(first.ydoc, Y.encodeStateVector(second.ydoc))
  const secondUpdate = Y.encodeStateAsUpdate(second.ydoc, Y.encodeStateVector(first.ydoc))
  Y.applyUpdate(first.ydoc, secondUpdate)
  Y.applyUpdate(second.ydoc, firstUpdate)
}

export function yChildIds(harness: SyncHarness, nodeId: string): string[] {
  const value = harness.ynodes.get(nodeId)?.get('childIds')
  return Array.isArray(value)
    ? value.filter((childId): childId is string => typeof childId === 'string')
    : []
}
