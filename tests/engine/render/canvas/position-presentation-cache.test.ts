import { beforeAll, describe, expect, test } from 'bun:test'

import { SceneGraph, SkiaRenderer } from '@open-pencil/core'

import { initCanvasKit } from '#cli/headless'

let ck: Awaited<ReturnType<typeof initCanvasKit>>

beforeAll(async () => {
  ck = await initCanvasKit()
})

describe('position presentation scene cache', () => {
  test('records an authoritative picture after a transient presentation is cancelled', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('SceneGraph has no default page')
    const node = graph.createNode('RECTANGLE', page.id, {
      height: 80,
      width: 120,
      x: 10,
      y: 20
    })
    const surface = ck.MakeSurface(320, 240)
    if (!surface) throw new Error('CanvasKit did not create a test surface')
    const renderer = new SkiaRenderer(ck, surface)
    renderer.viewportWidth = 320
    renderer.viewportHeight = 240
    renderer.dpr = 1
    renderer.pageId = page.id

    try {
      renderer.render(graph, new Set(), {}, 1)
      expect(renderer.profiler.stats.scenePictureMode).toBe('record')

      graph.setNodePositionPresentation(node.id, { x: 110, y: 120 })
      renderer.render(graph, new Set(), {}, 1)
      expect(renderer.profiler.stats.scenePictureMode).toBe('volatile')
      expect(renderer.profiler.stats.scenePictureMissReason).toBe('position-preview')

      graph.clearNodePositionPresentation(node.id)
      renderer.render(graph, new Set(), {}, 1)
      expect(renderer.profiler.stats.scenePictureMode).toBe('record')
      expect(renderer.profiler.stats.scenePictureMissReason).toBe('position-preview-version')

      renderer.render(graph, new Set(), {}, 1)
      expect(renderer.profiler.stats.scenePictureMode).toBe('hit')
    } finally {
      surface.delete()
    }
  })
})
