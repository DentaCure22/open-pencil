import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { createTestCodeObject } from '#tests/helpers/code-object'

const SOURCE = `flowchart LR
  Capture --> Decide --> Build`
const UPDATED_SOURCE = `flowchart TD
  Capture --> Decide --> RenderSVG --> Build`

async function insertMermaid(page: Page, source = SOURCE) {
  const menubar = page.locator('[role="menubar"]')
  if (!(await menubar.isVisible())) await page.getByTestId('app-menu-toggle').click()
  await page.getByTestId('menubar-file').click()
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

test('keeps Mermaid and Code Object overlays synchronized while panning', async ({ page }) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await insertMermaid(page)

  const placement = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const mermaidId = [...store.state.selectedIds][0]
    const mermaid = mermaidId ? store.graph.getNode(mermaidId) : undefined
    if (!mermaidId || !mermaid) throw new Error('Expected selected Mermaid owner')
    return {
      codeObjectX: mermaid.x + mermaid.width + 80,
      mermaidId,
      mermaidX: mermaid.x,
      mermaidY: mermaid.y
    }
  })
  const codeObjectId = await createTestCodeObject(
    page,
    'Presentation clock probe',
    placement.codeObjectX,
    placement.mermaidY
  )

  await page.evaluate(
    ({ codeObjectId, mermaidId }) => {
      const store = window.openPencil?.getStore?.()
      const mermaid = store?.graph.getNode(mermaidId)
      const codeObject = store?.graph.getNode(codeObjectId)
      if (!store || !mermaid || !codeObject) throw new Error('Expected presentation probe objects')
      const left = Math.min(mermaid.x, codeObject.x)
      const right = Math.max(mermaid.x + mermaid.width, codeObject.x + codeObject.width)
      const top = Math.min(mermaid.y, codeObject.y)
      const bottom = Math.max(mermaid.y + mermaid.height, codeObject.y + codeObject.height)
      const zoom = 0.5
      store.setViewport({
        panX: 420 - ((left + right) / 2) * zoom,
        panY: 360 - ((top + bottom) / 2) * zoom,
        zoom
      })
    },
    { codeObjectId, mermaidId: placement.mermaidId }
  )

  const mermaidOverlay = page.getByTestId('mermaid-svg-object')
  const codeObjectOverlay = page.getByTestId(`code-object-${codeObjectId}`)
  await expect(mermaidOverlay).toBeVisible()
  await expect(codeObjectOverlay).toBeVisible()
  await canvas.waitForRender()
  const objectStylesBeforePan = await Promise.all([
    mermaidOverlay.getAttribute('style'),
    codeObjectOverlay.getAttribute('style')
  ])

  const readOverlayPositions = () =>
    page.evaluate((frameId) => {
      const mermaid = document.querySelector('[data-test-id="mermaid-svg-object"]')
      const codeObject = document.querySelector(`[data-test-id="code-object-${frameId}"]`)
      if (!mermaid || !codeObject) throw new Error('Presentation probe overlays are unavailable')
      const mermaidBox = mermaid.getBoundingClientRect()
      const codeObjectBox = codeObject.getBoundingClientRect()
      return {
        codeObject: { x: codeObjectBox.x, y: codeObjectBox.y },
        mermaid: { x: mermaidBox.x, y: mermaidBox.y }
      }
    }, codeObjectId)

  const initial = await readOverlayPositions()
  const canvasBox = await canvas.canvas.boundingBox()
  if (!canvasBox) throw new Error('Canvas has no bounding box')
  const start = {
    x: canvasBox.x + canvasBox.width / 2,
    y: canvasBox.y + canvasBox.height - 80
  }
  await canvas.selectTool('hand')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()

  const samples: Array<Awaited<ReturnType<typeof readOverlayPositions>>> = []
  const movement = page.mouse.move(start.x + 120, start.y - 48, { steps: 80 })
  const sampling = async () => {
    for (let index = 0; index < 40; index += 1) {
      samples.push(await readOverlayPositions())
      await page.waitForTimeout(2)
    }
  }
  await Promise.all([movement, sampling()])
  await canvas.waitForRender()
  samples.push(await readOverlayPositions())
  await page.mouse.up()

  const displacements = samples.map((sample) =>
    Math.hypot(sample.mermaid.x - initial.mermaid.x, sample.mermaid.y - initial.mermaid.y)
  )
  const maximumDrift = Math.max(
    ...samples.map((sample) => {
      const mermaidDelta = {
        x: sample.mermaid.x - initial.mermaid.x,
        y: sample.mermaid.y - initial.mermaid.y
      }
      const codeObjectDelta = {
        x: sample.codeObject.x - initial.codeObject.x,
        y: sample.codeObject.y - initial.codeObject.y
      }
      return Math.hypot(mermaidDelta.x - codeObjectDelta.x, mermaidDelta.y - codeObjectDelta.y)
    })
  )
  expect(samples.length).toBeGreaterThan(3)
  expect(Math.max(...displacements)).toBeGreaterThan(100)
  expect(displacements.some((distance) => distance > 1 && distance < 100)).toBe(true)
  expect(maximumDrift).toBeLessThan(1)
  expect(
    await Promise.all([
      mermaidOverlay.getAttribute('style'),
      codeObjectOverlay.getAttribute('style')
    ])
  ).toEqual(objectStylesBeforePan)
})

test('keeps Mermaid on the shared presentation frame while zooming', async ({ page }) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await insertMermaid(page)
  await canvas.waitForRender()

  const immediate = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const overlay = document.querySelector('[data-test-id="mermaid-svg-object"]')
    const ownerId = store ? [...store.state.selectedIds][0] : undefined
    const owner = ownerId ? store?.graph.getNode(ownerId) : undefined
    if (!store || !overlay || !owner) throw new Error('Expected rendered Mermaid owner')

    const sample = () => {
      const box = overlay.getBoundingClientRect()
      return {
        box: { height: box.height, width: box.width, x: box.x, y: box.y },
        geometry: { height: owner.height, width: owner.width, x: owner.x, y: owner.y }
      }
    }

    const before = sample()
    store.setZoomAroundPoint(store.state.zoom * 1.5, 0, 0)
    return { before, afterZoomRequest: sample() }
  })

  expect(immediate.afterZoomRequest.box).toEqual(immediate.before.box)
  expect(immediate.afterZoomRequest.geometry).toEqual(immediate.before.geometry)

  await canvas.waitForRender()
  const presented = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const overlay = document.querySelector('[data-test-id="mermaid-svg-object"]')
    const ownerId = store ? [...store.state.selectedIds][0] : undefined
    const owner = ownerId ? store?.graph.getNode(ownerId) : undefined
    if (!overlay || !owner) throw new Error('Expected presented Mermaid owner')
    const box = overlay.getBoundingClientRect()
    return {
      box: { height: box.height, width: box.width, x: box.x, y: box.y },
      geometry: { height: owner.height, width: owner.width, x: owner.x, y: owner.y }
    }
  })

  expect(presented.geometry).toEqual(immediate.before.geometry)
  expect(
    Math.hypot(presented.box.x - immediate.before.box.x, presented.box.y - immediate.before.box.y)
  ).toBeGreaterThan(20)
  expect(presented.box.width).toBeGreaterThan(immediate.before.box.width)
  expect(presented.box.height).toBeGreaterThan(immediate.before.box.height)
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
