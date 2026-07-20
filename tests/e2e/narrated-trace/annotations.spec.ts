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
  await page.addInitScript(() => {
    class MockSpeechRecognition extends EventTarget {
      continuous = false
      interimResults = false
      lang = 'en-US'
      maxAlternatives = 1
      processLocally = true
      onend: (() => void) | null = null
      onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null
      onresult: ((event: SpeechRecognitionEvent) => void) | null = null

      abort() {
        this.onend?.()
      }

      start() {
        this.dispatchEvent(new Event('start'))
      }

      stop() {
        this.onend?.()
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: MockSpeechRecognition
    })
  })
  await page.goto('/?test&no-rulers')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
})

test.afterAll(async () => {
  await page.close()
})

test('uses Focus as a one-shot marker without introducing empty-state UI', async () => {
  const area = page.getByTestId('canvas-area')
  const bounds = await area.boundingBox()
  if (!bounds) throw new Error('Canvas area is not visible')
  const focus = { x: bounds.x + bounds.width * 0.5, y: bounds.y + bounds.height * 0.45 }

  await page.getByTestId('narrated-trace-focus-tool').click()
  await expect(page.getByTestId('html-first-canvas-welcome')).toHaveCount(0)
  await page.mouse.move(focus.x, focus.y)
  await page.mouse.down()
  await expect(page.getByTestId('narrated-trace-focus-core')).toHaveAttribute('r', '7')
  await page.mouse.up()

  await expect(page.getByTestId('narrated-trace-annotation-overlay')).toHaveAttribute(
    'data-tool',
    'none'
  )
  await expect(page.getByTestId('html-first-canvas-welcome')).toHaveCount(0)
})

test('uses Ink as a normal board tool without starting a trace', async () => {
  const area = page.getByTestId('canvas-area')
  const bounds = await area.boundingBox()
  if (!bounds) throw new Error('Canvas area is not visible')
  const start = { x: bounds.x + bounds.width * 0.32, y: bounds.y + bounds.height * 0.4 }

  await page.getByTestId('narrated-trace-ink-tool').click()
  await expect(page.getByTestId('narrated-trace-timer')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-annotation-overlay')).toHaveAttribute(
    'data-tool',
    'ink'
  )
  await expect(page.getByTestId('narrated-trace-annotation-done')).toHaveCount(0)

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 45, start.y + 20, { steps: 5 })
  await page.mouse.move(start.x + 90, start.y - 10, { steps: 5 })
  await page.mouse.up()

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

  await page.getByTestId('narrated-trace-ink-tool').click()
  const positionBeforeMove = await page.evaluate((nodeId) => {
    const node = nodeId ? window.openPencil?.getStore?.()?.graph.getNode(nodeId) : null
    return node ? { x: node.x, y: node.y } : null
  }, inkNode?.id)
  await page.mouse.move(start.x + 45, start.y + 20)
  await page.mouse.down()
  await page.mouse.move(start.x + 105, start.y + 60, { steps: 5 })
  await page.mouse.up()
  const positionAfterMove = await page.evaluate((nodeId) => {
    const node = nodeId ? window.openPencil?.getStore?.()?.graph.getNode(nodeId) : null
    return node ? { x: node.x, y: node.y } : null
  }, inkNode?.id)
  expect(positionAfterMove).not.toEqual(positionBeforeMove)

  await page.keyboard.press('Delete')
  const existsAfterErase = await page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    return Boolean(nodeId && store?.graph.getNode(nodeId))
  }, inkNode?.id)
  expect(existsAfterErase).toBe(false)

  await canvas.undo()
  const existsAfterUndo = await page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    return Boolean(nodeId && store?.graph.getNode(nodeId))
  }, inkNode?.id)
  expect(existsAfterUndo).toBe(true)

  await page.keyboard.press('Delete')
  const existsAfterCleanup = await page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    return Boolean(nodeId && store?.graph.getNode(nodeId))
  }, inkNode?.id)
  expect(existsAfterCleanup).toBe(false)
})

