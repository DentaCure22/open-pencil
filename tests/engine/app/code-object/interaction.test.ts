import { describe, expect, test } from 'bun:test'

import {
  CODE_OBJECT_DRAG_THRESHOLD_PX,
  codeObjectDesignGestureDragged,
  createCodeObjectDesignGesture,
  moveCodeObjectDesignGesture,
  reconcileCodeObjectInteractionModes
} from '@/app/code-object/interaction'

function gesture() {
  return createCodeObjectDesignGesture({
    frameId: 'frame',
    pointerId: 1,
    startClientX: 100,
    startClientY: 200,
    startX: 40,
    startY: 80
  })
}

describe('Code Object design gesture', () => {
  test('keeps a click pending below the drag threshold', () => {
    const moved = moveCodeObjectDesignGesture(
      gesture(),
      100 + CODE_OBJECT_DRAG_THRESHOLD_PX - 1,
      200
    )

    expect(moved.gesture.phase).toBe('pending')
    expect(codeObjectDesignGestureDragged(moved.gesture)).toBe(false)
  })

  test('becomes a drag at the threshold and never returns to pending', () => {
    const started = moveCodeObjectDesignGesture(gesture(), 100 + CODE_OBJECT_DRAG_THRESHOLD_PX, 200)
    const returnedNearOrigin = moveCodeObjectDesignGesture(started.gesture, 101, 201)

    expect(started.gesture.phase).toBe('dragging')
    expect(returnedNearOrigin.gesture.phase).toBe('dragging')
    expect(codeObjectDesignGestureDragged(returnedNearOrigin.gesture)).toBe(true)
  })
})

describe('Code Object interaction ownership', () => {
  test('returns every deselected frame to Design mode', () => {
    const reconciled = reconcileCodeObjectInteractionModes(
      {
        first: 'interact',
        second: 'interact',
        third: 'design'
      },
      'second'
    )

    expect(reconciled.modes).toEqual({
      first: 'design',
      second: 'interact',
      third: 'design'
    })
    expect(reconciled.deactivatedFrameIds).toEqual(['first'])
  })

  test('preserves the mode record when no interaction owner changes', () => {
    const modes = { first: 'design', second: 'interact' } as const
    const reconciled = reconcileCodeObjectInteractionModes({ ...modes }, 'second')

    expect(reconciled.modes).toEqual(modes)
    expect(reconciled.deactivatedFrameIds).toEqual([])
  })
})
