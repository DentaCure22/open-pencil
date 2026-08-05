import * as Y from 'yjs'

import type { YNodes } from '@/app/collab/structure'
import { collabValuesEqual, syncNodePropsToYMap } from '@/app/collab/yjs/node-record'
import {
  getObjectGraphYRecords,
  isObjectGraphPageMigrated,
  readYNodePluginData,
  syncObjectGraphPageToYjs,
  tombstoneObjectGraphPageInYjs
} from '@/app/collab/yjs/object-graph'
import type { EditorStore } from '@/app/editor/active-store'

type GraphReplacementPublisherOptions = {
  getStore: () => EditorStore
  getYdoc: () => Y.Doc | null
  getYnodes: () => YNodes | null
  getYimages: () => Y.Map<Uint8Array> | null
  setSuppressYjsEvents: (value: boolean) => void
}

export function syncGraphImagesToYjs(store: EditorStore, yimages: Y.Map<Uint8Array> | null) {
  if (!yimages) return
  for (const hash of yimages.keys()) {
    if (!store.graph.images.has(hash)) yimages.delete(hash)
  }
  for (const [hash, data] of store.graph.images) {
    if (!collabValuesEqual(yimages.get(hash), data)) yimages.set(hash, data)
  }
}

export function createGraphReplacementPublisher({
  getStore,
  getYdoc,
  getYnodes,
  getYimages,
  setSuppressYjsEvents
}: GraphReplacementPublisherOptions) {
  return function syncGraphReplacementToYjs() {
    const store = getStore()
    const ydoc = getYdoc()
    const ynodes = getYnodes()
    if (!ydoc || !ynodes) return
    const nodes = [...store.graph.getAllNodes()]
    const nodeIds = new Set(nodes.map((node) => node.id))
    const localYimages = getYimages()

    setSuppressYjsEvents(true)
    try {
      ydoc.transact(() => {
        const records = getObjectGraphYRecords(ydoc)
        for (const [nodeId, ynode] of ynodes) {
          if (nodeIds.has(nodeId)) continue
          if (ynode.get('type') === 'CANVAS') {
            tombstoneObjectGraphPageInYjs(records, nodeId, readYNodePluginData(ynode))
          }
          ynodes.delete(nodeId)
        }

        for (const node of nodes) {
          let ynode = ynodes.get(node.id)
          const materializingNode = !ynode
          if (!ynode) {
            ynode = new Y.Map()
            ynodes.set(node.id, ynode)
          }
          const previousPluginData = readYNodePluginData(ynode)
          syncNodePropsToYMap(node, ynode)
          if (
            node.type === 'CANVAS' &&
            (materializingNode ||
              !isObjectGraphPageMigrated(records, node.id) ||
              !collabValuesEqual(previousPluginData, node.pluginData))
          ) {
            syncObjectGraphPageToYjs(records, node, previousPluginData)
          }
        }

        syncGraphImagesToYjs(store, localYimages)
      })
    } catch (error) {
      console.error('[Collab] Failed to publish graph replacement:', error)
    } finally {
      setSuppressYjsEvents(false)
    }
  }
}
