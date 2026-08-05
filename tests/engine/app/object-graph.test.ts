import { describe, expect, test } from 'bun:test'

import { deserializeSceneGraph, serializeSceneGraph } from '@open-pencil/core/kiwi'
import {
  objectGraphConnectionById,
  objectGraphConnectionPluginData,
  objectGraphConnectionsOnPage,
  readObjectGraphInputs,
  setObjectGraphPorts,
  setObjectGraphConnectionsOnPage
} from '@open-pencil/scene-graph'

import {
  createCodeObject,
  createCodeObjectBoardClient,
  createUserCodeObjectDocument,
  dispatchCodeObjectBoardAction
} from '@/app/code-object/model'
import { createEditorStore, type EditorStore } from '@/app/editor/session'
import {
  connectObjects,
  emitObjectGraphSignal,
  objectGraphConnectionName,
  objectGraphReactFlowSnapshot,
  normalizeObjectGraphConnectionRecords,
  reconcileObjectGraphEdges,
  reconcileObjectGraphNodes,
  reconnectObjects,
  resolveObjectGraphConnectionGeometry
} from '@/app/object-graph'

function rectangle(store: EditorStore, name: string, x: number, y: number) {
  const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
    height: 160,
    name,
    width: 240,
    x,
    y
  })
  return node
}

