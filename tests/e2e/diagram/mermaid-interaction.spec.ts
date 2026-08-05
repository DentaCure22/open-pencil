import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

const SOURCE = `flowchart LR
  Capture --> Decide --> Build`
const UPDATED_SOURCE = `flowchart TD
  Capture --> Decide --> RenderSVG --> Build`

async function insertMermaid(page: Page, source = SOURCE) {
  const menubar = page.locator('[role="menubar"]')
  if (!(await menubar.isVisible())) await page.getByTestId('app-menu-toggle').click()
  await page.getByTestId('menubar-insert').click()
  await page.getByRole('menuitem', { name: 'Mermaid diagram…', exact: true }).click()
  await page.getByTestId('mermaid-source').fill(source)
  await expect(page.getByTestId('mermaid-insert')).toBeEnabled({ timeout: 15_000 })
  await page.getByTestId('mermaid-insert').click()
  await expect(page.getByTestId('mermaid-svg-object').locator('svg')).toBeVisible({
    timeout: 30_000
  })
}

test('updates one Mermaid SVG frame from source without creating native children', async ({
  page
}) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  await insertMermaid(page)

  const original = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const ownerId = [...store.state.selectedIds][0]
    const owner = ownerId ? store.graph.getNode(ownerId) : undefined
    return { childIds: owner?.childIds, ownerId, type: owner?.type }
  })
  expect(original).toMatchObject({ childIds: [], type: 'FRAME' })

  await page.getByTestId('mermaid-edit-source').click()
  await expect(page.getByRole('heading', { name: 'Edit Mermaid source' })).toBeVisible()
  await page.getByTestId('mermaid-source').fill(UPDATED_SOURCE)
  await expect(page.getByTestId('mermaid-insert')).toBeEnabled({ timeout: 15_000 })
  await page.getByTestId('mermaid-insert').click()

  await expect(page.getByTestId('mermaid-svg-object').locator('svg')).toContainText('RenderSVG', {
    timeout: 30_000
  })
  const updated = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const ownerId = [...store.state.selectedIds][0]
    const owner = ownerId ? store.graph.getNode(ownerId) : undefined
    return {
      childIds: owner?.childIds,
      ownerId,
      source: owner?.pluginData.find((entry) => entry.key === 'mermaid/source')?.value
    }
  })
  expect(updated).toEqual({ childIds: [], ownerId: original.ownerId, source: UPDATED_SOURCE })
})

test('selects, drags, and focuses a Mermaid SVG frame like one normal object', async ({ page }) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await insertMermaid(page)

  const initial = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const ownerId = [...store.state.selectedIds][0]
    const owner = ownerId ? store.graph.getNode(ownerId) : undefined
    if (!owner) throw new Error('Expected selected Mermaid owner')
    const absolute = store.graph.getAbsolutePosition(owner.id)
    store.clearSelection()
    return {
      centerX: (absolute.x + owner.width / 2) * store.state.zoom + store.state.panX,
      centerY: (absolute.y + owner.height / 2) * store.state.zoom + store.state.panY,
      ownerId,
      x: owner.x,
      y: owner.y,
      zoom: store.state.zoom
    }
  })

  await canvas.click(initial.centerX, initial.centerY)
  expect(
    await page.evaluate((ownerId) => {
      const store = window.openPencil?.getStore?.()
      return store?.state.selectedIds.has(ownerId) ?? false
    }, initial.ownerId)
  ).toBe(true)

  await canvas.drag(initial.centerX, initial.centerY, initial.centerX + 80, initial.centerY + 40)
  const moved = await page.evaluate((ownerId) => {
    const store = window.openPencil?.getStore?.()
    const owner = store?.graph.getNode(ownerId)
    if (!store || !owner) throw new Error('Expected moved Mermaid owner')
    const absolute = store.graph.getAbsolutePosition(owner.id)
    store.setViewport({
      panX: 240 - (absolute.x + owner.width / 2) * 0.5,
      panY: 180 - (absolute.y + owner.height / 2) * 0.5,
      zoom: 0.5
    })
    return {
      centerX: 240,
      centerY: 180,
      x: owner.x,
      y: owner.y
    }
  }, initial.ownerId)
  expect(moved.x).toBeCloseTo(initial.x + 80 / initial.zoom, 0)
  expect(moved.y).toBeCloseTo(initial.y + 40 / initial.zoom, 0)

  await canvas.dblclick(moved.centerX, moved.centerY)
  const focused = await page.evaluate((ownerId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return {
      enteredContainerId: store.state.enteredContainerId,
      panX: store.state.panX,
      panY: store.state.panY,
      selected: store.state.selectedIds.has(ownerId)
    }
  }, initial.ownerId)
  expect(focused.enteredContainerId).toBeNull()
  expect(focused.selected).toBe(true)
  expect([focused.panX, focused.panY]).not.toEqual([
    240 - (moved.x + 360) * 0.5,
    180 - (moved.y + 240) * 0.5
  ])
  canvas.assertNoErrors()
})
