import { describe, expect, test } from 'bun:test'

import type { SceneNode, Vector } from '@open-pencil/scene-graph'
import type { Matrix } from '@open-pencil/scene-graph/primitives'

import { yNodeToProps } from '@/app/collab/yjs'
import { createEditorStore } from '@/app/editor/session'

import {
  applyMissingUpdate,
  cloneStore,
  createSyncHarness,
  exchangeMissingUpdates,
  yChildIds
} from '#tests/helpers/collab-yjs'

const IMPORTED_TRANSFORM: Matrix = {
  m00: 1,
  m01: 0,
  m02: 10,
  m10: 0,
  m11: 1,
  m12: 20
}

function importedSource(node: SceneNode) {
  const source = structuredClone(node.source)
  source.format = 'fig'
  source.fig.rawTransform = IMPORTED_TRANSFORM
  source.fig.rawSize = { x: node.width, y: node.height }
  source.fig.rawNodeFields = { text: 'Imported text' }
  return source
}

type ProbeNode = {
  childIds: string[]
  nodeId: string
  parentId: unknown
}

type ProbeSnapshot = {
  firstGraph: ProbeNode[]
  firstY: ProbeNode[]
  secondGraph: ProbeNode[]
  secondY: ProbeNode[]
}

type OppositeReparentProbe = {
  afterSecondExchange: ProbeSnapshot
  converged: ProbeSnapshot
  firstPosition: Vector
  internalKeyLeaked: boolean
  originalFirstPosition: Vector
  originalSecondPosition: Vector
  secondPosition: Vector
}

async function runOppositeReparentProbe(): Promise<OppositeReparentProbe> {
  const process = Bun.spawn({
    cmd: [globalThis.process.execPath, 'run', 'tests/helpers/yjs-opposite-reparent-probe.ts'],
    cwd: globalThis.process.cwd(),
    stderr: 'pipe',
    stdout: 'pipe'
  })
  const exitCode = await Promise.race([
    process.exited,
    Bun.sleep(8000).then(() => 'timeout' as const)
  ])
  if (exitCode === 'timeout') {
    process.kill()
    await process.exited
    throw new Error('Opposite concurrent reparent merge timed out')
  }
  const stdout = await new Response(process.stdout).text()
  const stderr = await new Response(process.stderr).text()
  if (exitCode !== 0) throw new Error(`Opposite reparent probe failed: ${stderr}`)
  return JSON.parse(stdout.trim()) as OppositeReparentProbe
}

function assertAcyclicHierarchy(nodes: ProbeNode[]) {
  const page = nodes[0]
  const firstFrame = nodes[1]
  const secondFrame = nodes[2]
  if (!page || !firstFrame || !secondFrame) throw new Error('Incomplete hierarchy probe')
  const firstIsTopLevel = firstFrame.parentId === page.nodeId
  const secondIsTopLevel = secondFrame.parentId === page.nodeId
  expect(firstIsTopLevel).not.toBe(secondIsTopLevel)
  const topLevel = firstIsTopLevel ? firstFrame : secondFrame
  const nested = firstIsTopLevel ? secondFrame : firstFrame
  expect(nested.parentId).toBe(topLevel.nodeId)
  expect(page.childIds).toEqual([topLevel.nodeId])
  expect(topLevel.childIds).toEqual([nested.nodeId])
  expect(nested.childIds).toEqual([])
}

