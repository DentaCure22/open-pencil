import type { Browser, Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'
import { readNarratedTraceEvidencePixels } from '#tests/helpers/narrated-trace'
import { toolbarToolTestId } from '#tests/helpers/test-ids'

let page: Page
let canvas: CanvasHelper
const pageErrors: Error[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage()
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.addInitScript(() => {
    let displayMediaRequests = 0
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: async () => {
        displayMediaRequests += 1
        throw new Error('Narrated Trace must not request browser display capture')
      }
    })
    Object.defineProperty(window, '__openPencilDisplayMediaRequests', {
      configurable: true,
      get: () => displayMediaRequests
    })
  })
  await page.goto('/?test&no-rulers')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
})

test.afterAll(async () => {
  await page.close()
})

test('shows page coordinates and captures an intentional blank-canvas Focus', async () => {
  const area = page.getByTestId('canvas-area')
  const bounds = await area.boundingBox()
  if (!bounds) throw new Error('Canvas area is not visible')
  const focus = { x: bounds.x + 520, y: bounds.y + 160 }

  await page.getByTestId('narrated-trace-focus-tool').click()
  await page.mouse.move(focus.x, focus.y)
  await page.mouse.down()
  await page.mouse.up()

  await page.getByTestId('left-panel-trace-tab').click()
  const row = page.getByTestId('narrated-trace-row-screenshot')
  await expect(row).toHaveCount(1)
  await expect(row.getByTestId('narrated-trace-row-title')).toHaveText('Canvas area')
  const expectedCoordinates = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const point = store.screenToCanvas(520, 160)
    const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })
    return `x ${format(point.x)} · y ${format(point.y)}`
  })
  await expect(row.getByTestId('narrated-trace-row-coordinates')).toHaveText(expectedCoordinates)
  const evidence = row.getByTestId('narrated-trace-evidence-image')
  await expect(evidence).toBeVisible()
  await expect(evidence).toHaveAttribute('data-evidence-source', 'canvas')
  const pixels = await readNarratedTraceEvidencePixels(evidence)
  expect(pixels.nonWhite).toBeGreaterThan(100)
  expect(pixels.violet).toBeGreaterThan(5)
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__openPencilDisplayMediaRequests')))
    .toBe(0)
  await expect(row.getByTestId('narrated-trace-evidence-status')).toHaveCount(0)
  await page.getByTestId('narrated-trace-evidence-overview-trigger').click()
  const overview = page.getByTestId('narrated-trace-evidence-overview')
  await expect(overview).toBeVisible()
  await expect(overview).toContainText('Evidence buffer')
  await expect(overview).toContainText('/ 100')
  await expect(overview).toContainText('/ 250 MB')
  await expect(overview).toContainText('captures')
  await expect(page.getByTestId('narrated-trace-evidence-capacity')).toBeVisible()
  await page.keyboard.press('Escape')

  await page.evaluate(async () => {
    const { narratedTraceSession, removeNarratedTraceRecord } =
      await import('/src/app/narrated-trace/state.ts')
    const sessionId = narratedTraceSession.value?.id
    if (sessionId) await removeNarratedTraceRecord(sessionId)
  })
  await expect(row).toHaveCount(0)
})

