import { describe, expect, test } from 'bun:test'

import { getContainerLabelPlacement } from '@/components/smylr-live-container-overlay/label-placement'

const VIEWPORT = { height: 800, width: 1200 }

describe('Smylr live container label placement', () => {
  test('keeps labels above and left-aligned when there is room', () => {
    expect(
      getContainerLabelPlacement({ height: 120, width: 240, x: 100, y: 100 }, VIEWPORT, 1)
    ).toEqual({ horizontal: 'left', maxWidth: 360, vertical: 'above' })
  })

  test('moves labels below containers at the top edge', () => {
    expect(
      getContainerLabelPlacement({ height: 120, width: 240, x: 100, y: 4 }, VIEWPORT, 1).vertical
    ).toBe('below')
  })

  test('moves labels inside containers that fill the viewport', () => {
    expect(
      getContainerLabelPlacement({ height: 800, width: 1200, x: 0, y: 0 }, VIEWPORT, 1).vertical
    ).toBe('inside-top')
  })

  test('right-aligns labels near the viewport edge and preserves a readable width', () => {
    expect(
      getContainerLabelPlacement({ height: 120, width: 100, x: 1080, y: 100 }, VIEWPORT, 1)
    ).toEqual({ horizontal: 'right', maxWidth: 360, vertical: 'above' })
  })

  test('limits long labels to the visible room at the current zoom', () => {
    expect(
      getContainerLabelPlacement(
        { height: 120, width: 80, x: 20, y: 100 },
        { ...VIEWPORT, width: 220 },
        1
      ).maxWidth
    ).toBe(192)
  })
})
