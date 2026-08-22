import { describe, expect, test } from 'bun:test'

import type { Editor } from '@open-pencil/core/editor'

import { canvasBackingSize, canvasPixelRatio, sizeCanvas } from '#vue/canvas/surface/gl-surface'

describe('canvas pixel ratio', () => {
  test('caps retina backing stores without dropping below 1x', () => {
    expect(canvasPixelRatio(1.5, 2)).toBe(1.5)
    expect(canvasPixelRatio(1.25, 2)).toBe(1.25)
    expect(canvasPixelRatio(1.5, 1)).toBe(1)
    expect(canvasPixelRatio(undefined, 2)).toBe(2)
  })

  test('returns the backing ratio used to size the canvas for renderer projection', () => {
    const canvas = { clientHeight: 600, clientWidth: 1000, height: 0, width: 0 }
    const viewportSizes: Array<{ height: number; width: number }> = []
    const editor = {
      setViewportSize(width: number, height: number) {
        viewportSizes.push({ height, width })
      }
    } as Editor

    const backing = sizeCanvas(canvas as HTMLCanvasElement, editor, {
      maxDevicePixelRatio: 1.25
    })

    expect(backing).toEqual({ dpr: 1, height: 600, width: 1000 })
    expect(canvas).toMatchObject({ height: 600, width: 1000 })
    expect(viewportSizes).toEqual([{ height: 600, width: 1000 }])
  })

  test('normalizes fractional backing dimensions once for resize comparisons', () => {
    expect(canvasBackingSize(801, 601, 1.25, 2)).toEqual({
      dpr: 1.25,
      height: 751,
      width: 1001
    })
  })
})
