import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { SceneGraph } from '@open-pencil/scene-graph'

import { connectDurableYjsProvider } from '@/app/collab/persistence/provider'
import type {
  DurableYjsDocumentState,
  DurableYjsStore,
  DurableYjsUpdate,
  DurableYjsUpdateListener
} from '@/app/collab/persistence/types'
import { createYjsGraphSync, registerYjsObservers } from '@/app/collab/yjs'
import { createEditorStore } from '@/app/editor/session'
import {
  createSidebarPage,
  moveSidebarBoard,
  orderedSidebarBoards,
  orderedSidebarPages,
  resolveSidebarWorkspace,
  sidebarWorkspacePluginData
} from '@/app/sidebar-workspace/tree'

class SharedMemoryStore implements DurableYjsStore {
  readonly updates: DurableYjsUpdate[] = []

  async append(clientUpdateId: string, data: Uint8Array) {
    const existing = this.updates.find((update) => update.clientUpdateId === clientUpdateId)
    if (existing) return existing
    const update = {
      clientUpdateId,
      data,
      sequence: this.updates.length + 1
    }
    this.updates.push(update)
    return update
  }

  async checkpoint() {
    return false
  }

  async load(): Promise<DurableYjsDocumentState> {
    return { snapshot: null, snapshotSequence: 0, updates: [...this.updates] }
  }

  async subscribe(_listener: DurableYjsUpdateListener) {
    return async () => undefined
  }
}

function createGraphSync(graph: SceneGraph, ydoc: Y.Doc, observe: boolean) {
  const store = createEditorStore(graph)
  store.setViewportSize(1200, 800)
  const ynodes = ydoc.getMap<Y.Map<unknown>>('nodes')
  const yimages = ydoc.getMap<Uint8Array>('images')
  let suppressYjsEvents = false
  const sync = createYjsGraphSync({
    getStore: () => store,
    getYdoc: () => ydoc,
    getYimages: () => yimages,
    getYnodes: () => ynodes,
    setSuppressYjsEvents: (value) => {
      suppressYjsEvents = value
    }
  })
  if (observe) {
    registerYjsObservers({
      applyYjsToGraph: sync.applyYjsToGraph,
      getSuppressYjsEvents: () => suppressYjsEvents,
      setSuppressGraphSync: () => undefined,
      store,
      yimages,
      ynodes
    })
  }
  return sync
}

describe('durable OpenPencil workspace structure', () => {
  test('restores nested Projects and their Boards on another device', async () => {
    const hostGraph = new SceneGraph()
    const firstBoard = hostGraph.getPages()[0]
    if (!firstBoard) throw new Error('missing first board')
    hostGraph.updateNode(firstBoard.id, { name: 'Dental Chart' })
    const reviewBoard = hostGraph.addPage('Dental Chart Review')
    const initialWorkspace = resolveSidebarWorkspace(hostGraph).workspace
    const parentProject = orderedSidebarPages(initialWorkspace, null)[0]
    if (!parentProject) throw new Error('missing parent project')
    const archive = createSidebarPage(initialWorkspace, {
      name: 'Smylr Archive',
      parentId: parentProject.id
    })
    const organizedWorkspace = moveSidebarBoard(
      archive.workspace,
      reviewBoard.id,
      archive.page.id,
      0
    )
    const hostRoot = hostGraph.getNode(hostGraph.rootId)
    if (!hostRoot) throw new Error('missing host document root')
    hostGraph.updateNode(hostRoot.id, {
      pluginData: sidebarWorkspacePluginData(hostRoot, organizedWorkspace)
    })

    const durableStore = new SharedMemoryStore()
    const hostDocument = new Y.Doc()
    createGraphSync(hostGraph, hostDocument, false).syncAllNodesToYjs()
    const hostProvider = await connectDurableYjsProvider({
      store: durableStore,
      ydoc: hostDocument
    })
    await hostProvider.destroy()

    const peerGraph = new SceneGraph()
    const peerDocument = new Y.Doc()
    createGraphSync(peerGraph, peerDocument, true)
    const peerProvider = await connectDurableYjsProvider({
      store: durableStore,
      ydoc: peerDocument
    })
    const restored = resolveSidebarWorkspace(peerGraph).workspace
    const restoredArchive = restored.pages.find((page) => page.name === 'Smylr Archive')

    expect(restoredArchive?.parentId).toBe(parentProject.id)
    expect(orderedSidebarBoards(restored, restoredArchive?.id ?? '')).toEqual([
      expect.objectContaining({
        label: 'Main board',
        pageId: reviewBoard.id,
        parentPageId: restoredArchive?.id
      })
    ])

    await peerProvider.destroy()
    hostDocument.destroy()
    peerDocument.destroy()
  })
})
