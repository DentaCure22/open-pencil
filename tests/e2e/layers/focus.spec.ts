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
  await page.goto('/')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('left-panel-layers-tab').click()
  await page.getByRole('button', { name: 'Open Dental Chart — Flow' }).click()

  const finishTreeItem = page
    .locator('[data-node-id]')
    .filter({ hasText: 'Finish: review to exit' })
    .first()
  await expect(finishTreeItem).toBeVisible()
  const finishId = await finishTreeItem.getAttribute('data-node-id')
  if (!finishId) throw new Error('Expected Finish layer id')

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.zoomToBounds(-200, -200, 200, 200)
  })
  await canvas.waitForRender()

  await finishTreeItem.getByTestId('layers-item').click()
  await canvas.waitForRender()

  const focused = await page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    if (!store || !node) throw new Error('Expected focused layer')

    const canvasArea = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
    const layers = document.querySelector<HTMLElement>('[data-test-id="layers-shell"]')
    const properties = document.querySelector<HTMLElement>('[data-test-id="properties-panel"]')
    const toolbar = document.querySelector<HTMLElement>('[data-test-id="toolbar"]')
    const boardDock = document.querySelector<HTMLElement>('[data-test-id="board-dock"]')
    if (!canvasArea || !layers || !toolbar || !boardDock) throw new Error('Expected editor chrome')

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
      targetY: (toolbarRect.bottom + boardDockRect.top) / 2 - canvasRect.top,
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
  const alternateTreeItem = page.getByRole('treeitem', {
    name: 'Review chart: active-charting to review',
    exact: true
  })
  await expect(alternateTreeItem).toBeVisible()
  const alternateId = await alternateTreeItem.getAttribute('data-node-id')
  if (!alternateId) throw new Error('Expected alternate layer id')
  await alternateTreeItem.getByTestId('layers-item').click({ modifiers: ['Shift'] })
  await canvas.waitForRender()

  const selectedIds = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return [...store.state.selectedIds]
  })
  expect(selectedIds).toEqual(expect.arrayContaining([finishId, alternateId]))
  expect(await viewportState(page)).toEqual(cameraBeforeAdditive)
  // The isolated flow fixture has no authenticated Smylr iframe; native layer navigation
  // should still fail on any browser error other than that expected 401 response.
  expect(canvas.errors.filter((message) => !message.includes('401 (Unauthorized)'))).toEqual([])
})
