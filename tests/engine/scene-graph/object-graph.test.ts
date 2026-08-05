import { describe, expect, test } from 'bun:test'

import {
  canAddObjectGraphConnection,
  OBJECT_GRAPH_SCHEMA_VERSION,
  objectGraphConnectionsOnPage,
  projectObjectGraphNode,
  readObjectGraphPorts,
  resolveObjectGraphPorts,
  resolveObjectGraphPortSides,
  SceneGraph,
  setObjectGraphPorts,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection
} from '@open-pencil/scene-graph'

function rectangle(
  graph: SceneGraph,
  parentId: string,
  name: string,
  x: number,
  y: number,
  rotation = 0
) {
  return graph.createNode('RECTANGLE', parentId, {
    height: 160,
    name,
    rotation,
    width: 240,
    x,
    y
  })
}

function visualConnection(
  id: string,
  sourceNodeId: string,
  targetNodeId: string
): ObjectGraphConnection {
  return {
    automatic: false,
    id,
    kind: 'visual',
    label: 'Visual',
    permissions: [],
    schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
    sourceNodeId,
    sourcePort: 'auto',
    targetNodeId,
    targetPort: 'auto'
  }
}

describe('SceneGraph Object Graph connection intent', () => {
  test('resolves rotated automatic ports without React Flow', () => {
    const graph = new SceneGraph()
    const page = graph.addPage('Page')
    const source = rectangle(graph, page.id, 'Rotated source', 100, 120, 90)
    const target = rectangle(graph, page.id, 'Target', 720, 120)

    expect(
      resolveObjectGraphPortSides(graph, visualConnection('connection:ports', source.id, target.id))
    ).toEqual({ source: 'top', target: 'left' })
  })

  test('validates exact page endpoints and resolved duplicate intent', () => {
    const graph = new SceneGraph()
    const page = graph.addPage('Page')
    const otherPage = graph.addPage('Other page')
    const source = rectangle(graph, page.id, 'Rotated source', 100, 120, 90)
    const target = rectangle(graph, page.id, 'Target', 720, 120)
    const otherPageTarget = rectangle(graph, otherPage.id, 'Other target', 720, 120)
    const existing = visualConnection('connection:existing', source.id, target.id)

    expect(canAddObjectGraphConnection(graph, page.id, existing)).toBe(true)
    setObjectGraphConnectionsOnPage(graph, page.id, [existing])
    expect(objectGraphConnectionsOnPage(graph, page.id)).toEqual([existing])
    expect(canAddObjectGraphConnection(graph, page.id, existing)).toBe(false)
    expect(canAddObjectGraphConnection(graph, page.id, existing, existing.id)).toBe(true)
    expect(
      canAddObjectGraphConnection(graph, page.id, {
        ...existing,
        sourcePort: 'top',
        targetPort: 'left'
      })
    ).toBe(false)
    expect(
      canAddObjectGraphConnection(graph, page.id, {
        ...existing,
        kind: 'data'
      })
    ).toBe(true)
    expect(
      canAddObjectGraphConnection(graph, page.id, {
        ...existing,
        targetNodeId: source.id
      })
    ).toBe(false)
    expect(
      canAddObjectGraphConnection(graph, page.id, {
        ...existing,
        targetNodeId: otherPageTarget.id
      })
    ).toBe(false)
  })

  test('rejects endpoints nested below internal-only structures', () => {
    const graph = new SceneGraph()
    const page = graph.addPage('Page')
    const internal = graph.createNode('FRAME', page.id, {
      height: 240,
      internalOnly: true,
      name: 'Internal projection',
      width: 320,
      x: 80,
      y: 80
    })
    const source = rectangle(graph, internal.id, 'Nested source', 20, 20)
    const target = rectangle(graph, page.id, 'Target', 720, 120)

    expect(
      canAddObjectGraphConnection(
        graph,
        page.id,
        visualConnection('connection:internal', source.id, target.id)
      )
    ).toBe(false)
  })

  test('persists, projects, and validates exact named ports', () => {
    const graph = new SceneGraph()
    const page = graph.addPage('Page')
    const source = rectangle(graph, page.id, 'Products', 100, 120)
    const target = rectangle(graph, page.id, 'Warehouses', 720, 120)
    expect(
      setObjectGraphPorts(graph, source.id, [
        {
          direction: 'output',
          id: 'warehouse_id',
          kinds: ['data'],
          label: 'warehouse_id',
          offset: 0.75,
          side: 'right'
        }
      ])
    ).toBe(true)
    expect(
      setObjectGraphPorts(graph, target.id, [
        {
          direction: 'input',
          id: 'id',
          kinds: ['data'],
          label: 'id',
          offset: 0.25,
          side: 'left'
        }
      ])
    ).toBe(true)

    const connection: ObjectGraphConnection = {
      automatic: false,
      id: 'connection:named-ports',
      kind: 'data',
      label: 'Products warehouse',
      permissions: ['target.data.write'],
      schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
      sourceNodeId: source.id,
      sourcePort: 'auto',
      sourcePortId: 'warehouse_id',
      targetNodeId: target.id,
      targetPort: 'auto',
      targetPortId: 'id'
    }

    expect(readObjectGraphPorts(source)).toHaveLength(1)
    expect(projectObjectGraphNode(source, graph).namedPorts.warehouse_id?.point).toEqual({
      x: 340,
      y: 240
    })
    expect(
      projectObjectGraphNode(source, graph, {
        warehouse_id: { x: 220, y: 44 }
      }).namedPorts.warehouse_id?.point
    ).toEqual({ x: 340, y: 164 })
    expect(resolveObjectGraphPorts(graph, connection)).toMatchObject({
      source: { id: 'warehouse_id', side: 'right' },
      target: { id: 'id', side: 'left' }
    })
    expect(canAddObjectGraphConnection(graph, page.id, connection)).toBe(true)
    expect(
      canAddObjectGraphConnection(graph, page.id, {
        ...connection,
        kind: 'action'
      })
    ).toBe(false)
    expect(
      canAddObjectGraphConnection(graph, page.id, {
        ...connection,
        sourceNodeId: target.id,
        sourcePortId: 'id',
        targetNodeId: source.id,
        targetPortId: 'warehouse_id'
      })
    ).toBe(false)
  })
})
