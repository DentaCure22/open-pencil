import { afterEach, describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { useCanvasCollaborationAwareness } from '@/app/editor/canvas/collaboration-awareness'
import { createEditorStore } from '@/app/editor/session'

const originalRequestAnimationFrame = globalThis.requestAnimationFrame
const originalCancelAnimationFrame = globalThis.cancelAnimationFrame

afterEach(() => {
  globalThis.requestAnimationFrame = originalRequestAnimationFrame
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame
})

describe('canvas collaboration awareness', () => {
  test('coalesces high-frequency pointer events into the latest cursor per frame', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      callbacks.set(frameId, callback)
      return frameId
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = ((frameId: number) => {
      callbacks.delete(frameId)
    }) as typeof cancelAnimationFrame

    const store = createEditorStore(new SceneGraph())
    const cursorUpdates: Array<{ pageId: string; x: number; y: number }> = []
    const { updateCursor } = useCanvasCollaborationAwareness(store, {
      updateCursor(x, y, pageId) {
        cursorUpdates.push({ pageId, x, y })
      },
      updateSelection: () => undefined
    })

    for (let index = 0; index < 120; index += 1) {
      updateCursor(index, index * 2)
    }

    expect(store.state.cursorCanvasX).toBe(119)
    expect(store.state.cursorCanvasY).toBe(238)
    expect(cursorUpdates).toHaveLength(0)
    expect(callbacks.size).toBe(1)

    const pendingFrame = [...callbacks.values()][0]
    if (!pendingFrame) throw new Error('Missing scheduled awareness frame')
    pendingFrame(performance.now())

    expect(cursorUpdates).toEqual([{ pageId: store.state.currentPageId, x: 119, y: 238 }])
  })
})
