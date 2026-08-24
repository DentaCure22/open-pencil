import { expect, mock, test } from 'bun:test'

import type { Canvas, Image as CKImage, Surface } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { renderSceneBacking } from '#core/canvas/renderer/retained-backing'

function createRenderer(surfaceFactory: () => Surface | null) {
  const renderer: Partial<SkiaRenderer> = {
    ck: {
      AlphaType: { Premul: 'Premul' },
      ColorSpace: { SRGB: 'SRGB' },
      ColorType: { RGBA_8888: 'RGBA_8888' },
      Color4f: mock((r: number, g: number, b: number, a: number) => [r, g, b, a]),
      LTRBRect: mock((left: number, top: number, right: number, bottom: number) => [
        left,
        top,
        right,
        bottom
      ]),
      FilterMode: { Linear: 'Linear' },
      MipmapMode: { None: 'None' }
    } as SkiaRenderer['ck'],
    surface: {
      makeSurface: mock(surfaceFactory)
    } as SkiaRenderer['surface'],
    opacityPaint: {
      setAlphaf: mock()
    } as SkiaRenderer['opacityPaint'],
    panX: 0,
    panY: 0,
    zoom: 1,
    dpr: 1,
    viewportWidth: 100,
    viewportHeight: 100,
    pageColor: { r: 1, g: 1, b: 1 },
    pageId: 'page',
    sceneBacking: null,
    sceneBackingBuild: null,
    sceneBackingNeedsCrispRender: false,
    sceneBackingPreviewUntil: 0,
    sceneBackingAverageRecordMs: 40,
    sceneBackingAverageViewportIntervalMs: 80,
    scenePictureVersion: 0,
    scenePicturePositionPreviewVersion: 0,
    scenePicturePageId: null,
    subtreePictureCache: new Map(),
    subtreePictureCachePageId: null,
    subtreePictureCacheSceneVersion: 0,
    subtreePictureCachePositionPreviewVersion: 0,
    worldViewport: { x: 0, y: 0, w: 0, h: 0 },
    renderNode: mock()
  }
  return renderer as SkiaRenderer
}

function createCanvas() {
  const canvas: Partial<Canvas> = {
    drawImageRect: mock(),
    drawImageRectOptions: mock(),
    restore: mock(),
    save: mock(),
    scale: mock(),
    translate: mock()
  }
  return canvas as Canvas
}

function createGraph(positionPreviewVersion = 0) {
  const graph: Partial<SceneGraph> = {
    rootId: 'root',
    positionPreviewVersion,
    getNode: mock((id: string) => {
      if (id === 'page') return { id: 'page', type: 'CANVAS', childIds: [] }
      return null
    }),
    getAbsolutePosition: mock(() => ({ x: 0, y: 0 }))
  }
  return graph as SceneGraph
}

test('retained scene backing falls back when CanvasKit cannot create an offscreen surface', () => {
  const r = createRenderer(() => null)
  const canvas = createCanvas()
  const graph = createGraph()

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(false)
  expect(r.surface.makeSurface).toHaveBeenCalled()
  expect(canvas.drawImageRectOptions).not.toHaveBeenCalled()
  expect(r.sceneBacking).toBeNull()
})

test('retained scene backing falls back when CanvasKit throws while creating a surface', () => {
  const r = createRenderer(() => {
    throw new Error('surface allocation failed')
  })
  const canvas = createCanvas()
  const graph = createGraph()

  expect(() => renderSceneBacking(r, canvas, graph, 1)).not.toThrow()
  expect(canvas.drawImageRectOptions).not.toHaveBeenCalled()
  expect(r.sceneBacking).toBeNull()
})

test('retained scene backing caps large retina allocations', () => {
  const r = createRenderer(() => null)
  r.viewportWidth = 1_680
  r.viewportHeight = 1_050
  r.dpr = 2
  const canvas = createCanvas()
  const graph = createGraph()

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(false)
  const makeSurface = r.surface.makeSurface as typeof r.surface.makeSurface & {
    mock: { calls: Array<Array<unknown>> }
  }
  const descriptor = makeSurface.mock.calls[0]?.[0] as { height: number; width: number } | undefined
  expect(descriptor).toBeDefined()
  expect(descriptor?.width).toBeLessThanOrEqual(8_192)
  expect(descriptor?.height).toBeLessThanOrEqual(8_192)
  expect((descriptor?.width ?? 0) * (descriptor?.height ?? 0)).toBeLessThan(16_020_000)
})

