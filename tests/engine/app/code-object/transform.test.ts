import { expect, mock, test } from 'bun:test'

import {
  createSmylrTrustedWebAppDocument,
  parseCodeObjectDocument,
  serializeCodeObjectPluginData
} from '@open-pencil/core/code-object'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  applyCodeObjectViewportPreset,
  codeObjectCanvasStyle,
  codeObjectScreenOverlayStyle,
  codeObjectViewportPresetId,
  createCodeObjectTransformController,
  liveIframeHostStyle,
  type CodeObjectTransformControllerStore
} from '@/app/code-object/transform'

function pointerEvent(x: number, y: number, pointerId = 1): PointerEvent {
  return {
    button: 0,
    clientX: x,
    clientY: y,
    currentTarget: null,
    pointerId
  } as PointerEvent
}

test('Code Object interaction highlight hugs the frame without an outline gap', async () => {
  const overlays = await Bun.file('src/components/canvas/CodeObjectOverlays.vue').text()

  expect(overlays).toContain('outline outline-2 outline-offset-0 outline-component/70')
  expect(overlays).not.toContain('outline outline-2 outline-offset-2 outline-component/70')
})

test('Code Object surface and selection chrome share the frame corner radius', () => {
  const frame = {
    cornerRadius: 16,
    height: 900,
    id: 'frame',
    opacity: 1,
    rotation: 0,
    width: 1440
  } as SceneNode
  const store = {
    graph: { getAbsolutePosition: mock(() => ({ x: 120, y: 180 })) },
    state: { panX: 24, panY: 32, zoom: 0.5 }
  } as Parameters<typeof codeObjectCanvasStyle>[0]

  expect(codeObjectCanvasStyle(store, frame)).toMatchObject({
    backfaceVisibility: 'hidden',
    borderRadius: '16px',
    contain: 'layout paint',
    willChange: 'transform'
  })
  expect(codeObjectScreenOverlayStyle(store, frame)).toMatchObject({
    borderRadius: '8px',
    height: '450px',
    width: '720px'
  })
  expect(liveIframeHostStyle(codeObjectCanvasStyle(store, frame))).toMatchObject({
    backfaceVisibility: 'visible',
    contain: 'layout',
    willChange: 'auto'
  })
})

test('Code Object resize previews during pointer movement and commits once at pointer up', () => {
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
      getAbsolutePosition: mock(() => ({ x: frame.x, y: frame.y })),
      getNode: mock(() => frame),
      updateNodePreview
    },
    requestRepaint,
    state: { panX: 0, panY: 0, zoom: 1 },
    updateNode
  } satisfies CodeObjectTransformControllerStore
  const controller = createCodeObjectTransformController(store, onChange)

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
    'Resize code object'
  )
  expect(frame).toMatchObject({ height: 125, width: 150, x: 20, y: 30 })
})

test('Code Object resize does not create an undo entry when the pointer does not move', () => {
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
    graph: {
      getAbsolutePosition: mock(() => ({ x: frame.x, y: frame.y })),
      getNode: mock(() => frame),
      updateNodePreview: mock()
    },
    requestRepaint: mock(),
    state: { panX: 0, panY: 0, zoom: 1 },
    updateNode
  } satisfies CodeObjectTransformControllerStore
  const controller = createCodeObjectTransformController(store, mock())

  controller.beginResize(frame.id, 'se', pointerEvent(0, 0))
  controller.end(pointerEvent(0, 0))

  expect(updateNode).not.toHaveBeenCalled()
  expect(commitNodeUpdate).not.toHaveBeenCalled()
})

test('Code Object viewport presets resize the Board frame around its center with Undo', () => {
  const frame = {
    height: 600,
    id: 'frame',
    pluginData: [],
    rotation: 12,
    width: 800,
    x: 100,
    y: 200
  } as SceneNode
  const updateNodeWithUndo = mock((_id: string, changes: Partial<SceneNode>) => {
    Object.assign(frame, changes)
  })
  const store = {
    graph: { getNode: mock(() => frame) },
    updateNodeWithUndo
  }

  expect(applyCodeObjectViewportPreset(store, frame.id, 'tablet')).toBe(true)
  expect(updateNodeWithUndo).toHaveBeenCalledWith(
    frame.id,
    {
      height: 1024,
      rotation: 0,
      width: 768,
      x: 116,
      y: -12
    },
    'Set Tablet viewport'
  )
  expect(codeObjectViewportPresetId(frame)).toBe('tablet')
})

test('Code Object viewport clicks persist the same semantic preset used by agents', () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, { height: 600, width: 800 })
  const document = createSmylrTrustedWebAppDocument({
    label: 'Dental Chart',
    route: '/dental-chart'
  })
  graph.updateNode(frame.id, { pluginData: serializeCodeObjectPluginData(frame, document) })
  const store = {
    graph,
    updateNodeWithUndo: mock((id: string, changes: Partial<SceneNode>) => {
      graph.updateNode(id, changes)
    })
  }

  expect(applyCodeObjectViewportPreset(store, frame.id, 'phone')).toBe(true)
  const resized = graph.getNode(frame.id)
  expect(resized).toMatchObject({ height: 844, width: 390 })
  expect(parseCodeObjectDocument(resized)).toMatchObject({
    viewport: { preset: 'phone' }
  })
})
