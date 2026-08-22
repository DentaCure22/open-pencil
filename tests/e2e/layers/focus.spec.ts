import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

interface ViewportState {
  panX: number
  panY: number
  zoom: number
}

async function viewportState(page: Page): Promise<ViewportState> {
  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return { panX: store.state.panX, panY: store.state.panY, zoom: store.state.zoom }
  })
}

test('plain layer click selects and centers the node without recentering additive selection', async ({
  page
}) => {
  await page.goto('/?test')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('left-panel-layers-tab').click()

  const { alternateId, finishId } = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const finishId = store.createShape('RECTANGLE', 1800, 900, 120, 80)
    const alternateId = store.createShape('RECTANGLE', 80, 80, 100, 70)
    store.graph.updateNode(finishId, { name: 'Layer focus target' })
    store.graph.updateNode(alternateId, { name: 'Layer additive target' })
    store.clearSelection()
    store.requestRender()
    return { alternateId, finishId }
  })

  const finishTreeItem = page.locator(`[data-node-id="${finishId}"]`)
  await expect(finishTreeItem).toBeVisible()

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.zoomToBounds(-200, -200, 200, 200)
  })
  await canvas.waitForRender()

  await finishTreeItem.getByTestId('layers-item').click()
  await canvas.waitForRender()

  const focused = await page.evaluate(async (id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    if (!store || !node) throw new Error('Expected focused layer')

    const canvasArea = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
    if (!canvasArea) throw new Error('Expected editor canvas')

    const canvasRect = canvasArea.getBoundingClientRect()
    const { editorViewportInsets } = await import('/src/app/editor/viewport-insets.ts')
    const { bottom = 0, left = 0, right = 0, top = 0 } = editorViewportInsets()
    const absolute = store.graph.getAbsolutePosition(id)

    return {
      selected: store.state.selectedIds.has(id),
      targetX: left + (canvasRect.width - left - right) / 2,
      targetY: top + (canvasRect.height - top - bottom) / 2,
      x: store.state.panX + (absolute.x + node.width / 2) * store.state.zoom,
      y: store.state.panY + (absolute.y + node.height / 2) * store.state.zoom,
      zoom: store.state.zoom
    }
  }, finishId)

  expect(focused.selected).toBe(true)
  expect(focused.x).toBeCloseTo(focused.targetX, 0)
  expect(focused.y).toBeCloseTo(focused.targetY, 0)
  expect(focused.zoom).toBeLessThanOrEqual(1)

  const cameraBeforeAdditive = await viewportState(page)
  const alternateTreeItem = page.locator(`[data-node-id="${alternateId}"]`)
  await expect(alternateTreeItem).toBeVisible()
  await alternateTreeItem.getByTestId('layers-item').click({ modifiers: ['Shift'] })
  await canvas.waitForRender()

  const selectedIds = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return [...store.state.selectedIds]
  })
  expect(selectedIds).toEqual(expect.arrayContaining([finishId, alternateId]))
  expect(await viewportState(page)).toEqual(cameraBeforeAdditive)
  canvas.assertNoErrors()
})
