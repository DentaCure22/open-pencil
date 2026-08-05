import { describe, expect, test } from 'bun:test'

import { serializeSceneGraph } from '@open-pencil/core/kiwi'
import { SceneGraph } from '@open-pencil/scene-graph'

describe('SceneGraph presentation positions', () => {
  test('projects geometry without changing the durable node snapshot', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      height: 80,
      width: 100,
      x: 10,
      y: 20
    })
    const child = graph.createNode('RECTANGLE', frame.id, {
      height: 10,
      width: 10,
      x: 5,
      y: 7
    })
    const events: Array<{ id: string; x?: number; y?: number }> = []
    const unbind = graph.onNodeEvents({
      previewUpdated: (id, changes) => events.push({ id, x: changes.x, y: changes.y })
    })

    graph.setNodePositionPresentation(frame.id, { x: 110, y: 220 })

    expect(graph.getNode(frame.id)).toMatchObject({ x: 10, y: 20 })
    expect(graph.getPresentedNodePosition(frame.id)).toEqual({ x: 110, y: 220 })
    expect(graph.getAbsolutePosition(child.id)).toEqual({ x: 115, y: 227 })
    expect(serializeSceneGraph(graph).nodes.find(([id]) => id === frame.id)?.[1]).toMatchObject({
      x: 10,
      y: 20
    })

    graph.reparentNode(child.id, page.id)
    expect(graph.getNode(child.id)).toMatchObject({ parentId: page.id, x: 15, y: 27 })

    graph.clearNodePositionPresentation(frame.id)

    expect(graph.getAbsolutePosition(child.id)).toEqual({ x: 15, y: 27 })
    expect(events).toEqual([
      { id: frame.id, x: 110, y: 220 },
      { id: frame.id, x: 10, y: 20 }
    ])
    unbind()
  })
})
