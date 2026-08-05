import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import {
  createNarratedTraceCanvasInk,
  narratedTraceCanvasInkNodes,
  narratedTraceCanvasInkProjections
} from '@/app/narrated-trace'

describe('Narrated Trace canvas ink', () => {
  test('projects a cached ink-node collection without scanning unrelated nodes', () => {
    const store = createEditorStore()
    store.setViewport({ panX: 30, panY: 20, zoom: 2 })
    store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 100,
      name: 'Unrelated shape',
      width: 100,
      x: 400,
      y: 300
    })
    const ink = createNarratedTraceCanvasInk(store, {
      color: '#f43f5e',
      points: [
        { x: 50, y: 60 },
        { x: 90, y: 100 }
      ],
      strokeWidth: 4
    })
    expect(ink).not.toBeNull()

    const nodes = narratedTraceCanvasInkNodes(store)
    const projections = narratedTraceCanvasInkProjections(
      store,
      { panX: 30, panY: 20, revision: 1, zoom: 2 },
      nodes
    )

    expect(nodes.map((node) => node.id)).toEqual([ink?.node.id])
    expect(projections).toHaveLength(1)
    expect(projections[0]).toMatchObject({ id: ink?.node.id, strokeWidth: 4 })
  })
})