test('retained scene backing filters cross-zoom previews instead of falling back to live rendering', () => {
  const r = createRenderer(() => null)
  r.zoom = 1
  r.sceneBackingPreviewUntil = Number.POSITIVE_INFINITY
  r.sceneBacking = {
    image: { delete: mock() } as CKImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 0,
    panX: 0,
    panY: 0,
    zoom: 0.5,
    width: 300,
    height: 300,
    dpr: 1,
    worldX: 0,
    worldY: 0,
    worldWidth: 600,
    worldHeight: 600
  } as NonNullable<SkiaRenderer['sceneBacking']>
  const canvas = createCanvas()
  const graph = createGraph()

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
  expect(canvas.drawImageRectOptions).toHaveBeenCalledWith(
    r.sceneBacking.image,
    expect.anything(),
    expect.anything(),
    r.ck.FilterMode.Linear,
    r.ck.MipmapMode.None,
    r.opacityPaint
  )
})

test('retained scene backing allows same-zoom previews while panning', () => {
  const r = createRenderer(() => null)
  r.zoom = 1
  r.sceneBackingPreviewUntil = Number.POSITIVE_INFINITY
  r.sceneBacking = {
    image: { delete: mock() } as CKImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 0,
    panX: 0,
    panY: 0,
    zoom: 1,
    width: 300,
    height: 300,
    dpr: 1,
    worldX: 0,
    worldY: 0,
    worldWidth: 300,
    worldHeight: 300
  } as NonNullable<SkiaRenderer['sceneBacking']>
  const canvas = createCanvas()
  const graph = createGraph()

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
  expect(canvas.drawImageRectOptions).toHaveBeenCalled()
})

test('retained scene backing stays reusable while a position preview is active', () => {
  const r = createRenderer(() => null)
  r.sceneBacking = {
    image: { delete: mock() } as CKImage,
    pageId: 'page',
    sceneVersion: 1,
    positionPreviewVersion: 1,
    panX: 0,
    panY: 0,
    zoom: 1,
    width: 100,
    height: 100,
    dpr: 1,
    worldX: 0,
    worldY: 0,
    worldWidth: 100,
    worldHeight: 100
  } as NonNullable<SkiaRenderer['sceneBacking']>
  r.scenePicturePositionPreviewVersion = 1
  const canvas = createCanvas()
  const graph = createGraph(2)

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
  expect(canvas.drawImageRectOptions).toHaveBeenCalled()
})

test('retained scene backing skips recording top-level subtrees outside its world coverage', () => {
  const backingCanvas = {
    clear: mock(),
    drawPicture: mock(),
    restore: mock(),
    save: mock(),
    scale: mock(),
    translate: mock()
  } as unknown as Canvas
  const image = { delete: mock() } as CKImage
  const surface = {
    delete: mock(),
    flush: mock(),
    getCanvas: mock(() => backingCanvas),
    makeImageSnapshot: mock(() => image)
  } as unknown as Surface
  const r = createRenderer(() => surface)
  const canvas = createCanvas()
  const graph = {
    getAbsolutePosition: mock(() => ({ x: 10_000, y: 10_000 })),
    getDescendantVisualBounds: mock(() => ({
      maxX: 10_100,
      maxY: 10_100,
      minX: 10_000,
      minY: 10_000
    })),
    getNode: mock((id: string) => {
      if (id === 'page') return { childIds: ['offscreen'], id: 'page', type: 'CANVAS' }
      if (id === 'offscreen') {
        return {
          childIds: [],
          height: 100,
          id: 'offscreen',
          type: 'FRAME',
          visible: true,
          width: 100
        }
      }
      return undefined
    }),
    positionPreviewVersion: 0,
    rootId: 'root'
  } as unknown as SceneGraph

  expect(renderSceneBacking(r, canvas, graph, 1)).toBe(true)
  expect(r.renderNode).not.toHaveBeenCalled()
  expect(backingCanvas.clear).toHaveBeenCalledWith([0, 0, 0, 0])
  expect(backingCanvas.save).not.toHaveBeenCalled()
  expect(surface.makeImageSnapshot).toHaveBeenCalled()
})
