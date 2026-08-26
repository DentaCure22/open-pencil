import { describe, expect, test } from 'bun:test'

import {
  beginLiveInspectorOverlayTransform,
  liveInspectorTransformDistance,
  updateLiveInspectorOverlayTransform
} from '@/app/smylr-live-inspector/overlay-transform'

const rect = { height: 80, width: 100, x: 10, y: 20 }

describe('Smylr live-inspector overlay transform', () => {
  test('moves in canvas coordinates while preserving the existing translation', () => {
    const transform = beginLiveInspectorOverlayTransform({
      action: { kind: 'move', selectOnClick: false },
      pointer: { clientX: 100, clientY: 100, pointerId: 7 },
      rect,
      styles: { translate: '3px 4px' }
    })
    if (!transform) throw new Error('Missing move transform')

    const update = updateLiveInspectorOverlayTransform(
      transform,
      { clientX: 120, clientY: 80, pointerId: 7 },
      2
    )

    expect(update).toEqual({
      kind: 'move',
      position: { x: 20, y: 10 },
      styles: { translate: '13px -6px' }
    })
    expect(
      liveInspectorTransformDistance(transform, {
        clientX: 120,
        clientY: 80,
        pointerId: 7
      })
    ).toBeCloseTo(Math.hypot(20, -20))
  })

  test('resizes from the northwest and keeps the opposite corner fixed at the minimum size', () => {
    const transform = beginLiveInspectorOverlayTransform({
      action: { handle: 'nw', kind: 'resize' },
      pointer: { clientX: 0, clientY: 0, pointerId: 2 },
      rect,
      styles: { translate: '5px 6px' }
    })
    if (!transform) throw new Error('Missing resize transform')

    const update = updateLiveInspectorOverlayTransform(
      transform,
      { clientX: 200, clientY: 200, pointerId: 2 },
      1
    )

    expect(update).toEqual({
      kind: 'resize',
      size: { height: 24, width: 24 },
      styles: { height: '24px', translate: '81px 62px', width: '24px' }
    })
  })

  test('resizes southeast at zoom without adding an unnecessary translation', () => {
    const transform = beginLiveInspectorOverlayTransform({
      action: { handle: 'se', kind: 'resize' },
      pointer: { clientX: 0, clientY: 0, pointerId: 3 },
      rect
    })
    if (!transform) throw new Error('Missing resize transform')

    const update = updateLiveInspectorOverlayTransform(
      transform,
      { clientX: 40, clientY: 20, pointerId: 3 },
      2
    )

    expect(update).toEqual({
      kind: 'resize',
      size: { height: 90, width: 120 },
      styles: { height: '90px', width: '120px' }
    })
  })

  test('rotates around the overlay center and ignores a different pointer', () => {
    const transform = beginLiveInspectorOverlayTransform({
      action: { kind: 'rotate' },
      bounds: { height: 100, left: 100, top: 100, width: 100 },
      pointer: { clientX: 200, clientY: 150, pointerId: 9 },
      styles: { rotate: '30deg' }
    })
    if (!transform) throw new Error('Missing rotate transform')

    expect(
      updateLiveInspectorOverlayTransform(
        transform,
        { clientX: 150, clientY: 200, pointerId: 9 },
        1
      )
    ).toEqual({ kind: 'rotate', styles: { rotate: '120deg' } })
    expect(
      updateLiveInspectorOverlayTransform(
        transform,
        { clientX: 150, clientY: 200, pointerId: 10 },
        1
      )
    ).toBeNull()
  })
})
