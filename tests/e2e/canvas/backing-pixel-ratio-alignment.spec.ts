import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('keeps rendered pixels and hit testing aligned with capped canvas backing ratios', async ({
  page
}) => {
  await page.goto('/?test&no-chrome&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  const childId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const parent = store.graph.createNode('FRAME', store.state.currentPageId, {
      fills: [
        {
          color: { a: 1, b: 0.96, g: 0.94, r: 0.94 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ],
      height: 2670,
      name: 'Workspace',
      width: 3970,
      x: -3970,
      y: -260
    })
    const child = store.graph.createNode('RECTANGLE', parent.id, {
      fills: [
        {
          color: { a: 1, b: 0.2, g: 0.1, r: 0.9 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ],
      height: 480,
      name: 'Nested object',
      width: 640,
      x: 1870,
      y: 440
    })
    store.setViewport({ panX: 1050, panY: 210, zoom: 0.45 })
    store.clearSelection()
    store.requestRender()
    return child.id
  })

  const sample = { x: 112, y: 298 }
  const readScenePixel = () =>
    page.evaluate(({ x, y }) => {
      const element = document.querySelector<HTMLCanvasElement>(
        '[data-test-id="scene-canvas-element"]'
      )
      const gl = element?.getContext('webgl2')
      if (!element || !gl) throw new Error('Scene WebGL surface unavailable')
      const bounds = element.getBoundingClientRect()
      const pixel = new Uint8Array(4)
      gl.readPixels(
        Math.floor(x * (element.width / bounds.width)),
        Math.floor((bounds.height - y) * (element.height / bounds.height)),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel
      )
      return [...pixel]
    }, sample)

  await expect
    .poll(async () => {
      const [red, green, blue] = await readScenePixel()
      return red > 180 && green < 80 && blue < 100
    })
    .toBe(true)

  await canvas.click(sample.x, sample.y)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        return store ? [...store.state.selectedIds] : []
      })
    )
    .toEqual([childId])
})
