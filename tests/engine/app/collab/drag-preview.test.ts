import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import type { EditorPresentationUpdateCallback } from '@open-pencil/vue'

import { createCodeObject, createUserCodeObjectDocument } from '@/app/code-object/model'
import { codeObjectCanvasStyle } from '@/app/code-object/transform'
import {
  createDragPreviewSession,
  type DragPreviewMessage,
  type DragPreviewTransport,
  type OutboundDragPreview
} from '@/app/collab/drag-preview'
import { createEditorStore } from '@/app/editor/session'
import {
  connectObjects,
  objectGraphReactFlowSnapshot,
  resolveObjectGraphConnectionGeometry
} from '@/app/object-graph'

class FakeDragPreviewTransport implements DragPreviewTransport {
  readonly published: DragPreviewMessage[] = []
  readonly sessionId = 'local-session'
  private readonly disconnectListeners = new Set<(sessionId: string) => void>()
  private readonly previewListeners = new Set<(preview: DragPreviewMessage) => void>()

  publishDragPreview(preview: OutboundDragPreview) {
    this.published.push({ ...preview, sessionId: this.sessionId })
  }

  subscribeDragPreview(listener: (preview: DragPreviewMessage) => void) {
    this.previewListeners.add(listener)
    return () => this.previewListeners.delete(listener)
  }

  subscribeSessionDisconnect(listener: (sessionId: string) => void) {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  receive(preview: DragPreviewMessage) {
    for (const listener of this.previewListeners) listener(preview)
  }

  disconnect(sessionId: string) {
    for (const listener of this.disconnectListeners) listener(sessionId)
  }
}

type ClockTimer = number | ReturnType<typeof setTimeout>

type PendingTimer = {
  callback: () => void
  dueAt: number
}

function createUpdateClock() {
  let callback: EditorPresentationUpdateCallback | null = null
  let nextTimerId = 1
  let time = 0
  const timers = new Map<ClockTimer, PendingTimer>()

  function runDueTimers() {
    while (true) {
      let due: [ClockTimer, PendingTimer] | null = null
      for (const entry of timers) {
        if (entry[1].dueAt > time) continue
        if (!due || entry[1].dueAt < due[1].dueAt) due = entry
      }
      if (!due) return
      timers.delete(due[0])
      due[1].callback()
    }
  }

  return {
    advanceTo(timestamp: number) {
      time = timestamp
      runDueTimers()
    },
    cancel(candidate: EditorPresentationUpdateCallback) {
      if (callback === candidate) callback = null
    },
    clearTimer(timer: ClockTimer) {
      timers.delete(timer)
    },
    flush(timestamp: number) {
      time = timestamp
      runDueTimers()
      const pending = callback
      callback = null
      if (!pending) throw new Error('No presentation update is scheduled')
      pending(timestamp)
    },
    get hasScheduledUpdate() {
      return callback !== null
    },
    now() {
      return time
    },
    schedule(next: EditorPresentationUpdateCallback) {
      callback = next
    },
    scheduleTimer(next: () => void, delayMs: number) {
      const timer: ClockTimer = nextTimerId
      nextTimerId += 1
      timers.set(timer, { callback: next, dueAt: time + delayMs })
      return timer
    },
    setTime(timestamp: number) {
      time = timestamp
    },
    get timerCount() {
      return timers.size
    }
  }
}

type HarnessOptions = {
  activeTimeoutMs?: number
  terminalGraceMs?: number
  terminalTimeoutMs?: number
}

function preview(
  nodeId: string,
  pageId: string,
  overrides: Partial<DragPreviewMessage> = {}
): DragPreviewMessage {
  return {
    gestureId: 'remote-gesture',
    nodeId,
    pageId,
    phase: 'active',
    sequence: 1,
    sessionId: 'remote-session',
    x: 110,
    y: 120,
    ...overrides
  }
}

function createHarness(options: HarnessOptions = {}) {
  const store = createEditorStore()
  const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
    height: 50,
    width: 50,
    x: 10,
    y: 20
  })
  const transport = new FakeDragPreviewTransport()
  const clock = createUpdateClock()
  const session = createDragPreviewSession({
    ...options,
    cancelUpdate: clock.cancel,
    clearTimer: clock.clearTimer,
    now: clock.now,
    scheduleTimer: clock.scheduleTimer,
    scheduleUpdate: clock.schedule,
    store,
    transport
  })
  return { clock, node, session, store, transport }
}

