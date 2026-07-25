import { describe, expect, test } from 'bun:test'

import {
  narratedTraceAnchorForCanvasPoint,
  narratedTraceAnchorForScreenPoints
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
})
