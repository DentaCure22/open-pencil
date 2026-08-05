import { describe, expect, test } from 'bun:test'

import {
  OBJECT_GRAPH_SCHEMA_VERSION,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type SceneNode
} from '@open-pencil/scene-graph'

import { waitForConnectionVisualProof } from '@/app/automation/bridge/board-tools/connect-visual-proof'
import { createEditorStore, type EditorStore } from '@/app/editor/session'
import {
  connectObjects,
  objectGraphReactFlowSnapshot,
  reconcileObjectGraphEdges,
  resolveObjectGraphConnectionGeometry
} from '@/app/object-graph'

function rectangle(
  store: EditorStore,
  name: string,
  x: number,
  y: number,
  width = 240,
  height = 160
): SceneNode {
  return store.graph.createNode('RECTANGLE', store.state.currentPageId, {
    height,
    name,
    width,
    x,
    y
  })
}

function restoreGlobalProperty(
  name: 'cancelAnimationFrame' | 'document' | 'requestAnimationFrame',
  descriptor: PropertyDescriptor | undefined
): void {
  if (descriptor) Object.defineProperty(globalThis, name, descriptor)
  else Reflect.deleteProperty(globalThis, name)
}

describe('React Flow connector projection', () => {
  test('uses the built-in Bezier route and ignores unrelated Board objects', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Source', 80, 120)
    const blocker = rectangle(store, 'Blocker', 430, 100, 180, 200)
    const target = rectangle(store, 'Target', 800, 120)
    const connection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')
    store.undo.clear()

    const initialEdges = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId).edges
    const initialGeometry = resolveObjectGraphConnectionGeometry(
      store.graph,
      store.state.currentPageId,
      connection
    )
    expect(initialGeometry.geometry.path).toContain('C')

    store.updateNodeWithUndo(blocker.id, { y: 500 }, 'Move unrelated object')
    const movedEdges = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId).edges
    const movedGeometry = resolveObjectGraphConnectionGeometry(
      store.graph,
      store.state.currentPageId,
      connection
    )
    expect(movedGeometry).toEqual(initialGeometry)
    expect(reconcileObjectGraphEdges(initialEdges, movedEdges)).toBe(initialEdges)

    expect(store.undo.undo()).toBe('Move unrelated object')
    expect(
      resolveObjectGraphConnectionGeometry(store.graph, store.state.currentPageId, connection)
    ).toEqual(initialGeometry)
  })

  test('keeps missing-edge proof bounded against the built-in Bezier path', async () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Source', 80, 120)
    const target = rectangle(store, 'Target', 800, 120)
    const connection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')
    const expected = resolveObjectGraphConnectionGeometry(
      store.graph,
      store.state.currentPageId,
      connection
    )

    const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
    const requestFrameDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'requestAnimationFrame'
    )
    const cancelFrameDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'cancelAnimationFrame'
    )
    let cancelledFrames = 0
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: {},
        defaultView: { getComputedStyle: () => ({}) },
        querySelectorAll: () => [],
        visibilityState: 'visible'
      }
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: () => 1
    })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: () => {
        cancelledFrames += 1
      }
    })

    try {
      const startedAt = performance.now()
      const proof = await waitForConnectionVisualProof(
        store.graph,
        store.state.currentPageId,
        connection
      )
      const elapsed = performance.now() - startedAt
      expect(proof).toMatchObject({
        expected_path: expected.geometry.path,
        reasons: ['edge_not_mounted'],
        source_anchor: expected.sourceAnchor,
        status: 'missing',
        target_anchor: expected.targetAnchor
      })
      expect(cancelledFrames).toBe(2)
      expect(elapsed).toBeLessThan(150)
    } finally {
      restoreGlobalProperty('document', documentDescriptor)
      restoreGlobalProperty('requestAnimationFrame', requestFrameDescriptor)
      restoreGlobalProperty('cancelAnimationFrame', cancelFrameDescriptor)
    }
  })

  test('projects 1,000 visible objects and 100 connections in one bounded snapshot', () => {
    const store = createEditorStore()
    const nodes: SceneNode[] = []
    for (let index = 0; index < 1_000; index += 1) {
      const column = index % 40
      const row = Math.floor(index / 40)
      nodes.push(rectangle(store, `Node ${index}`, column * 140, row * 100, 80, 48))
    }
    const connections: ObjectGraphConnection[] = Array.from({ length: 100 }, (_, index) => ({
      automatic: true,
      id: `benchmark-connection-${index}`,
      kind: 'visual',
      label: `Flow ${index}`,
      permissions: [],
      schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
      sourceNodeId: nodes[index].id,
      sourcePort: 'auto',
      targetNodeId: nodes[999 - index].id,
      targetPort: 'auto'
    }))
    setObjectGraphConnectionsOnPage(store.graph, store.state.currentPageId, connections)

    const startedAt = performance.now()
    const snapshot = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    const elapsed = performance.now() - startedAt

    expect(snapshot.nodes).toHaveLength(1_000)
    expect(snapshot.edges).toHaveLength(100)
    expect(elapsed).toBeLessThan(1_000)
  })
})
