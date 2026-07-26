import type { Browser, Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

let page: Page
let canvas: CanvasHelper
const pageErrors: Error[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  page = await browser.newPage()
  page.on('pageerror', (error) => pageErrors.push(error))
  await page.goto('/?test&no-rulers')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('left-panel-trace-tab').click()
})

test.afterAll(async () => {
  await page.close()
})

test('records bounded semantic editor actions and restores one unified History feed', async () => {
  await expect(page.getByTestId('narrated-trace-history')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-history-toggle')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-timeline')).toHaveCount(0)

  const rectangleId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setTool('RECTANGLE')
    const createdId = store.createShape('RECTANGLE', 120, 120, 100, 80)
    const created = store.graph.getNode(createdId)
    if (!created) throw new Error('Rectangle was not created')
    store.clearSelection()
    store.select([created.id])
    return created.id
  })
  await page.waitForTimeout(1300)

  await expect(page.getByTestId('narrated-trace-row-shape')).toHaveCount(1)
  await expect(page.getByTestId('narrated-trace-row-shape')).toContainText('Rectangle')
  await expect(page.getByTestId('narrated-trace-row-selection')).toContainText('Rectangle')
  await expect(page.getByTestId('narrated-trace-row-tool')).toBeVisible()

  await page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.updateNode(nodeId, { height: 90, width: 140, x: 135, y: 130 })
    store.updateNode(nodeId, { height: 105, width: 180, x: 150, y: 145 })
    store.updateNode(nodeId, { height: 120, width: 220, x: 165, y: 160 })
  }, rectangleId)
  await page.waitForTimeout(800)

  const transformRow = page.getByTestId('narrated-trace-row-edit').first()
  await expect(transformRow).toContainText('Rectangle')
  await expect(transformRow.getByTestId('narrated-trace-row-action')).toHaveText('Edited')
  await expect(transformRow).toContainText('4 changes')

  await page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.updateNode(nodeId, {
      cornerRadius: 18,
      fills: [
        {
          color: { a: 1, b: 0.86, g: 0.44, r: 0.18 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ]
    })
  }, rectangleId)
  await page.waitForTimeout(800)
  await expect(page.getByTestId('narrated-trace-row-edit')).toHaveCount(2)

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.clearSelection()
    const backgroundId = store.createShape('RECTANGLE', 20, 20, 20, 20)
    store.updateNode(backgroundId, { width: 24 })
  })
  await page.waitForTimeout(1300)
  await expect(page.getByTestId('narrated-trace-row-shape')).toHaveCount(1)
  await expect(page.getByTestId('narrated-trace-row-edit')).toHaveCount(2)

  const queryProof = await page.evaluate(async (targetId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { narratedTraceScopeForStore } = await import('/src/app/narrated-trace/scope.ts')
    const { queryNarratedTraceHistory } = await import('/src/app/narrated-trace/query.ts')
    await new Promise((resolve) => {
      setTimeout(resolve, 1200)
    })
    const scope = narratedTraceScopeForStore(store)
    const result = await queryNarratedTraceHistory({
      limit: 3,
      query: 'Rectangle width corner radius',
      scope,
      selectionIds: [targetId]
    })
    return {
      eventKinds: result.matches[0]?.events.map((event) => event.kind) ?? [],
      matchedBy: result.matches[0]?.matchedBy ?? [],
      resultCount: result.matches.length,
      scannedSessions: result.scanned.sessions,
      scope,
      status: result.status
    }
  }, rectangleId)
  expect(queryProof).toMatchObject({
    matchedBy: expect.arrayContaining(['selection']),
    status: 'matched'
  })
  expect(queryProof.eventKinds).toContain('edit')
  expect(queryProof.resultCount).toBeLessThanOrEqual(3)
  expect(queryProof.scannedSessions).toBeLessThanOrEqual(12)
  expect(queryProof.scope.documentId).toBeTruthy()
  expect(queryProof.scope.pageId).toBeTruthy()

  await page.reload()
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('left-panel-trace-tab').click()
  await expect(page.getByTestId('narrated-trace-activity-feed')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-row-shape')).toHaveCount(1)
  await expect(page.getByTestId('narrated-trace-row-edit')).toHaveCount(2)
  expect(pageErrors).toEqual([])
})