describe('local workspace drag previews', () => {
  test('coalesces local movement and publishes the authoritative terminal pose', async () => {
    const harness = createHarness()
    harness.store.select([harness.node.id])

    harness.store.graph.updateNodePositionPreview(harness.node.id, 30, 40)
    harness.store.graph.updateNodePositionPreview(harness.node.id, 60, 70)
    expect(harness.transport.published).toHaveLength(0)

    harness.clock.flush(0)
    expect(harness.transport.published).toHaveLength(1)
    expect(harness.transport.published[0]).toMatchObject({
      phase: 'active',
      sequence: 1,
      x: 60,
      y: 70
    })

    harness.store.graph.updateNodePositionPreview(harness.node.id, 10, 20)
    harness.store.updateNodeWithUndo(harness.node.id, { x: 60, y: 70 }, 'Move')
    await Promise.resolve()

    expect(harness.transport.published.at(-1)).toMatchObject({
      phase: 'terminal',
      sequence: 2,
      x: 60,
      y: 70
    })
    expect(harness.store.undo.undo()).toBe('Move')
    expect(harness.store.graph.getNode(harness.node.id)).toMatchObject({ x: 10, y: 20 })
    harness.session.dispose()
  })

  test('interpolates remote geometry without mutating history or serialization authority', () => {
    const harness = createHarness()
    const sceneVersion = harness.store.state.sceneVersion

    harness.transport.receive(preview(harness.node.id, harness.store.state.currentPageId))
    harness.clock.flush(24)

    expect(harness.store.graph.getNode(harness.node.id)).toMatchObject({ x: 10, y: 20 })
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 60, y: 70 })
    expect(harness.store.state.sceneVersion).toBe(sceneVersion)
    expect(harness.store.undo.undo()).toBeNull()
    harness.session.dispose()
  })

  test('preserves a remote projection across metadata-only authoritative updates', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(48)
    expect(harness.clock.hasScheduledUpdate).toBe(false)

    harness.store.graph.updateNode(harness.node.id, {
      pluginData: [{ key: 'unrelated', pluginId: 'test', value: 'metadata' }]
    })

    expect(harness.store.graph.getNode(harness.node.id)).toMatchObject({ x: 10, y: 20 })
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 110,
      y: 120
    })
    expect(harness.clock.hasScheduledUpdate).toBe(false)
    harness.session.dispose()
  })

  test('stops scheduling updates at the target and expires through a timer', () => {
    const harness = createHarness({ activeTimeoutMs: 100 })
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(48)

    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 110,
      y: 120
    })
    expect(harness.clock.hasScheduledUpdate).toBe(false)
    expect(harness.clock.timerCount).toBe(1)

    harness.clock.advanceTo(99)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 110,
      y: 120
    })
    harness.clock.advanceTo(100)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 10, y: 20 })
    expect(harness.clock.hasScheduledUpdate).toBe(false)
    expect(harness.clock.timerCount).toBe(0)
    harness.session.dispose()
  })

  test('lets a rapid second gesture from the same session replace a settling terminal', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId, { phase: 'terminal' }))
    harness.clock.flush(24)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 60, y: 70 })

    harness.clock.setTime(24)
    harness.transport.receive(
      preview(harness.node.id, pageId, {
        gestureId: 'second-gesture',
        sequence: 1,
        x: 210,
        y: 220
      })
    )
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 60, y: 70 })

    harness.clock.flush(48)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 135,
      y: 145
    })
    harness.clock.flush(72)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 210,
      y: 220
    })

    harness.transport.receive(
      preview(harness.node.id, pageId, { phase: 'terminal', sequence: 2, x: 999, y: 999 })
    )
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 210,
      y: 220
    })
    harness.session.dispose()
  })

  test('adapts to packet cadence without accepting backward stale packets', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(16)
    const first = harness.store.graph.getPresentedNodePosition(harness.node.id)
    expect(first.x).toBeCloseTo(43.333, 2)

    harness.clock.setTime(16)
    harness.transport.receive(preview(harness.node.id, pageId, { sequence: 2, x: 210, y: 220 }))
    harness.clock.flush(28)
    const second = harness.store.graph.getPresentedNodePosition(harness.node.id)
    expect(second.x).toBeCloseTo(126.667, 2)
    expect(second.x).toBeGreaterThan(first.x)

    harness.transport.receive(preview(harness.node.id, pageId, { sequence: 1, x: -500, y: -500 }))
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id).x).toBe(second.x)
    harness.clock.flush(40)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 210,
      y: 220
    })
    harness.session.dispose()
  })

  test('publishes each selected node in a multi-selection independently', async () => {
    const harness = createHarness()
    const second = harness.store.graph.createNode('RECTANGLE', harness.store.state.currentPageId, {
      height: 50,
      width: 50,
      x: 100,
      y: 120
    })
    harness.store.select([harness.node.id, second.id])

    harness.store.graph.updateNodePositionPreview(harness.node.id, 30, 40)
    harness.store.graph.updateNodePositionPreview(second.id, 130, 140)
    harness.clock.flush(0)

    expect(
      harness.transport.published.filter((message) => message.phase === 'active')
    ).toHaveLength(2)
    expect(harness.transport.published).toContainEqual(
      expect.objectContaining({ nodeId: harness.node.id, phase: 'active', x: 30, y: 40 })
    )
    expect(harness.transport.published).toContainEqual(
      expect.objectContaining({ nodeId: second.id, phase: 'active', x: 130, y: 140 })
    )

    harness.store.graph.updateNodePositionPreview(harness.node.id, 10, 20)
    harness.store.graph.updateNodePositionPreview(second.id, 100, 120)
    await Promise.resolve()

    expect(
      harness.transport.published.filter((message) => message.phase === 'cancelled')
    ).toHaveLength(2)
    harness.session.dispose()
  })

  test('holds terminal presentation until the matching durable transform catches up', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(24)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 60, y: 70 })

    harness.clock.setTime(24)
    harness.transport.receive(
      preview(harness.node.id, pageId, { phase: 'terminal', sequence: 2, x: 210, y: 220 })
    )
    harness.clock.flush(42)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 135,
      y: 145
    })

    harness.store.graph.updateNode(harness.node.id, { x: 210, y: 220 })
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 135,
      y: 145
    })
    harness.clock.flush(60)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 210,
      y: 220
    })
    expect(harness.clock.hasScheduledUpdate).toBe(false)
    expect(harness.clock.timerCount).toBe(0)
    harness.session.dispose()
  })

  test('bridges a durable transform that arrives just before its terminal preview', () => {
    const harness = createHarness({ terminalGraceMs: 60 })
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(24)
    harness.store.graph.updateNode(harness.node.id, { x: 210, y: 220 })
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 60, y: 70 })

    harness.transport.receive(
      preview(harness.node.id, pageId, { phase: 'terminal', sequence: 2, x: 210, y: 220 })
    )
    harness.clock.flush(42)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 135,
      y: 145
    })
    harness.clock.flush(60)
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: 210,
      y: 220
    })
    expect(harness.clock.timerCount).toBe(0)
    harness.session.dispose()
  })

  test('restores the durable local position when a live preview session is torn down', () => {
    const harness = createHarness()
    harness.store.select([harness.node.id])
    harness.store.graph.updateNodePositionPreview(harness.node.id, 80, 90)

    harness.session.dispose()

    expect(harness.store.graph.getNode(harness.node.id)).toMatchObject({ x: 10, y: 20 })
    expect(harness.transport.published.at(-1)).toMatchObject({
      phase: 'cancelled',
      x: 10,
      y: 20
    })
    expect(harness.store.undo.undo()).toBeNull()
  })

  test('rejects stale packets and clears previews on cancellation and disconnect', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(48)
    harness.transport.receive(preview(harness.node.id, pageId, { phase: 'cancelled', sequence: 2 }))
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 10, y: 20 })

    harness.transport.receive(preview(harness.node.id, pageId, { sequence: 3, x: 999, y: 999 }))
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 10, y: 20 })

    harness.transport.receive(
      preview(harness.node.id, pageId, { gestureId: 'second-gesture', sequence: 1 })
    )
    harness.clock.flush(96)
    harness.transport.disconnect('remote-session')
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 10, y: 20 })
    expect(harness.clock.timerCount).toBe(0)
    harness.session.dispose()
  })

  test('clears the projection timer and tombstones delayed packets when a node is deleted', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(48)
    expect(harness.clock.timerCount).toBe(1)

    harness.store.graph.deleteNode(harness.node.id)
    expect(harness.clock.timerCount).toBe(0)
    harness.store.graph.createNodeWithId(harness.node.id, 'RECTANGLE', pageId, {
      height: 50,
      width: 50,
      x: 10,
      y: 20
    })
    harness.transport.receive(preview(harness.node.id, pageId, { sequence: 2, x: 999, y: 999 }))

    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({ x: 10, y: 20 })
    expect(harness.store.graph.hasNodePositionPresentations()).toBe(false)
    expect(harness.clock.hasScheduledUpdate).toBe(false)
    harness.session.dispose()
  })

  test('cleans up a preview on same-identity graph replacement and rejects its delayed packet', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(48)
    expect(harness.clock.timerCount).toBe(1)

    const replacement = new SceneGraph()
    const defaultPage = replacement.getPages()[0]
    if (!defaultPage) throw new Error('Replacement graph has no default page')
    replacement.deleteNode(defaultPage.id)
    replacement.createNodeWithId(pageId, 'CANVAS', replacement.rootId, {
      height: 0,
      name: 'Page 1',
      width: 0
    })
    replacement.createNodeWithId(harness.node.id, 'RECTANGLE', pageId, {
      height: 50,
      width: 50,
      x: 10,
      y: 20
    })
    harness.store.replaceGraph(replacement)

    expect(harness.clock.timerCount).toBe(0)
    expect(replacement.getPresentedNodePosition(harness.node.id)).toEqual({ x: 10, y: 20 })
    expect(replacement.hasNodePositionPresentations()).toBe(false)

    harness.transport.receive(preview(harness.node.id, pageId, { sequence: 2, x: 999, y: 999 }))
    expect(replacement.getPresentedNodePosition(harness.node.id)).toEqual({ x: 10, y: 20 })
    expect(harness.clock.hasScheduledUpdate).toBe(false)
    harness.session.dispose()
  })

  test('tombstones a remote gesture when its node is reparented', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId
    const parent = harness.store.graph.createNode('FRAME', pageId, {
      height: 200,
      width: 200,
      x: 200,
      y: 100
    })

    harness.transport.receive(preview(harness.node.id, pageId))
    harness.clock.flush(24)
    harness.store.graph.reparentNode(harness.node.id, parent.id)

    expect(harness.store.graph.getAuthoritativeAbsolutePosition(harness.node.id)).toEqual({
      x: 10,
      y: 20
    })
    expect(harness.store.graph.hasNodePositionPresentations()).toBe(false)
    expect(harness.clock.timerCount).toBe(0)

    harness.transport.receive(preview(harness.node.id, pageId, { sequence: 2, x: 999, y: 999 }))
    harness.transport.receive(
      preview(harness.node.id, pageId, { phase: 'terminal', sequence: 3, x: 999, y: 999 })
    )
    expect(harness.store.graph.getPresentedNodePosition(harness.node.id)).toEqual({
      x: -190,
      y: -80
    })
    expect(harness.clock.hasScheduledUpdate).toBe(false)
    harness.session.dispose()
  })

  test('cancels a local gesture without a terminal when its node is reparented', () => {
    const harness = createHarness()
    const pageId = harness.store.state.currentPageId
    const parent = harness.store.graph.createNode('FRAME', pageId, {
      height: 200,
      width: 200,
      x: 200,
      y: 100
    })
    harness.store.select([harness.node.id])
    harness.store.graph.setNodePositionPresentation(harness.node.id, { x: 60, y: 70 })
    harness.clock.flush(0)

    harness.store.graph.reparentNode(harness.node.id, parent.id)

    expect(harness.transport.published.map((message) => message.phase)).toEqual([
      'active',
      'cancelled'
    ])
    expect(harness.store.graph.getAuthoritativeAbsolutePosition(harness.node.id)).toEqual({
      x: 10,
      y: 20
    })
    expect(harness.store.graph.hasNodePositionPresentations()).toBe(false)
    harness.session.dispose()
  })

  test('moves Code Object and connector presentation while preserving their records', () => {
    const store = createEditorStore()
    const source = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Current Dental Chart' }),
      height: 180,
      name: 'Current Dental Chart',
      width: 320,
      x: 10,
      y: 20
    })
    const target = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Current Copy' }),
      height: 180,
      name: 'Current Copy',
      width: 320,
      x: 610,
      y: 20
    })
    const connection = connectObjects(store, {
      kind: 'action',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')
    const transport = new FakeDragPreviewTransport()
    const clock = createUpdateClock()
    const session = createDragPreviewSession({
      cancelUpdate: clock.cancel,
      clearTimer: clock.clearTimer,
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      scheduleUpdate: clock.schedule,
      store,
      transport
    })
    const sourcePluginData = structuredClone(source.pluginData)
    const pagePluginData = structuredClone(
      store.graph.getNode(store.state.currentPageId)?.pluginData
    )
    const before = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    const beforeSource = before.nodes.find((node) => node.id === source.id)
    const beforeGeometry = resolveObjectGraphConnectionGeometry(
      store.graph,
      store.state.currentPageId,
      connection
    )

    transport.receive(preview(source.id, store.state.currentPageId, { x: 210, y: 120 }))
    clock.flush(48)

    const after = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    const afterSource = after.nodes.find((node) => node.id === source.id)
    const afterEdge = after.edges.find((edge) => edge.id === connection.id)
    const afterGeometry = resolveObjectGraphConnectionGeometry(
      store.graph,
      store.state.currentPageId,
      connection
    )
    expect(afterSource?.position).toEqual({
      x: (beforeSource?.position.x ?? 0) + 200,
      y: (beforeSource?.position.y ?? 0) + 100
    })
    expect(afterEdge?.id).toBe(connection.id)
    expect(afterGeometry.sourceAnchor.point).not.toEqual(beforeGeometry.sourceAnchor.point)
    expect(codeObjectCanvasStyle(store, source).transform).toContain('translate3d(210px, 120px')
    expect(store.graph.getNode(source.id)).toMatchObject({
      pluginData: sourcePluginData,
      x: 10,
      y: 20
    })
    expect(store.graph.getNode(store.state.currentPageId)?.pluginData).toEqual(pagePluginData)

    session.dispose()
  })
})
