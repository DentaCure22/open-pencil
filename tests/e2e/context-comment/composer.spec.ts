import { expect, test, type Page } from '@playwright/test'

import type { Vector } from '@open-pencil/scene-graph/primitives'

import { CanvasHelper } from '#tests/helpers/canvas'

let page: Page
let canvas: CanvasHelper
let workerDispatch: { evidenceId?: string; prompt?: string } | null = null

function contextualDispatchBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    ...('evidenceId' in value && typeof value.evidenceId === 'string'
      ? { evidenceId: value.evidenceId }
      : {}),
    ...('prompt' in value && typeof value.prompt === 'string' ? { prompt: value.prompt } : {})
  }
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.route('http://127.0.0.1:7602/agent-router/v1/pi/models', (route) =>
    route.fulfill({
      body: JSON.stringify({
        models: [
          {
            defaultEffort: 'high',
            efforts: ['low', 'medium', 'high', 'xhigh'],
            group: 'xAI',
            id: 'xai-auth/grok-4.6',
            label: 'Grok 4.6'
          },
          {
            defaultEffort: 'high',
            efforts: ['low', 'medium', 'high', 'xhigh'],
            group: 'OpenAI',
            id: 'openai-codex/gpt-5.6-sol',
            label: 'GPT-5.6-Sol'
          }
        ]
      }),
      contentType: 'application/json'
    })
  )
  await page.route('http://127.0.0.1:7602/agent-router/v1/pi/dispatch', async (route) => {
    workerDispatch = contextualDispatchBody(route.request().postDataJSON())
    await route.fulfill({
      body: JSON.stringify({
        dispatchedAt: new Date().toISOString(),
        jobId: 'context-comment-job',
        state: 'running',
        threadId: 'context-comment-worker'
      }),
      contentType: 'application/json',
      status: 202
    })
  })
  await page.addInitScript(() => {
    let displayMediaRequests = 0
    const getDisplayMedia = async () => {
      displayMediaRequests += 1
      throw new Error('Context comments must not request browser display capture')
    }
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
      configurable: true,
      value: getDisplayMedia
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

async function captureRegion(from: Vector, to: Vector) {
  const overlay = page.getByTestId('context-comment-crop-overlay')
  await expect(overlay).toBeVisible()
  const bounds = await overlay.boundingBox()
  if (!bounds) throw new Error('Context comment crop overlay is unavailable')
  await overlay.dispatchEvent('pointerdown', {
    button: 0,
    clientX: bounds.x + from.x,
    clientY: bounds.y + from.y,
    pointerId: 1
  })
  await overlay.dispatchEvent('pointermove', {
    button: 0,
    clientX: bounds.x + to.x,
    clientY: bounds.y + to.y,
    pointerId: 1
  })
  await overlay.dispatchEvent('pointerup', {
    button: 0,
    clientX: bounds.x + to.x,
    clientY: bounds.y + to.y,
    pointerId: 1
  })
}

async function addScreenshotComment(x: number, y: number, comment: string) {
  const screenshot = page.getByTestId('context-comment-capture-image')
  const bounds = await screenshot.boundingBox()
  if (!bounds) throw new Error('Captured screenshot is unavailable')
  await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y)
  const editor = page.getByTestId('context-comment-annotation-editor')
  await expect(editor).toBeVisible()
  await expect(editor.getByTestId('context-comment-annotation-anchor')).toBeVisible()
  const input = editor.getByRole('textbox')
  await input.fill(comment)
  await input.press('Enter')
}

test('sends multiple comments on a cropped Board screenshot to Pi', async () => {
  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const rectangleId = store.createShape(
      'RECTANGLE',
      260,
      180,
      180,
      120,
      store.state.currentPageId
    )
    store.graph.updateNode(rectangleId, {
      fills: [
        {
          color: { a: 1, b: 86 / 255, g: 52 / 255, r: 18 / 255 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ],
      name: 'Rectangle'
    })
    store.select([rectangleId])
    store.requestRender()
  })
  await page.getByTestId('context-comment-tool').click()

  await captureRegion({ x: 240, y: 160 }, { x: 470, y: 330 })
  const editor = page.getByTestId('context-comment-screenshot-editor')
  await expect(editor).toBeVisible({ timeout: 10_000 })
  await expect(editor.getByRole('toolbar', { name: 'Screenshot tools' })).toBeVisible()
  const capturedColor = await page
    .getByTestId('context-comment-capture-image')
    .evaluate((captured) => {
      if (!(captured instanceof HTMLImageElement)) return []
      const sample = document.createElement('canvas')
      sample.width = 1
      sample.height = 1
      const context = sample.getContext('2d')
      if (!context) return []
      context.drawImage(
        captured,
        Math.floor(captured.naturalWidth / 2),
        Math.floor(captured.naturalHeight / 2),
        1,
        1,
        0,
        0,
        1,
        1
      )
      return [...context.getImageData(0, 0, 1, 1).data]
    })
  expect(capturedColor).toHaveLength(4)
  expect(capturedColor[3]).toBe(255)
  expect(capturedColor[2]).toBeGreaterThan(capturedColor[0] ?? 0)
  await addScreenshotComment(0.474, 0.222, 'remove this tag')
  await addScreenshotComment(0.23, 0.788, 'this should be shorter')
  await expect(page.getByTestId('context-comment-image-marker')).toHaveCount(2)

  const composer = page.getByTestId('context-comment-screenshot-composer')
  await expect(composer.getByTestId('agent-model-trigger')).toBeVisible()
  await composer
    .getByTestId('context-comment-input')
    .fill('Tighten this card and align its contents.')
  await composer.getByTestId('context-comment-send').click()
  await expect(editor).toBeHidden()

  await expect.poll(() => workerDispatch).not.toBeNull()
  expect(workerDispatch?.evidenceId).toBeTruthy()
  const submitted = String(workerDispatch?.prompt ?? '')
  expect(submitted).toContain('Image 1:')
  expect(submitted).toMatch(/1\. \(x: \d+(?:\.\d)?%, y: \d+(?:\.\d)?%\) remove this tag/)
  expect(submitted).toMatch(/2\. \(x: \d+(?:\.\d)?%, y: \d+(?:\.\d)?%\) this should be shorter/)
  expect(submitted).toContain('Additional instructions:\nTighten this card and align its contents.')
  expect(submitted).toContain('Board context:')
  expect(submitted).toContain('Crop (page space):')
  expect(submitted).toContain('Comment points (page space):')
  expect(submitted).toContain('Source: scene-node "Rectangle"')
  expect(submitted).toContain('Board anchor:')
  expect(submitted).toContain('Object anchor:')
  expect(submitted).toContain('Target: Rectangle')
  expect(submitted).toContain('Path: Document / Page 1 / Rectangle')
})

test('switches the context comment composer to another Pi model', async () => {
  await page.getByTestId('context-comment-tool').click()
  await captureRegion({ x: 260, y: 180 }, { x: 440, y: 300 })
  const composer = page.getByTestId('context-comment-screenshot-composer')
  await expect(composer).toBeVisible({ timeout: 10_000 })
  await composer.getByTestId('agent-model-trigger').click()
  await page.getByRole('menuitemradio', { name: /GPT-5\.6-Sol/i }).click()
  await expect(composer.getByTestId('agent-model-trigger')).toContainText('GPT-5.6-Sol')
  await page.getByTestId('context-comment-input').fill('Use this model for the task.')
  await page.getByTestId('context-comment-send').click()
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, '__openPencilDisplayMediaRequests')))
    .toBe(0)
})
