import { expect, mock, test } from 'bun:test'

import type { Canvas } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'

import { drawSelection } from '#core/canvas/overlays/selection'
import type { SkiaRenderer } from '#core/canvas/renderer'

function selectionRenderer() {
  return {
    drawParentFrameOutlines: mock()
  } as unknown as SkiaRenderer
}

test('lets one product-owned overlay replace native selection chrome', () => {
  const renderer = selectionRenderer()

  drawSelection(
    renderer,
    {} as Canvas,
    { getNode: mock(() => undefined) } as unknown as SceneGraph,
    new Set(['code-object']),
    { selectionChromeOwnerIds: new Set(['code-object']) }
  )

  expect(renderer.drawParentFrameOutlines).not.toHaveBeenCalled()
})

test('lets one product-owned overlay replace native hover chrome', async () => {
  const pipeline = await Bun.file('packages/core/src/canvas/renderer/pipeline.ts').text()
  expect(pipeline).toContain('hoverChromeOwnerIds')
  expect(pipeline).toContain('!overlays.hoverChromeOwnerIds?.has(overlays.hoveredNodeId)')
})

test('keeps native selection chrome for ordinary selected nodes', () => {
  const renderer = selectionRenderer()
  const canvas = {} as Canvas
  const graph = { getNode: mock(() => undefined) } as unknown as SceneGraph
  const selectedIds = new Set(['rectangle'])

  drawSelection(renderer, canvas, graph, selectedIds, {})

  expect(renderer.drawParentFrameOutlines).toHaveBeenCalledWith(canvas, graph, selectedIds)
})
