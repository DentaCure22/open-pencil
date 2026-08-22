import { expect, test, type Page } from '@playwright/test'

import {
  DOUBLE_CLICK_FOCUS_MAX_ZOOM,
  DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
} from '@open-pencil/core/constants'

import { CanvasHelper } from '#tests/helpers/canvas'

async function focusedPosition(page: Page, nodeId: string) {
  return page.evaluate(
    ({ id, maxZoom, zoomMultiplier }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const node = store.graph.getNode(id)
      if (!node) throw new Error('Expected focused node')

      const canvasArea = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
      const layers = document.querySelector<HTMLElement>('[data-test-id="layers-shell"]')
      const sidebarShell = document.querySelector<HTMLElement>(
        '[data-test-id="layers-shell-motion"]'
      )
      const properties = document.querySelector<HTMLElement>('[data-test-id="properties-panel"]')
      const toolbar = document.querySelector<HTMLElement>('[data-test-id="toolbar"]')
      if (!canvasArea || !sidebarShell || !layers || !toolbar) {
        throw new Error('Expected editor chrome')
      }

      const canvasRect = canvasArea.getBoundingClientRect()
      const sidebarShellRect = sidebarShell.getBoundingClientRect()
      const layersRect = layers.getBoundingClientRect()
      const propertiesRect = properties?.getBoundingClientRect()
      const toolbarRect = toolbar.getBoundingClientRect()
      const toolbarIsVertical = toolbarRect.height > toolbarRect.width
      const toolbarOnLeft =
        toolbarIsVertical && toolbarRect.left < canvasRect.left + canvasRect.width / 2
      const toolbarOnRight = toolbarIsVertical && !toolbarOnLeft
      const leftEdge = Math.max(
        sidebarShellRect.right,
        layersRect.right,
        toolbarOnLeft ? toolbarRect.right : layersRect.right
      )
      const rightEdge =
        propertiesRect && propertiesRect.left >= canvasRect.left + canvasRect.width / 2
          ? propertiesRect.left
          : canvasRect.right
      const safeRightEdge = toolbarOnRight ? Math.min(rightEdge, toolbarRect.left) : rightEdge
      const topEdge = toolbarIsVertical ? canvasRect.top : toolbarRect.bottom
      const absolute = store.graph.getAbsolutePosition(id)
      return {
        expectedZoom: Math.min(
          ((safeRightEdge - leftEdge - 28) / (node.width + 160)) * zoomMultiplier,
          ((canvasRect.bottom - 14 - topEdge - 14) / (node.height + 160)) * zoomMultiplier,
          maxZoom
        ),
        bottom: store.state.panY + (absolute.y + node.height) * store.state.zoom,
        left: store.state.panX + absolute.x * store.state.zoom,
        readableBottom: canvasRect.bottom - canvasRect.top - 14,
        readableLeft: leftEdge - canvasRect.left,
        readableRight: safeRightEdge - canvasRect.left,
        readableTop: topEdge - canvasRect.top + 14,
        right: store.state.panX + (absolute.x + node.width) * store.state.zoom,
        selected: store.state.selectedIds.has(id),
        targetX: (leftEdge + safeRightEdge) / 2 - canvasRect.left,
        targetY: (topEdge + 14 + canvasRect.bottom - 14) / 2 - canvasRect.top,
        x: store.state.panX + (absolute.x + node.width / 2) * store.state.zoom,
        y: store.state.panY + (absolute.y + node.height / 2) * store.state.zoom,
        top: store.state.panY + absolute.y * store.state.zoom,
        zoom: store.state.zoom
      }
    },
    {
      id: nodeId,
      maxZoom: DOUBLE_CLICK_FOCUS_MAX_ZOOM,
      zoomMultiplier: DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
    }
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
  expect(focused.zoom).toBeCloseTo(focused.expectedZoom)
  expect(focused.x).toBeCloseTo(focused.targetX, 0)
  expect(focused.y).toBeCloseTo(focused.targetY, 0)
  canvas.assertNoErrors()
})

test('double-click centers an ordinary native object in the unobstructed Board viewport', async ({
  page
}) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  const target = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const rectangleId = store.createShape('RECTANGLE', 500, 350, 240, 160)
    store.setViewport({ panX: 0, panY: 0, zoom: 0.5 })
    store.clearSelection()
    return { rectangleId, x: 310, y: 215 }
  })
  await canvas.waitForRender()

  await canvas.dblclick(target.x, target.y)

  const focused = await focusedPosition(page, target.rectangleId)
  expect(focused.selected).toBe(true)
  expect(focused.zoom).toBeCloseTo(focused.expectedZoom)
  expect(focused.x).toBeCloseTo(focused.targetX, 0)
  expect(focused.y).toBeCloseTo(focused.targetY, 0)
  canvas.assertNoErrors()
})

test('double-click centers a large object inside the open-sidebar area', async ({ page }) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  const target = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const rectangleId = store.createShape('RECTANGLE', 0, 0, 1200, 800)
    store.setViewport({ panX: 300, panY: 200, zoom: 0.8 })
    store.clearSelection()
    return { rectangleId, x: 400, y: 300 }
  })
  await canvas.waitForRender()

  await canvas.dblclick(target.x, target.y)

  const focused = await focusedPosition(page, target.rectangleId)
  expect(focused.selected).toBe(true)
  expect(focused.zoom).toBeCloseTo(focused.expectedZoom)
  expect(focused.x).toBeCloseTo(focused.targetX, 0)
  expect(focused.y).toBeCloseTo(focused.targetY, 0)
  expect(focused.left).toBeGreaterThan(focused.readableLeft + 8)
  expect(focused.right).toBeLessThan(focused.readableRight - 8)
  expect(focused.top).toBeGreaterThan(focused.readableTop + 8)
  expect(focused.bottom).toBeLessThan(focused.readableBottom - 8)
  canvas.assertNoErrors()
})

test('double-click centers a Code Object while preserving seamless interaction', async ({
  page
}) => {
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

  const target = page.getByTestId('code-object-design-hit-target')
  const targetBounds = await target.boundingBox()
  if (!targetBounds) throw new Error('Code Object interaction target unavailable')
  await page.mouse.dblclick(
    targetBounds.x + targetBounds.width / 2,
    targetBounds.y + targetBounds.height / 2
  )

  const focused = await focusedPosition(page, frameId)
  expect(focused.selected).toBe(true)
  expect(focused.zoom).toBeCloseTo(focused.expectedZoom)
  expect(focused.x).toBeCloseTo(focused.targetX, 0)
  expect(focused.y).toBeCloseTo(focused.targetY, 0)
  await expect(page.locator('[data-code-object-mode]')).toHaveAttribute(
    'data-code-object-mode',
    'interact'
  )
})
