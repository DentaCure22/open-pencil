import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import {
  narratedTraceAnchorForCanvasPoint,
  narratedTraceAnchorForScreenPoints,
  resolveNarratedTraceSceneTargets
} from '@/app/narrated-trace'

function coordinateStore() {
  return {
    screenToCanvas: (x: number, y: number) => ({ x: (x - 40) / 2, y: (y - 20) / 2 }),
    state: { panX: 40, panY: 20, zoom: 2 }
  }
}

describe('Narrated Trace spatial coordinates', () => {
  test('converts a Focus gesture to page space and preserves target-relative intent', () => {
    const anchor = narratedTraceAnchorForScreenPoints(
      coordinateStore(),
      [
        { x: 100, y: 80 },
        { x: 180, y: 160 }
      ],
      { height: 200, width: 200, x: 80, y: 60 }
    )

    expect(anchor).toEqual({
      pagePoint: { x: 50, y: 50 },
      pageRegion: { height: 40, width: 40, x: 30, y: 30 },
      targetRelativePoint: { x: 0.3, y: 0.3 },
      viewport: { panX: 40, panY: 20, zoom: 2 }
    })
  })

  test('keeps an exact canvas click centered in a bounded page region', () => {
    const anchor = narratedTraceAnchorForCanvasPoint(
      coordinateStore(),
      { x: 75, y: 50 },
      { height: 100, width: 100, x: 50, y: 25 }
    )

    expect(anchor).toEqual({
      pagePoint: { x: 75, y: 50 },
      pageRegion: { height: 0.5, width: 0.5, x: 74.75, y: 49.75 },
      targetRelativePoint: { x: 0.25, y: 0.25 },
      viewport: { panX: 40, panY: 20, zoom: 2 }
    })
  })

  test('captures every native object intersecting a traced region while keeping one primary target', () => {
    const store = createEditorStore()
    store.setViewport({ panX: 0, panY: 0, zoom: 1 })
    const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 300,
      name: 'Patient card',
      width: 300,
      x: 100,
      y: 100
    })
    const header = store.graph.createNode('RECTANGLE', frame.id, {
      height: 50,
      name: 'Header',
      width: 100,
      x: 50,
      y: 50
    })

    const result = resolveNarratedTraceSceneTargets(store, {
      height: 50,
      width: 100,
      x: 150,
      y: 150
    })

    expect(result.target?.stableId).toBe(header.id)
    expect(result.candidates.map((candidate) => candidate.stableId)).toEqual([header.id, frame.id])
    expect(result.candidates).toMatchObject([
      { relation: 'contained', stableId: header.id },
      { relation: 'contains-region', stableId: frame.id }
    ])
  })
})
