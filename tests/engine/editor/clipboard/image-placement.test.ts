import { describe, expect, test } from 'bun:test'

import { fitImagePlacementSize } from '#core/editor/clipboard/images'

describe('clipboard image placement', () => {
  test('keeps small raster assets at their intrinsic size', () => {
    expect(fitImagePlacementSize(400, 300)).toEqual({ h: 300, w: 400 })
  })

  test('fits large raster assets into the bounded canvas footprint', () => {
    expect(fitImagePlacementSize(1280, 720)).toEqual({ h: 540, w: 960 })
    expect(fitImagePlacementSize(1200, 1600)).toEqual({ h: 640, w: 480 })
  })
})
