import { serializeSceneGraph } from '@open-pencil/core/kiwi'

import { createEditorStore } from '@/app/editor/session'

import {
  applyMissingUpdate,
  cloneStore,
  createSyncHarness,
  exchangeMissingUpdates,
  yChildIds
} from '#tests/helpers/collab-yjs'

function syncReparent(
  harness: ReturnType<typeof createSyncHarness>,
  nodeId: string,
  oldParentId: string,
  newParentId: string
) {
  harness.store.graph.reparentNode(nodeId, newParentId)
  const node = harness.store.graph.getNode(nodeId)
  if (!node) throw new Error(`Missing reparented node ${nodeId}`)
  harness.sync.syncNodeToYjs(nodeId, { parentId: node.parentId, x: node.x, y: node.y }, [
    oldParentId,
    newParentId
  ])
}

function snapshot(
  first: ReturnType<typeof createSyncHarness>,
  second: ReturnType<typeof createSyncHarness>,
  pageId: string,
  firstFrameId: string,
  secondFrameId: string
) {
  const nodeIds = [pageId, firstFrameId, secondFrameId]
  return {
    firstGraph: nodeIds.map((nodeId) => {
      const node = first.store.graph.getNode(nodeId)
      return { childIds: node?.childIds ?? [], nodeId, parentId: node?.parentId ?? null }
    }),
    firstY: nodeIds.map((nodeId) => ({
      childIds: yChildIds(first, nodeId),
      nodeId,
      parentId: first.ynodes.get(nodeId)?.get('parentId') ?? null
    })),
    secondGraph: nodeIds.map((nodeId) => {
      const node = second.store.graph.getNode(nodeId)
      return { childIds: node?.childIds ?? [], nodeId, parentId: node?.parentId ?? null }
    }),
    secondY: nodeIds.map((nodeId) => ({
      childIds: yChildIds(second, nodeId),
      nodeId,
      parentId: second.ynodes.get(nodeId)?.get('parentId') ?? null
    }))
  }
}

const firstStore = createEditorStore()
const pageId = firstStore.state.currentPageId
const firstFrame = firstStore.graph.createNode('FRAME', pageId, {
  height: 200,
  width: 200,
  x: 0,
  y: 0
})
const secondFrame = firstStore.graph.createNode('FRAME', pageId, {
  height: 200,
  width: 200,
  x: 400,
  y: 0
})
const originalFirstPosition = firstStore.graph.getAbsolutePosition(firstFrame.id)
const originalSecondPosition = firstStore.graph.getAbsolutePosition(secondFrame.id)
const secondStore = cloneStore(firstStore)
const first = createSyncHarness(firstStore)
first.sync.syncAllNodesToYjs()
const second = createSyncHarness(secondStore)
applyMissingUpdate(first, second)

syncReparent(first, firstFrame.id, pageId, secondFrame.id)
syncReparent(second, secondFrame.id, pageId, firstFrame.id)
exchangeMissingUpdates(first, second)

const converged = snapshot(first, second, pageId, firstFrame.id, secondFrame.id)
const firstPosition = firstStore.graph.getAbsolutePosition(firstFrame.id)
const secondPosition = firstStore.graph.getAbsolutePosition(secondFrame.id)
exchangeMissingUpdates(first, second)
const afterSecondExchange = snapshot(first, second, pageId, firstFrame.id, secondFrame.id)

const result = {
  afterSecondExchange,
  converged,
  firstPosition,
  internalKeyLeaked:
    JSON.stringify(serializeSceneGraph(firstStore.graph)).includes('__openPencilCollab') ||
    JSON.stringify(serializeSceneGraph(secondStore.graph)).includes('__openPencilCollab'),
  originalFirstPosition,
  originalSecondPosition,
  secondPosition
}

first.destroy()
second.destroy()
await Bun.write(Bun.stdout, JSON.stringify(result))
