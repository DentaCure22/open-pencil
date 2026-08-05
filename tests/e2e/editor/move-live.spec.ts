import { test, expect, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

let page: Page
let canvas: CanvasHelper

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.goto('/?test&no-chrome&no-rulers')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
})

test.afterAll(async () => {
  await page.close()
})

test.beforeEach(async () => {
  await canvas.clearCanvas()
})

test('scene canvas repaints selected node during drag', async () => {
  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('RECTANGLE', 120, 120, 80, 80)
    store.updateNode(id, {
      fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.45, b: 1, a: 1 }, opacity: 1, visible: true }]
    })
    store.select([id])
  })
  await canvas.waitForRender()

  const sceneCanvas = page.getByTestId('scene-canvas-element')
  const beforeDrag = await sceneCanvas.screenshot()
  const box = await page.getByTestId('canvas-element').boundingBox()
  if (!box) throw new Error('No canvas')

  await page.mouse.move(box.x + 160, box.y + 160)
  await page.mouse.down()
  await page.mouse.move(box.x + 260, box.y + 160, { steps: 12 })
  await canvas.waitForRender()
  const duringDrag = await sceneCanvas.screenshot()
  await page.mouse.up()

  expect(Buffer.compare(beforeDrag, duringDrag)).not.toBe(0)
  canvas.assertNoErrors()
})

test('moves a multi-selection from the empty interior of its group bounds', async () => {
  const ids = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const firstId = store.createShape('RECTANGLE', 120, 120, 80, 80)
    const secondId = store.createShape('RECTANGLE', 360, 300, 80, 80)
    store.select([firstId, secondId])
    return [firstId, secondId]
  })
  await canvas.waitForRender()

  const canvasBox = await page.getByTestId('canvas-element').boundingBox()
  if (!canvasBox) throw new Error('No canvas')

  await page.mouse.move(canvasBox.x + 280, canvasBox.y + 240)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + 360, canvasBox.y + 290, { steps: 8 })
  await page.mouse.up()

  const moved = await page.evaluate((nodeIds) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return {
      selectedIds: [...store.state.selectedIds],
      positions: nodeIds.map((id) => {
        const node = store.graph.getNode(id)
        return node ? { x: node.x, y: node.y } : null
      })
    }
  }, ids)
  expect(new Set(moved.selectedIds)).toEqual(new Set(ids))
  expect(moved.positions).toEqual([
    { x: 200, y: 170 },
    { x: 440, y: 350 }
  ])

  await canvas.undo()
  expect(
    await page.evaluate((nodeIds) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      return nodeIds.map((id) => {
        const node = store.graph.getNode(id)
        return node ? { x: node.x, y: node.y } : null
      })
    }, ids)
  ).toEqual([
    { x: 120, y: 120 },
    { x: 360, y: 300 }
  ])
  canvas.assertNoErrors()
})
