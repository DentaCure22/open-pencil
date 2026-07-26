import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

async function focusedPosition(page: Page, nodeId: string, topInsetAdjustment = 0) {
  return page.evaluate(
    ({ id, topOffset }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const node = store.graph.getNode(id)
      if (!node) throw new Error('Expected focused node')

      const canvasArea = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
      const layers = document.querySelector<HTMLElement>('[data-test-id="layers-shell"]')
      const properties = document.querySelector<HTMLElement>('[data-test-id="properties-panel"]')
      const toolbar = document.querySelector<HTMLElement>('[data-test-id="toolbar"]')
      const boardDock = document.querySelector<HTMLElement>('[data-test-id="board-dock"]')
      if (!canvasArea || !layers || !toolbar || !boardDock)
        throw new Error('Expected editor chrome')

      const canvasRect = canvasArea.getBoundingClientRect()
      const layersRect = layers.getBoundingClientRect()
      const propertiesRect = properties?.getBoundingClientRect()
      const toolbarRect = toolbar.getBoundingClientRect()
      const boardDockRect = boardDock.getBoundingClientRect()
      const rightEdge =
        propertiesRect && propertiesRect.left >= canvasRect.left + canvasRect.width / 2
          ? propertiesRect.left
          : canvasRect.right
      const absolute = store.graph.getAbsolutePosition(id)

      return {
        selected: store.state.selectedIds.has(id),
        targetX: (layersRect.right + rightEdge) / 2 - canvasRect.left,
        targetY: (toolbarRect.bottom + boardDockRect.top + topOffset) / 2 - canvasRect.top,
        x: store.state.panX + (absolute.x + node.width / 2) * store.state.zoom,
        y: store.state.panY + (absolute.y + node.height / 2) * store.state.zoom
      }
    },
    { id: nodeId, topOffset: topInsetAdjustment }
  )
}

test('double-click centers a native container in the unobstructed Board viewport', async ({
  page
}) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  const target = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frameId = store.createShape('FRAME', 500, 350, 240, 160)
    store.setViewport({ panX: 0, panY: 0, zoom: 0.5 })
    store.clearSelection()
    return { frameId, x: 310, y: 215 }
  })
  await canvas.waitForRender()

  await canvas.dblclick(target.x, target.y)

  const enteredContainerId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.enteredContainerId
  })
  const focused = await focusedPosition(page, target.frameId)

  expect(enteredContainerId).toBe(target.frameId)
  expect(focused.selected).toBe(true)
  expect(focused.x).toBeCloseTo(focused.targetX, 0)
  expect(focused.y).toBeCloseTo(focused.targetY, 0)
  canvas.assertNoErrors()
})

test('double-click centers a Code Object before entering interaction', async ({ page }) => {
  await page.goto('/?test&html-source&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('code-object-start').click()

  const frameId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const [id] = store ? [...store.state.selectedIds] : []
    const frame = id ? store?.graph.getNode(id) : null
    if (!store || !frame) throw new Error('Expected selected Code Object')
    const absolute = store.graph.getAbsolutePosition(frame.id)
    store.setViewport({
      panX: 720 - (absolute.x + frame.width / 2) * 0.5,
      panY: 430 - (absolute.y + frame.height / 2) * 0.5,
      zoom: 0.5
    })
    return frame.id
  })
  await canvas.waitForRender()

  await page.getByTestId('code-object-design-hit-target').dblclick()

  const focused = await focusedPosition(page, frameId, 8)
  expect(focused.selected).toBe(true)
  expect(focused.x).toBeCloseTo(focused.targetX, 0)
  expect(focused.y).toBeCloseTo(focused.targetY, 0)
  await expect(page.locator('[data-code-object-mode]')).toHaveAttribute(
    'data-code-object-mode',
    'interact'
  )
  canvas.assertNoErrors()
})