describe('object graph', () => {
  test('persists a typed connection record and projects the real React Flow model', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Controller', 100, 160)
    const target = rectangle(store, 'Report', 720, 280)
    const connection = connectObjects(store, {
      kind: 'data',
      label: 'Approved result',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')

    expect(store.graph.getNode(connection.id)).toBeUndefined()
    expect(
      objectGraphConnectionById(store.graph, store.state.currentPageId, connection.id)
    ).toEqual(connection)
    const controlled = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId, {
      selectedIds: new Set([source.id, connection.id])
    })
    expect(controlled.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([source.id, target.id])
    )
    expect(controlled.nodes.find((node) => node.id === source.id)).toMatchObject({
      data: {
        name: 'Controller',
        ports: {
          bottom: { position: 'bottom', x: 120, y: 160 },
          left: { position: 'left', x: 0, y: 80 },
          right: { position: 'right', x: 240, y: 80 },
          top: { position: 'top', x: 120, y: 0 }
        },
        showHandles: true
      },
      draggable: false,
      selectable: false,
      selected: true,
      type: 'openpencil-object'
    })
    expect(controlled.edges).toContainEqual(
      expect.objectContaining({
        id: connection.id,
        selected: true,
        source: source.id,
        target: target.id,
        type: 'openpencil-connection'
      })
    )

    store.graph.updateNode(target.id, { name: 'Renamed report' })
    expect(objectGraphConnectionName(store.graph, connection)).toBe(
      'Data: Controller → Renamed report'
    )

    const reloaded = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    expect(objectGraphConnectionById(reloaded, store.state.currentPageId, connection.id)).toEqual(
      connection
    )
    expect(reloaded.getNode(connection.id)).toBeUndefined()
    const reloadedSnapshot = objectGraphReactFlowSnapshot(reloaded, store.state.currentPageId)
    const reloadedEdge = reloadedSnapshot.edges.find((edge) => edge.id === connection.id)
    const reloadedTarget = reloadedSnapshot.nodes.find((node) => node.id === target.id)
    expect(reloadedEdge?.targetHandle).toBe('port:left')
    expect(reloadedTarget?.data.ports.left).toMatchObject({ handleId: 'port:left' })
  })

  test('binds an edge to exact named React Flow handles', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Source', 100, 120)
    const target = rectangle(store, 'Target', 720, 120)
    setObjectGraphPorts(store.graph, source.id, [
      {
        direction: 'output',
        id: 'record/status',
        kinds: ['data'],
        label: 'Status',
        offset: 0.7,
        side: 'right'
      }
    ])
    setObjectGraphPorts(store.graph, target.id, [
      {
        direction: 'input',
        id: 'status',
        kinds: ['data'],
        label: 'Status input',
        offset: 0.3,
        side: 'left'
      }
    ])
    const connection = connectObjects(store, {
      kind: 'data',
      sourceNodeId: source.id,
      sourcePortId: 'record/status',
      targetNodeId: target.id,
      targetPortId: 'status'
    })
    if (!connection) throw new Error('Named-port connection was not created')

    const snapshot = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    const sourceNode = snapshot.nodes.find(({ id }) => id === source.id)
    const edge = snapshot.edges.find(({ id }) => id === connection.id)
    expect(sourceNode?.data.ports['named:record/status']).toMatchObject({
      direction: 'output',
      handleId: 'named-port:record%2Fstatus',
      label: 'Status',
      legacy: false,
      x: 240,
      y: 112
    })
    expect(edge).toMatchObject({
      sourceHandle: 'named-port:record%2Fstatus',
      targetHandle: 'named-port:status'
    })
  })

  test('projects rotated ports into React Flow Bezier geometry from SceneGraph world transforms', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Rotated source', 100, 120)
    const target = rectangle(store, 'Target', 720, 120)
    store.graph.updateNode(source.id, { rotation: 90 })
    const connection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')

    const snapshot = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    const sourceProjection = snapshot.nodes.find((node) => node.id === source.id)
    const edge = snapshot.edges.find((candidate) => candidate.id === connection.id)
    if (!sourceProjection || !edge) throw new Error('Rotated projection was not created')
    const resolved = resolveObjectGraphConnectionGeometry(
      store.graph,
      store.state.currentPageId,
      connection
    )

    expect(edge.sourceHandle).toBe('port:top')
    expect(sourceProjection.data.ports.top.position).toBe('right')
    expect(resolved.sourceAnchor.normal.x).toBeCloseTo(1)
    expect(resolved.sourceAnchor.normal.y).toBeCloseTo(0)
    expect(resolved.sourceAnchor.point).toEqual({
      x: sourceProjection.position.x + sourceProjection.data.ports.top.x,
      y: sourceProjection.position.y + sourceProjection.data.ports.top.y
    })
    expect(resolved.geometry.path).toContain('C')
  })

  test('projects every ordinary object without an activation step', () => {
    const store = createEditorStore()
    const first = rectangle(store, 'First', 100, 120)
    const ordinary = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 500,
      name: 'Ordinary object',
      width: 800,
      x: 640,
      y: 120
    })

    const initial = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    expect(initial.nodes.map((node) => node.id)).toEqual([first.id, ordinary.id])
    expect(initial.nodes[0]).toMatchObject({ height: 160, width: 240 })
    expect(initial.nodes[1]).toMatchObject({ height: 500, width: 800 })
  })

  test('does not project ghost edges for hidden, transparent, or fully clipped endpoints', () => {
    const store = createEditorStore()
    const parent = store.graph.createNode('FRAME', store.state.currentPageId, {
      clipsContent: true,
      height: 240,
      name: 'Clipping parent',
      width: 240,
      x: 100,
      y: 100
    })
    const source = store.graph.createNode('RECTANGLE', parent.id, {
      height: 80,
      name: 'Nested source',
      width: 100,
      x: 20,
      y: 40
    })
    const target = rectangle(store, 'Visible target', 720, 120)
    const connection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')

    expect(
      objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId).edges.map(
        (edge) => edge.id
      )
    ).toEqual([connection.id])

    store.updateNodeWithUndo(parent.id, { visible: false }, 'Hide connected parent')
    const hidden = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    expect(hidden.nodes.map((node) => node.id)).toEqual([target.id])
    expect(hidden.edges).toEqual([])
    expect(objectGraphConnectionsOnPage(store.graph, store.state.currentPageId)).toHaveLength(1)
    expect(store.undo.undo()).toBe('Hide connected parent')
    expect(
      objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId).edges.map(
        (edge) => edge.id
      )
    ).toEqual([connection.id])

    store.graph.updateNode(source.id, { x: 260 })
    const clipped = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    expect(clipped.nodes.map((node) => node.id)).not.toContain(source.id)
    expect(clipped.edges).toEqual([])
    expect(objectGraphConnectionsOnPage(store.graph, store.state.currentPageId)).toHaveLength(1)

    store.graph.updateNode(source.id, { opacity: 0, x: 20 })
    const transparent = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    expect(transparent.nodes.map((node) => node.id)).not.toContain(source.id)
    expect(transparent.edges).toEqual([])
  })

  test('keeps the controlled React Flow projection attached through movement, reconnect, and Undo', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Source', 80, 120)
    const target = rectangle(store, 'Target', 640, 120)
    const alternate = rectangle(store, 'Alternate', 640, 520)
    const connection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')
    const initial = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    const initialTarget = initial.nodes.find((node) => node.id === target.id)
    const initialEdge = initial.edges.find((edge) => edge.id === connection.id)
    if (!initialTarget || !initialEdge) throw new Error('React Flow projection was not created')
    const unchanged = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    expect(reconcileObjectGraphNodes(initial.nodes, unchanged.nodes)).toBe(initial.nodes)
    expect(reconcileObjectGraphEdges(initial.edges, unchanged.edges)).toBe(initial.edges)
    store.undo.clear()

    store.updateNodeWithUndo(target.id, { rotation: 12, x: 900, y: 380 }, 'Move target')
    const moved = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    const reconciledNodes = reconcileObjectGraphNodes(initial.nodes, moved.nodes)
    expect(reconciledNodes.find((node) => node.id === source.id)).toBe(
      initial.nodes.find((node) => node.id === source.id)
    )
    expect(reconciledNodes.find((node) => node.id === target.id)).not.toBe(initialTarget)
    expect(moved.nodes.find((node) => node.id === target.id)?.position).not.toEqual(
      initialTarget.position
    )
    expect(moved.edges.find((edge) => edge.id === connection.id)?.targetHandle).not.toBeUndefined()

    store.undo.undo()
    expect(store.graph.getNode(target.id)).toMatchObject({ rotation: 0, x: 640, y: 120 })
    expect(
      objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId).nodes.find(
        (node) => node.id === target.id
      )?.position
    ).toEqual(initialTarget.position)

    expect(
      reconnectObjects(store, connection.id, {
        sourceNodeId: source.id,
        sourcePort: 'bottom',
        targetNodeId: alternate.id,
        targetPort: 'top'
      })
    ).toBe(true)
    expect(
      objectGraphConnectionById(store.graph, store.state.currentPageId, connection.id)
    ).toMatchObject({
      sourcePort: 'bottom',
      targetNodeId: alternate.id,
      targetPort: 'top'
    })
    store.undo.undo()
    expect(
      objectGraphConnectionById(store.graph, store.state.currentPageId, connection.id)
    ).toMatchObject({
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
  })

  test('migrates the old native connector adaptation into one React Flow record', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Source', 80, 120)
    const target = rectangle(store, 'Target', 640, 120)
    const connection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')
    setObjectGraphConnectionsOnPage(store.graph, store.state.currentPageId, [])
    store.objectGraph.dispose()
    const legacyRoot = store.graph.createNodeWithId(
      connection.id,
      'GROUP',
      store.state.currentPageId,
      {
        height: 300,
        name: 'Legacy adapted connection',
        pluginData: objectGraphConnectionPluginData({ pluginData: [] }, connection),
        width: 500,
        x: 100,
        y: 100
      }
    )
    const legacyPath = store.graph.createNode('VECTOR', legacyRoot.id, {
      height: 300,
      name: 'Legacy adapted path',
      width: 500
    })
    store.objectGraph.synchronizeAll()

    expect(store.graph.getNode(legacyPath.id)).toBeUndefined()
    expect(store.graph.getNode(connection.id)).toBeUndefined()
    expect(
      objectGraphConnectionById(store.graph, store.state.currentPageId, connection.id)
    ).toEqual(connection)
  })

  test('publishes committed and preview geometry through one coordinator subscription', () => {
    const store = createEditorStore()
    const node = rectangle(store, 'Observed', 100, 120)
    let revisions = 0
    const unsubscribe = store.objectGraph.subscribe(() => {
      revisions += 1
    })

    const initial = objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId)
    store.graph.updateNodePositionPreview(node.id, 180, 220)
    expect(revisions).toBeGreaterThan(0)
    expect(
      objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId).nodes.find(
        (candidate) => candidate.id === node.id
      )?.position
    ).not.toEqual(initial.nodes[0]?.position)

    const afterPreview = revisions
    store.graph.updateNodePreview(node.id, { height: 240, width: 360 })
    expect(revisions).toBeGreaterThan(afterPreview)
    expect(
      objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId).nodes.find(
        (candidate) => candidate.id === node.id
      )
    ).toMatchObject({ height: 240, width: 360 })
    const resizedProjection = objectGraphReactFlowSnapshot(
      store.graph,
      store.state.currentPageId
    ).nodes.find((candidate) => candidate.id === node.id)
    expect(resizedProjection?.data.ports.right).toMatchObject({ x: 360, y: 120 })

    const afterResize = revisions
    store.graph.updateNode(node.id, { x: 240 })
    expect(revisions).toBeGreaterThan(afterResize)

    const afterCommit = revisions
    store.setHoveredNode(node.id)
    expect(revisions).toBeGreaterThan(afterCommit)
    expect(
      objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId, {
        hoveredNodeId: store.state.hoveredNodeId
      }).nodes.find((candidate) => candidate.id === node.id)?.data.showHandles
    ).toBe(true)

    const beforeUnsubscribe = revisions
    unsubscribe()
    store.graph.updateNode(node.id, { x: 240 })
    expect(revisions).toBe(beforeUnsubscribe)
  })

  test('delivers automatic action and data signals through one board-owned history', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Control', 100, 120)
    const actionTarget = rectangle(store, 'Action target', 620, 120)
    const dataTarget = rectangle(store, 'Data target', 620, 420)
    const actionConnection = connectObjects(store, {
      kind: 'action',
      sourceNodeId: source.id,
      targetNodeId: actionTarget.id
    })
    const dataConnection = connectObjects(store, {
      kind: 'data',
      sourceNodeId: source.id,
      targetNodeId: dataTarget.id
    })
    if (!actionConnection || !dataConnection) throw new Error('Connections were not created')
    store.undo.clear()

    const actionReceipt = emitObjectGraphSignal(store, source.id, {
      action: { type: 'toggle-opacity' },
      kind: 'action'
    })
    expect(actionReceipt).toMatchObject({ changed: true })
    expect(actionTarget.opacity).toBe(0.4)
    store.undo.undo()
    expect(actionTarget.opacity).toBe(1)

    const dataReceipt = emitObjectGraphSignal(store, source.id, {
      kind: 'data',
      value: { approved: true, score: 94 }
    })
    expect(dataReceipt).toMatchObject({ changed: true })
    expect(readObjectGraphInputs(dataTarget)).toEqual([
      {
        connectionId: dataConnection.id,
        sourceNodeId: source.id,
        value: { approved: true, score: 94 }
      }
    ])
    const reloaded = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    expect(readObjectGraphInputs(reloaded.getNode(dataTarget.id))).toHaveLength(1)
    store.undo.undo()
    expect(readObjectGraphInputs(dataTarget)).toEqual([])
  })

  test('lets a Code Object use the parent API without gaining another board runtime', async () => {
    const store = createEditorStore()
    const controller = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Graph controller' }),
      height: 320,
      name: 'Graph controller',
      width: 480,
      x: 80,
      y: 100
    })
    const target = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Graph target' }),
      height: 320,
      name: 'Graph target',
      width: 480,
      x: 720,
      y: 100
    })
    const actionConnection = connectObjects(store, {
      kind: 'action',
      sourceNodeId: controller.id,
      targetNodeId: target.id
    })
    const dataConnection = connectObjects(store, {
      kind: 'data',
      sourceNodeId: controller.id,
      targetNodeId: target.id
    })
    if (!actionConnection || !dataConnection) throw new Error('Connections were not created')
    store.undo.clear()

    const denied = dispatchCodeObjectBoardAction(
      store,
      controller.id,
      {
        signal: { action: { type: 'toggle-opacity' }, kind: 'action' },
        type: 'code-object.graph.emit'
      },
      { interactionEnabled: false }
    )
    expect(denied).toMatchObject({
      changed: false,
      reason: 'interaction-required',
      status: 'denied'
    })
    const applied = dispatchCodeObjectBoardAction(
      store,
      controller.id,
      {
        signal: { action: { type: 'toggle-opacity' }, kind: 'action' },
        type: 'code-object.graph.emit'
      },
      { interactionEnabled: true }
    )
    expect(applied).toMatchObject({
      changed: true,
      status: 'applied',
      targetNodeIds: [target.id],
      type: 'code-object.graph.emit'
    })
    expect(target.opacity).toBe(0.4)

    const dispatch = async (action: Parameters<typeof dispatchCodeObjectBoardAction>[2]) =>
      dispatchCodeObjectBoardAction(store, controller.id, action, {
        interactionEnabled: true
      })
    const controllerClient = createCodeObjectBoardClient(store, controller.id, dispatch)
    expect(controllerClient.apiVersion).toBe(3)
    await controllerClient.emitGraphSignal({
      kind: 'data',
      value: { status: 'approved' }
    })
    const targetClient = createCodeObjectBoardClient(store, target.id, dispatch)
    expect(targetClient.inputs).toEqual([
      {
        connectionId: dataConnection.id,
        sourceNodeId: controller.id,
        value: { status: 'approved' }
      }
    ])
  })

  test('cleans up an endpoint and its connection in one undoable delete', () => {
    const store = createEditorStore()
    const container = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 300,
      name: 'Source container',
      width: 380,
      x: 80,
      y: 100
    })
    const source = store.graph.createNode('RECTANGLE', container.id, {
      height: 160,
      name: 'Source',
      width: 240,
      x: 20,
      y: 20
    })
    const target = rectangle(store, 'Target', 620, 120)
    const connection = connectObjects(store, {
      kind: 'action',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')
    store.undo.clear()

    store.select([container.id])
    store.deleteSelected()
    expect(store.graph.getNode(container.id)).toBeUndefined()
    expect(store.graph.getNode(source.id)).toBeUndefined()
    expect(
      objectGraphConnectionById(store.graph, store.state.currentPageId, connection.id)
    ).toBeNull()
    expect(store.graph.getNode(target.id)).toBeDefined()

    store.undo.undo()
    expect(store.graph.getNode(container.id)).toBeDefined()
    expect(store.graph.getNode(source.id)).toBeDefined()
    expect(
      objectGraphConnectionById(store.graph, store.state.currentPageId, connection.id)
    ).toEqual(connection)
    expect(
      objectGraphConnectionsOnPage(store.graph, store.state.currentPageId).map(
        (record) => record.id
      )
    ).toEqual([connection.id])
  })

  test('hides and purges persisted orphan connections after endpoint deletion', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Source', 100, 120)
    const target = rectangle(store, 'Target', 620, 120)
    const connection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')

    store.objectGraph.dispose()
    store.graph.deleteNode(source.id)
    setObjectGraphConnectionsOnPage(store.graph, store.state.currentPageId, [connection])

    expect(objectGraphReactFlowSnapshot(store.graph, store.state.currentPageId).edges).toEqual([])
    expect(normalizeObjectGraphConnectionRecords(store.graph, store.state.currentPageId)).toBe(true)
    expect(objectGraphConnectionsOnPage(store.graph, store.state.currentPageId)).toEqual([])
  })

  test('deletes a selected page-owned connection through normal board history', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Source', 100, 120)
    const target = rectangle(store, 'Target', 620, 120)
    const connection = connectObjects(store, {
      kind: 'action',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')
    store.undo.clear()

    store.select([connection.id])
    store.deleteSelected()
    expect(store.graph.getNode(connection.id)).toBeUndefined()
    expect(
      objectGraphConnectionById(store.graph, store.state.currentPageId, connection.id)
    ).toBeNull()

    store.undo.undo()
    expect(
      objectGraphConnectionById(store.graph, store.state.currentPageId, connection.id)
    ).toEqual(connection)
    expect([...store.state.selectedIds]).toEqual([connection.id])
  })

  test('duplicates endpoints independently without copying external connections', () => {
    const store = createEditorStore()
    const source = rectangle(store, 'Source', 100, 120)
    const target = rectangle(store, 'Target', 620, 120)
    const connection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!connection) throw new Error('Connection was not created')

    store.select([target.id])
    store.duplicateSelected()
    const duplicateId = [...store.state.selectedIds][0]
    expect(duplicateId).toBeDefined()
    expect(duplicateId).not.toBe(target.id)
    expect(
      objectGraphConnectionsOnPage(store.graph, store.state.currentPageId).map(
        (record) => record.id
      )
    ).toEqual([connection.id])

    store.select([source.id, target.id, connection.id])
    store.duplicateSelected()
    expect(store.state.selectedIds.size).toBe(2)
    expect(
      objectGraphConnectionsOnPage(store.graph, store.state.currentPageId).map(
        (record) => record.id
      )
    ).toEqual([connection.id])
  })
})
