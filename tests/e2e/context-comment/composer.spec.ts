import { expect, test, type Page } from '@playwright/test'

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
  await page.goto('/?test&no-rulers')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
})

test.afterAll(async () => {
  await page.close()
})

test('sends a selected Board comment with a cropped screenshot to Pi', async () => {
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
    store.graph.updateNode(rectangleId, { name: 'Rectangle' })
    store.select([rectangleId])
    store.requestRender()
  })
  await page.getByTestId('context-comment-tool').click()

  const composer = page.getByTestId('context-comment-composer')
  await expect(composer).toBeVisible()
  await expect(composer).toHaveAttribute('aria-label', 'Comment on Rectangle')
  await expect(page.getByTestId('context-comment-input')).toHaveAttribute('rows', '1')
  await expect(composer.getByTestId('agent-model-trigger')).toBeVisible()
  await expect(page.getByTestId('context-comment-dictation')).toBeVisible()
  await expect(page.getByTestId('context-comment-send')).toHaveCount(0)
  await page.getByTestId('context-comment-input').fill('Tighten this card and align its contents.')
  await expect(page.getByTestId('context-comment-dictation')).toHaveCount(0)
  await expect(page.getByTestId('context-comment-send')).toBeVisible()

  await page.getByTestId('context-comment-capture').click()
  const overlay = page.getByTestId('context-comment-crop-overlay')
  await expect(overlay).toBeVisible()
  const bounds = await overlay.boundingBox()
  if (!bounds) throw new Error('Context comment crop overlay is unavailable')
  await overlay.dispatchEvent('pointerdown', {
    button: 0,
    clientX: bounds.x + 240,
    clientY: bounds.y + 160,
    pointerId: 1
  })
  await overlay.dispatchEvent('pointermove', {
    button: 0,
    clientX: bounds.x + 470,
    clientY: bounds.y + 330,
    pointerId: 1
  })
  await overlay.dispatchEvent('pointerup', {
    button: 0,
    clientX: bounds.x + 470,
    clientY: bounds.y + 330,
    pointerId: 1
  })

  await expect(page.getByTestId('context-comment-capture-preview')).toBeVisible({ timeout: 10_000 })
  await page.getByTestId('context-comment-input').press('Enter')
  await expect(composer).toBeHidden()

  await expect.poll(() => workerDispatch).not.toBeNull()
  expect(workerDispatch?.evidenceId).toBeTruthy()
  const submitted = String(workerDispatch?.prompt ?? '')
  expect(submitted).toContain('Tighten this card and align its contents.')
  expect(submitted).toContain('Target: Rectangle')
  expect(submitted).toContain('Path: Document / Page 1 / Rectangle')
})

test('switches the context comment composer to another Pi model', async () => {
  await page.getByTestId('context-comment-tool').click()
  const composer = page.getByTestId('context-comment-composer')
  await composer.getByTestId('agent-model-trigger').click()
  await page.getByRole('menuitemradio', { name: /GPT-5\.6-Sol/i }).click()
  await expect(composer.getByTestId('agent-model-trigger')).toContainText('GPT-5.6-Sol')
  await page.getByTestId('context-comment-input').fill('Use this model for the task.')
  await page.getByTestId('context-comment-send').click()
})