test('keeps Focus active and adds one completed gesture to the unified History feed', async () => {
  const area = page.getByTestId('canvas-area')
  const bounds = await area.boundingBox()
  if (!bounds) throw new Error('Canvas area is not visible')
  await canvas.drawRect(300, 200, 140, 100)
  const focus = { x: bounds.x + 370, y: bounds.y + 250 }

  await page.getByTestId('narrated-trace-focus-tool').click()
  await page.mouse.move(focus.x, focus.y)
  await page.mouse.down()
  await expect(page.getByTestId('narrated-trace-focus-core')).toHaveAttribute('r', '7')
  await page.mouse.up()

  await page.getByTestId('left-panel-trace-tab').click()
  await expect(page.getByTestId('narrated-trace-history')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-activity-feed')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-row-screenshot')).toHaveCount(1)
  const evidence = page
    .getByTestId('narrated-trace-row-screenshot')
    .getByTestId('narrated-trace-evidence-image')
  await expect(evidence).toBeVisible()
  await expect(evidence).toHaveAttribute('data-evidence-source', 'canvas')
  const pixels = await readNarratedTraceEvidencePixels(evidence)
  expect(pixels.nonWhite).toBeGreaterThan(100)
  expect(pixels.violet).toBeGreaterThan(5)
  await expect(
    page.getByTestId('narrated-trace-row-screenshot').getByTestId('narrated-trace-evidence-status')
  ).toHaveCount(0)
  const anchorProof = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { narratedTraceScopeForStore } = await import('/src/app/narrated-trace/scope.ts')
    const { getNarratedTraceGesture } = await import('/src/app/narrated-trace/gesture.ts')
    const { queryNarratedTraceHistory } = await import('/src/app/narrated-trace/query.ts')
    await new Promise((resolve) => {
      setTimeout(resolve, 250)
    })
    const result = await queryNarratedTraceHistory({
      query: 'Highlighted Rectangle',
      scope: narratedTraceScopeForStore(store)
    })
    const focusEvent = result.matches
      .flatMap((match) => match.events)
      .find((event) => event.kind === 'screenshot')
    const gesture = await getNarratedTraceGesture({ includeImage: false, latest: true })
    return {
      anchor: focusEvent?.anchor,
      expectedPoint: store.screenToCanvas(370, 250),
      gesture: gesture.gesture,
      gestureStatus: gesture.status,
      status: result.status
    }
  })
  expect(anchorProof.status).toBe('matched')
  expect(anchorProof.anchor?.pagePoint.x).toBeCloseTo(anchorProof.expectedPoint.x, 4)
  expect(anchorProof.anchor?.pagePoint.y).toBeCloseTo(anchorProof.expectedPoint.y, 4)
  expect(anchorProof.anchor?.pageRegion.width).toBeGreaterThan(0)
  expect(anchorProof.anchor?.pageRegion.height).toBeGreaterThan(0)
  expect(anchorProof.anchor?.targetRelativePoint?.x).toBeCloseTo(0.5, 1)
  expect(anchorProof.anchor?.targetRelativePoint?.y).toBeCloseTo(0.5, 1)
  expect(anchorProof.anchor?.viewport.zoom).toBeGreaterThan(0)
  expect(anchorProof.gestureStatus).toBe('matched')
  expect(anchorProof.gesture?.boardOrigin.documentId).toBeTruthy()
  expect(anchorProof.gesture?.boardOrigin.runtimeInstanceId).toBeTruthy()
  expect(anchorProof.gesture?.candidates.items).toContainEqual(
    expect.objectContaining({ stableId: anchorProof.gesture?.target?.stableId })
  )
  expect(anchorProof.gesture?.geometry.pageRegion).toEqual(anchorProof.anchor?.pageRegion)
  expect(anchorProof.gesture?.evidence?.cropBounds.width).toBeLessThan(140)
  await expect(page.getByTestId('narrated-trace-history-toggle')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-timeline')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-annotation-overlay')).toHaveAttribute(
    'data-tool',
    'focus'
  )

  await page.waitForTimeout(1300)
  await page.getByTestId(toolbarToolTestId('SELECT')).click()
  const selectionClick = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const area = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
    const canvasElement = document.querySelector<HTMLElement>('[data-test-id="canvas-element"]')
    if (!store || !area || !canvasElement) {
      throw new Error('Rectangle selection fixture is unavailable')
    }
    const rectangleId = store.createShape('RECTANGLE', 520, 200, 100, 100)
    store.updateNode(rectangleId, { name: 'Click anchor target' })
    const rectangle = store.graph.getNode(rectangleId)
    if (!rectangle) throw new Error('Click anchor target was not created')
    store.clearSelection()
    const bounds = store.graph.getAbsoluteBounds(rectangle.id)
    const pagePoint = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    }
    const areaBounds = area.getBoundingClientRect()
    const canvasBounds = canvasElement.getBoundingClientRect()
    return {
      areaPoint: {
        x: canvasBounds.left - areaBounds.left + pagePoint.x * store.state.zoom + store.state.panX,
        y: canvasBounds.top - areaBounds.top + pagePoint.y * store.state.zoom + store.state.panY
      },
      pagePoint,
      targetId: rectangle.id
    }
  })
  await page.waitForTimeout(1300)
  await canvas.click(selectionClick.areaPoint.x, selectionClick.areaPoint.y)
  await page.waitForTimeout(1200)
  const selectionAnchorProof = await page.evaluate(
    async ({ expectedPoint, targetId }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const { narratedTraceScopeForStore } = await import('/src/app/narrated-trace/scope.ts')
      const { queryNarratedTraceHistory } = await import('/src/app/narrated-trace/query.ts')
      const result = await queryNarratedTraceHistory({
        query: 'Click anchor target',
        scope: narratedTraceScopeForStore(store),
        selectionIds: [targetId]
      })
      const selectionEvent = result.matches
        .flatMap((match) => match.events)
        .find((event) => event.kind === 'selection' && event.target?.stableId === targetId)
      return {
        anchor: selectionEvent?.anchor,
        expectedPoint,
        status: result.status
      }
    },
    {
      expectedPoint: selectionClick.pagePoint,
      targetId: selectionClick.targetId
    }
  )
  expect(selectionAnchorProof.status).toBe('matched')
  expect(selectionAnchorProof.anchor?.pagePoint.x).toBeCloseTo(
    selectionAnchorProof.expectedPoint.x,
    4
  )
  expect(selectionAnchorProof.anchor?.pagePoint.y).toBeCloseTo(
    selectionAnchorProof.expectedPoint.y,
    4
  )
  expect(selectionAnchorProof.anchor?.targetRelativePoint?.x).toBeCloseTo(0.5, 1)
  expect(selectionAnchorProof.anchor?.targetRelativePoint?.y).toBeCloseTo(0.5, 1)
})

