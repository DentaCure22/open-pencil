import { expect, mock, test } from 'bun:test'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import { createLiveFrameTransformController } from '@/app/smylr-production/frame-transform'

function pointerEvent(x: number, y: number, pointerId = 1): PointerEvent {
  return {
    button: 0,
    clientX: x,
    clientY: y,
    currentTarget: null,
    pointerId
  } as PointerEvent
}

test('live frame resize previews during pointer movement and commits once at pointer up', () => {
  const frame = {
    height: 100,
    id: 'frame',
    rotation: 0,
    width: 100,
    x: 20,
    y: 30
  } as SceneNode
  const updateNodePreview = mock((_id: string, changes: Partial<SceneNode>) => {
    Object.assign(frame, changes)
  })
  const updateNode = mock((_id: string, changes: Partial<SceneNode>) => {
    Object.assign(frame, changes)
  })
  const commitNodeUpdate = mock()
  const requestRepaint = mock()
  const onChange = mock()
  const store = {
    commitNodeUpdate,
    graph: {
      getNode: mock(() => frame),
      updateNodePreview
    },
    requestRepaint,
    state: { zoom: 1 },
    updateNode
  } as unknown as EditorStore
  const controller = createLiveFrameTransformController(store, onChange)

  controller.beginResize(frame.id, 'se', pointerEvent(0, 0))
  controller.move(pointerEvent(50, 25))

  expect(frame).toMatchObject({ height: 125, width: 150, x: 20, y: 30 })
  expect(updateNode).not.toHaveBeenCalled()
  expect(commitNodeUpdate).not.toHaveBeenCalled()
  expect(requestRepaint).toHaveBeenCalledTimes(1)

  controller.end(pointerEvent(50, 25))

  expect(updateNode).toHaveBeenCalledTimes(1)
  expect(updateNode).toHaveBeenCalledWith(frame.id, {
    height: 125,
    width: 150,
    x: 20,
    y: 30
  })
  expect(commitNodeUpdate).toHaveBeenCalledTimes(1)
  expect(commitNodeUpdate).toHaveBeenCalledWith(
    frame.id,
    { height: 100, width: 100, x: 20, y: 30 },
    'Resize live app frame'
  )
  expect(frame).toMatchObject({ height: 125, width: 150, x: 20, y: 30 })
})

test('live frame resize does not create an undo entry when the pointer does not move', () => {
  const frame = {
    height: 100,
    id: 'frame',
    rotation: 0,
    width: 100,
    x: 20,
    y: 30
  } as SceneNode
  const commitNodeUpdate = mock()
  const updateNode = mock()
  const store = {
    commitNodeUpdate,
    graph: { getNode: mock(() => frame), updateNodePreview: mock() },
    requestRepaint: mock(),
    state: { zoom: 1 },
    updateNode
  } as unknown as EditorStore
  const controller = createLiveFrameTransformController(store, mock())

  controller.beginResize(frame.id, 'se', pointerEvent(0, 0))
  controller.end(pointerEvent(0, 0))

  expect(updateNode).not.toHaveBeenCalled()
  expect(commitNodeUpdate).not.toHaveBeenCalled()
})