describe('Yjs graph invariants', () => {
  test('publishes an authority-restored graph as one bounded live update', () => {
    const writerStore = createEditorStore()
    const pageId = writerStore.state.currentPageId
    const edited = writerStore.graph.createNode('RECTANGLE', pageId, {
      height: 80,
      name: 'Before authority edit',
      width: 120
    })
    const removed = writerStore.graph.createNode('ELLIPSE', pageId, {
      height: 80,
      width: 80
    })
    const followerStore = cloneStore(writerStore)
    const writer = createSyncHarness(writerStore)
    const follower = createSyncHarness(followerStore)
    writer.sync.syncAllNodesToYjs()
    applyMissingUpdate(writer, follower)

    let updateCount = 0
    writer.ydoc.on('update', () => {
      updateCount += 1
    })
    writer.sync.syncGraphReplacementToYjs()
    expect(updateCount).toBe(0)

    writerStore.graph.updateNode(edited.id, { name: 'After authority edit' })
    writerStore.graph.deleteNode(removed.id)
    const created = writerStore.graph.createNode('TEXT', pageId, {
      name: 'Created by authority edit',
      text: 'Live JSON patch'
    })
    writer.sync.syncGraphReplacementToYjs()
    expect(updateCount).toBe(1)
    applyMissingUpdate(writer, follower)

    expect(followerStore.graph.getNode(edited.id)?.name).toBe('After authority edit')
    expect(followerStore.graph.getNode(removed.id)).toBeUndefined()
    expect(followerStore.graph.getNode(created.id)?.text).toBe('Live JSON patch')

    writer.destroy()
    follower.destroy()
  })

  test('atomically updates parent membership for unilateral create and delete', () => {
    const writerStore = createEditorStore()
    const followerStore = cloneStore(writerStore)
    const writer = createSyncHarness(writerStore)
    writer.sync.syncAllNodesToYjs()
    const follower = createSyncHarness(followerStore)
    applyMissingUpdate(writer, follower)
    const unbindWriter = writer.bindGraph()
    const pageId = writerStore.state.currentPageId

    const rectangle = writerStore.graph.createNode('RECTANGLE', pageId, {
      height: 40,
      width: 60
    })
    applyMissingUpdate(writer, follower)

    expect(yChildIds(writer, pageId).filter((id) => id === rectangle.id)).toHaveLength(1)
    expect(yChildIds(follower, pageId).filter((id) => id === rectangle.id)).toHaveLength(1)
    expect(followerStore.graph.getNode(pageId)?.childIds).toContain(rectangle.id)

    writerStore.graph.deleteNode(rectangle.id)
    applyMissingUpdate(writer, follower)

    expect(writer.ynodes.has(rectangle.id)).toBe(false)
    expect(follower.ynodes.has(rectangle.id)).toBe(false)
    expect(yChildIds(writer, pageId)).not.toContain(rectangle.id)
    expect(yChildIds(follower, pageId)).not.toContain(rectangle.id)
    expect(followerStore.graph.getNode(rectangle.id)).toBeUndefined()
    expect(followerStore.graph.getNode(pageId)?.childIds).not.toContain(rectangle.id)

    unbindWriter()
    writer.destroy()
    follower.destroy()
  })

  test('materializes a complete node when a partial update targets a missing Y.Map', () => {
    const store = createEditorStore()
    const rectangle = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 80,
      name: 'Complete record',
      width: 120,
      x: 42
    })
    const harness = createSyncHarness(store)

    harness.sync.syncNodeToYjs(rectangle.id, { x: 42 })

    const ynode = harness.ynodes.get(rectangle.id)
    expect(ynode?.get('id')).toBe(rectangle.id)
    expect(ynode?.get('type')).toBe('RECTANGLE')
    expect(ynode?.get('parentId')).toBe(store.state.currentPageId)
    expect(ynode?.get('name')).toBe('Complete record')
    expect(ynode?.get('width')).toBe(120)
    expect(ynode?.get('height')).toBe(80)
    expect(ynode?.get('x')).toBe(42)

    harness.destroy()
  })

  test('persists source transform invalidation in a full reopen Y.Map', () => {
    const store = createEditorStore()
    const page = store.graph.getNode(store.state.currentPageId)
    if (!page) throw new Error('Expected current page')
    const rectangle = store.graph.createNode('RECTANGLE', page.id, {
      height: 80,
      source: importedSource(page),
      width: 120,
      x: 10
    })
    const reopenedStore = cloneStore(store)
    const writer = createSyncHarness(store)
    writer.sync.syncAllNodesToYjs()

    store.graph.updateNode(rectangle.id, { x: 90 })
    writer.sync.syncNodeToYjs(rectangle.id, { x: 90 })

    const syncedNode = writer.ynodes.get(rectangle.id)
    if (!syncedNode) throw new Error('Expected synced rectangle')
    const syncedSource = yNodeToProps(syncedNode).source as SceneNode['source'] | undefined
    expect(syncedSource?.fig.rawTransform).toBeNull()

    const reopened = createSyncHarness(reopenedStore)
    applyMissingUpdate(writer, reopened)
    expect(reopenedStore.graph.getNode(rectangle.id)?.x).toBe(90)
    expect(reopenedStore.graph.getNode(rectangle.id)?.source.fig.rawTransform).toBeNull()

    writer.destroy()
    reopened.destroy()
  })

  test('merges concurrent source-cache invalidations and preserves them on reopen', () => {
    const firstStore = createEditorStore()
    const page = firstStore.graph.getNode(firstStore.state.currentPageId)
    if (!page) throw new Error('Expected current page')
    const rectangle = firstStore.graph.createNode('RECTANGLE', page.id, {
      height: 80,
      opacity: 0.5,
      source: importedSource(page),
      width: 120,
      x: 10
    })
    const secondStore = cloneStore(firstStore)
    const reopenedStore = cloneStore(firstStore)
    const first = createSyncHarness(firstStore)
    first.sync.syncAllNodesToYjs()
    const second = createSyncHarness(secondStore)
    applyMissingUpdate(first, second)

    firstStore.graph.updateNode(rectangle.id, { x: 20 })
    first.sync.syncNodeToYjs(rectangle.id, { x: 20 })
    secondStore.graph.updateNode(rectangle.id, { opacity: 0.7 })
    second.sync.syncNodeToYjs(rectangle.id, { opacity: 0.7 })

    exchangeMissingUpdates(first, second)

    for (const harness of [first, second]) {
      const ynode = harness.ynodes.get(rectangle.id)
      if (!ynode) throw new Error('Expected concurrent rectangle')
      const source = yNodeToProps(ynode).source as SceneNode['source'] | undefined
      expect(source?.fig.rawTransform).toBeNull()
      expect(source?.fig.rawNodeFields).toEqual({})
      expect(harness.store.graph.getNode(rectangle.id)).toMatchObject({ opacity: 0.7, x: 20 })
      expect(harness.store.graph.getNode(rectangle.id)?.source.fig.rawTransform).toBeNull()
      expect(harness.store.graph.getNode(rectangle.id)?.source.fig.rawNodeFields).toEqual({})
    }

    const reopened = createSyncHarness(reopenedStore)
    applyMissingUpdate(first, reopened)
    expect(reopenedStore.graph.getNode(rectangle.id)).toMatchObject({ opacity: 0.7, x: 20 })
    expect(reopenedStore.graph.getNode(rectangle.id)?.source.fig.rawTransform).toBeNull()
    expect(reopenedStore.graph.getNode(rectangle.id)?.source.fig.rawNodeFields).toEqual({})

    first.destroy()
    second.destroy()
    reopened.destroy()
  })

  test('persists text cache invalidation in a full reopen Y.Map', () => {
    const store = createEditorStore()
    const text = store.graph.createNode('TEXT', store.state.currentPageId, {
      figmaDerivedTextGlyphs: [
        { commandsBlob: new Uint8Array([4, 5, 6]), fontSize: 16, x: 0, y: 0 }
      ],
      text: 'Before',
      textPicture: new Uint8Array([1, 2, 3])
    })
    const reopenedStore = cloneStore(store)
    const writer = createSyncHarness(store)
    writer.sync.syncAllNodesToYjs()

    store.graph.updateNode(text.id, { text: 'After' })
    writer.sync.syncNodeToYjs(text.id, { text: 'After' })

    expect(writer.ynodes.get(text.id)?.get('textPicture')).toBeNull()
    expect(writer.ynodes.get(text.id)?.get('figmaDerivedTextGlyphs')).toBeNull()

    const reopened = createSyncHarness(reopenedStore)
    applyMissingUpdate(writer, reopened)
    expect(reopenedStore.graph.getNode(text.id)?.text).toBe('After')
    expect(reopenedStore.graph.getNode(text.id)?.textPicture).toBeNull()
    expect(reopenedStore.graph.getNode(text.id)?.figmaDerivedTextGlyphs).toBeNull()

    writer.destroy()
    reopened.destroy()
  })

  test('concurrent reparents converge to exactly one winning parent and stable geometry', () => {
    const firstStore = createEditorStore()
    const pageId = firstStore.state.currentPageId
    const originalParent = firstStore.graph.createNode('FRAME', pageId, {
      height: 300,
      width: 300,
      x: 0,
      y: 0
    })
    const firstCandidate = firstStore.graph.createNode('FRAME', pageId, {
      height: 300,
      width: 300,
      x: 500,
      y: 100
    })
    const secondCandidate = firstStore.graph.createNode('FRAME', pageId, {
      height: 300,
      width: 300,
      x: -400,
      y: 200
    })
    const child = firstStore.graph.createNode('RECTANGLE', originalParent.id, {
      height: 40,
      width: 60,
      x: 30,
      y: 50
    })
    const originalAbsolutePosition = firstStore.graph.getAbsolutePosition(child.id)
    const secondStore = cloneStore(firstStore)
    const first = createSyncHarness(firstStore)
    first.sync.syncAllNodesToYjs()
    const second = createSyncHarness(secondStore)
    applyMissingUpdate(first, second)

    firstStore.graph.reparentNode(child.id, firstCandidate.id)
    const firstChild = firstStore.graph.getNode(child.id)
    if (!firstChild) throw new Error('Expected first child')
    first.sync.syncNodeToYjs(
      child.id,
      { parentId: firstChild.parentId, x: firstChild.x, y: firstChild.y },
      [originalParent.id, firstCandidate.id]
    )

    secondStore.graph.reparentNode(child.id, secondCandidate.id)
    const secondChild = secondStore.graph.getNode(child.id)
    if (!secondChild) throw new Error('Expected second child')
    second.sync.syncNodeToYjs(
      child.id,
      { parentId: secondChild.parentId, x: secondChild.x, y: secondChild.y },
      [originalParent.id, secondCandidate.id]
    )

    exchangeMissingUpdates(first, second)
    exchangeMissingUpdates(first, second)

    const firstWinningParent = first.ynodes.get(child.id)?.get('parentId')
    const secondWinningParent = second.ynodes.get(child.id)?.get('parentId')
    expect(firstWinningParent).toBe(secondWinningParent)
    expect([firstCandidate.id, secondCandidate.id]).toContain(firstWinningParent)

    for (const harness of [first, second]) {
      const listedParents = [originalParent.id, firstCandidate.id, secondCandidate.id].filter(
        (parentId) => yChildIds(harness, parentId).includes(child.id)
      )
      expect(listedParents).toEqual([firstWinningParent])
      expect(
        yChildIds(harness, firstWinningParent as string).filter((id) => id === child.id)
      ).toHaveLength(1)
      expect(harness.store.graph.getNode(child.id)?.parentId).toBe(firstWinningParent)
      expect(harness.store.graph.getAbsolutePosition(child.id)).toEqual(originalAbsolutePosition)
      const graphListedParents = [originalParent.id, firstCandidate.id, secondCandidate.id].filter(
        (parentId) => harness.store.graph.getNode(parentId)?.childIds.includes(child.id)
      )
      expect(graphListedParents).toEqual([firstWinningParent])
    }

    first.destroy()
    second.destroy()
  })

  test(
    'opposite concurrent reparents terminate and converge to one acyclic hierarchy',
    async () => {
      const result = await runOppositeReparentProbe()

      expect(result.converged.firstY).toEqual(result.converged.secondY)
      expect(result.converged.firstGraph).toEqual(result.converged.firstY)
      expect(result.converged.secondGraph).toEqual(result.converged.firstY)
      assertAcyclicHierarchy(result.converged.firstY)
      expect(result.firstPosition).toEqual(result.originalFirstPosition)
      expect(result.secondPosition).toEqual(result.originalSecondPosition)
      expect(Number.isFinite(result.firstPosition.x)).toBe(true)
      expect(Number.isFinite(result.firstPosition.y)).toBe(true)
      expect(Number.isFinite(result.secondPosition.x)).toBe(true)
      expect(Number.isFinite(result.secondPosition.y)).toBe(true)
      expect(result.afterSecondExchange).toEqual(result.converged)
      expect(result.internalKeyLeaked).toBe(false)
    },
    { timeout: 10_000 }
  )
})