test('captures evidence only after recording is explicitly started', async () => {
  const area = page.getByTestId('canvas-area')
  const bounds = await area.boundingBox()
  if (!bounds) throw new Error('Canvas area is not visible')
  const start = { x: bounds.x + bounds.width * 0.32, y: bounds.y + bounds.height * 0.4 }

  await page.getByTestId('narrated-trace-start').click()
  await expect(page.getByTestId('narrated-trace-timer')).toBeVisible()
  await page.keyboard.press('r')

  const backgroundToggle = page.getByTestId('narrated-trace-background-toggle')
  await expect(backgroundToggle).toBeVisible()
  await backgroundToggle.click()
  await expect(page.getByTestId('narrated-trace-row-tool')).toBeVisible()
  await backgroundToggle.click()

  await page.getByTestId('narrated-trace-ink-tool').click()

  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 45, start.y + 20, { steps: 5 })
  await page.mouse.move(start.x + 90, start.y - 10, { steps: 5 })
  await page.mouse.up()

  const inkRow = page.getByTestId('narrated-trace-row-ink')
  await expect(inkRow).toContainText('Drew an editable intent stroke')
  await expect(inkRow.getByTestId('narrated-trace-evidence-image')).toBeVisible()
  await expect(inkRow.getByTestId('narrated-trace-copy-evidence')).toHaveText('Copy')
  await expect(inkRow).not.toContainText('Context snapshot')
  await expect(inkRow).not.toContainText('Canvas context')

  await page.getByTestId('narrated-trace-focus-tool').click()
  await expect(page.getByTestId('narrated-trace-annotation-overlay')).toHaveAttribute(
    'data-tool',
    'focus'
  )
  const focus = { x: start.x + 180, y: start.y + 60 }
  await page.mouse.move(focus.x, focus.y)
  await page.mouse.down()

  const focusCore = page.getByTestId('narrated-trace-focus-core').first()
  await expect(page.getByTestId('narrated-trace-focus-core')).toHaveCount(1)
  await expect(focusCore).toHaveAttribute('r', '7')
  await expect(focusCore).toHaveAttribute('stroke-width', '3')
  const focusAura = page.getByTestId('narrated-trace-focus-aura').first()
  await expect(page.getByTestId('narrated-trace-focus-aura')).toHaveCount(1)
  await expect(focusAura).toHaveAttribute('filter', 'url(#narrated-trace-focus-aura)')
  await expect(focusAura).toHaveAttribute('r', '11')

  await page.mouse.up()
  await expect(page.getByTestId('narrated-trace-annotation-overlay')).toHaveAttribute(
    'data-tool',
    'none'
  )

  const focusRow = page.getByTestId('narrated-trace-row-screenshot')
  await expect(focusRow).toContainText('Highlighted Canvas area')
  await expect(focusRow.getByTestId('narrated-trace-evidence-image')).toBeVisible()
  await expect(focusRow.getByTestId('narrated-trace-row-meta')).toContainText('crop')
  await expect(focusRow.getByTestId('narrated-trace-copy-evidence')).toHaveText('Copy')
  await expect(focusRow).not.toContainText('Context snapshot')
  await expect(focusRow).not.toContainText('Canvas context')

  await page.getByTestId('narrated-trace-panel-stop').click()
  await expect(page.getByTestId('narrated-trace-review-summary')).toHaveCount(0)
  await expect(inkRow.getByTestId('narrated-trace-evidence-toggle')).toBeVisible()
  await expect(inkRow.getByTestId('narrated-trace-copy-evidence')).toHaveCount(0)
  await inkRow.getByTestId('narrated-trace-evidence-toggle').click()
  await expect(inkRow.getByTestId('narrated-trace-copy-evidence')).toBeVisible()

  expect(pageErrors).toEqual([])
})