test('keeps Ink active and creates an editable canvas stroke without duplicate History rows', async () => {
  const area = page.getByTestId('canvas-area')
  const bounds = await area.boundingBox()
  if (!bounds) throw new Error('Canvas area is not visible')
  const start = { x: bounds.x + bounds.width * 0.32, y: bounds.y + bounds.height * 0.4 }

  await page.getByTestId('narrated-trace-ink-tool').click()
  await expect(page.getByTestId('narrated-trace-annotation-overlay')).toHaveAttribute(
    'data-tool',
    'ink'
  )

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 45, start.y + 20, { steps: 5 })
  await page.mouse.move(start.x + 90, start.y - 10, { steps: 5 })
  await page.mouse.up()

  await expect(page.getByTestId('narrated-trace-annotation-overlay')).toHaveAttribute(
    'data-tool',
    'ink'
  )
  await expect(page.getByTestId('narrated-trace-row-ink')).toHaveCount(1)
  await expect(page.getByTestId('narrated-trace-row-ink')).toContainText('Intent drawing')
  await expect(page.getByTestId('narrated-trace-timer')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-panel-start')).toHaveCount(0)

  const inkNode = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const node = [...store.graph.nodes.values()].find((candidate) =>
      candidate.pluginData.some(
        (entry) =>
          entry.pluginId === 'open-pencil.narrated-trace' &&
          entry.key === 'kind' &&
          entry.value === 'canvas-ink'
      )
    )
    return node
      ? {
          activeTool: store.state.activeTool,
          id: node.id,
          selected: store.state.selectedIds.has(node.id),
          type: node.type,
          vertices: node.vectorNetwork?.vertices.length ?? 0
        }
      : null
  })
  expect(inkNode).toMatchObject({ activeTool: 'SELECT', selected: true, type: 'VECTOR' })
  expect(inkNode?.vertices).toBeGreaterThan(2)
  expect(pageErrors).toEqual([])
})
