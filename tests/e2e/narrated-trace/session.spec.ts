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
    class MockSpeechRecognition extends EventTarget implements SpeechRecognition {
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
        queueMicrotask(() => {
          const alternative: SpeechRecognitionAlternative = {
            confidence: 1,
            transcript: 'Move this card down'
          }
          const result: SpeechRecognitionResult = {
            0: alternative,
            isFinal: true,
            length: 1
          }
          const results: SpeechRecognitionResultList = { 0: result, length: 1 }
          const speechEvent = Object.assign(new Event('result'), { resultIndex: 0, results })
          this.onresult?.(speechEvent)
        })
      }

      stop() {
        this.onend?.()
      }
    }

    window.SpeechRecognition = MockSpeechRecognition
  })
  await page.goto('/?test&no-rulers')
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
})

test.afterAll(async () => {
  await page.close()
})

test('records, cleans, restores, and reopens one narrated timeline', async () => {
  const rectangleId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.createShape('RECTANGLE', 120, 120, 100, 80)
  })
  await canvas.waitForRender()

  await page.getByTestId('narrated-trace-start').click()
  await expect(page.getByTestId('narrated-trace-timer')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-header')).toContainText('Listening')
  const traceTitle = page.getByTestId('narrated-trace-title')
  await expect(traceTitle).toHaveValue('Narrated Session')
  await traceTitle.fill('Patient card placement')
  await page.waitForTimeout(250)
  await expect(traceTitle).toHaveValue('Patient card placement')
  await traceTitle.press('Tab')
  await expect(traceTitle).toHaveValue('Patient card placement')
  await expect(page.getByTestId('narrated-trace-panel')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-timeline')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-marker-transcript')).toHaveAttribute(
    'aria-label',
    'Spoken note'
  )
  await expect(
    page.getByTestId('narrated-trace-row-transcript').getByLabel('Edit transcript segment')
  ).toHaveValue('Move this card down')
  await expect(page.getByTestId('narrated-trace-row-transcript')).toContainText('00:00')

  await page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.clearSelection()
    store.select([nodeId])
  }, rectangleId)
  const selectionRow = page.getByTestId('narrated-trace-row-selection')
  await expect(selectionRow.getByTestId('narrated-trace-row-title')).toHaveText('Rectangle')
  await expect(selectionRow.getByTestId('narrated-trace-row-action')).toHaveText('Selected')
  await expect(page.getByTestId('narrated-trace-marker-selection')).toHaveAttribute(
    'aria-label',
    'Selection changed'
  )

  await page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.updateNode(nodeId, { width: 3274.3652377032345 })
  }, rectangleId)
  const editRow = page.getByTestId('narrated-trace-row-edit')
  await expect(editRow.getByTestId('narrated-trace-row-title')).toHaveText('Rectangle')
  await expect(editRow.getByTestId('narrated-trace-row-action')).toHaveText('Edited')
  await expect(editRow.getByTestId('narrated-trace-row-meta')).toHaveText('Width 100 → 3,274.37')

  await page.getByTestId('narrated-trace-panel-stop').click()
  await expect(page.getByTestId('narrated-trace-review-state')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-new-session')).toHaveAttribute(
    'aria-label',
    'New trace'
  )
  await expect(page.getByTestId('narrated-trace-header')).not.toContainText('key moments')
  await expect(page.getByTestId('narrated-trace-review-summary')).toHaveCount(0)
  await expect(selectionRow).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-background-toggle')).toContainText(
    'Selection and canvas activity · 1'
  )
  await page.getByTestId('narrated-trace-background-toggle').click()
  await expect(selectionRow).toBeVisible()
  await page.getByTestId('narrated-trace-background-toggle').click()

  const transcriptRow = page.getByTestId('narrated-trace-row-transcript')
  const transcriptEditor = transcriptRow.getByLabel('Edit transcript segment')
  await transcriptEditor.fill('Move the patient card down 24 pixels')
  await transcriptEditor.press('Tab')

  await transcriptRow.getByRole('button', { name: 'Add clarification' }).click()
  const clarification = transcriptRow.getByRole('textbox', { name: 'Add clarification' })
  await clarification.fill('Keep the alignment with the chart.')
  await clarification.press('Tab')
  await transcriptRow.getByRole('button', { name: 'Edit clarification' }).click()

  await transcriptRow.getByTestId('narrated-trace-row-remove').click()
  await expect(page.getByTestId('narrated-trace-removed-toggle')).toContainText('1 removed')

  await page.getByTestId('narrated-trace-removed-toggle').click()
  await page.getByTestId('narrated-trace-row-restore').click()
  await expect(
    page.getByTestId('narrated-trace-row-transcript').getByLabel('Edit transcript segment')
  ).toHaveValue('Move the patient card down 24 pixels')

  await expect(page.getByTestId('narrated-trace-preview-toggle')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-context-preview')).toHaveCount(0)
  await expect(
    page.getByTestId('narrated-trace-timeline').getByLabel('Edit transcript segment')
  ).toHaveValue('Move the patient card down 24 pixels')
  await expect(page.getByTestId('narrated-trace-timeline')).toContainText(
    'Keep the alignment with the chart.'
  )
  await expect(page.getByTestId('narrated-trace-copy-context')).toBeEnabled()

  await page.getByTestId('narrated-trace-history-toggle').click()
  await expect(page.getByTestId('narrated-trace-history')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-header')).toContainText('History')
  await expect(page.getByTestId('narrated-trace-header')).not.toContainText('1 trace')
  await expect(page.getByTestId('narrated-trace-review-state')).not.toBeVisible()
  await expect(page.getByTestId('narrated-trace-history-toggle')).toHaveAttribute(
    'aria-label',
    'Back to trace'
  )
  await expect(page.getByTestId('narrated-trace-history-record')).toHaveCount(1)
  await expect(page.getByTestId('narrated-trace-history-record').first()).toHaveCSS(
    'margin-top',
    '8px'
  )
  await expect(page.getByLabel('Rename narrated session')).toHaveValue('Patient card placement')
  await expect(
    page.getByTestId('narrated-trace-history-meta').getByLabel('3 moments')
  ).toContainText('3')

  const savedTrace = page.getByTestId('narrated-trace-history-record')
  await savedTrace.hover()
  await savedTrace.getByRole('button', { name: 'Delete session' }).click()
  await page.mouse.move(600, 600)
  await expect(savedTrace.getByText('Delete?')).toBeVisible()
  await expect(savedTrace.getByTestId('narrated-trace-history-delete-confirm')).toBeVisible()
  await savedTrace.getByTestId('narrated-trace-history-delete-cancel').click()
  await expect(savedTrace).toHaveCount(1)
  await savedTrace.hover()
  await page.getByTestId('narrated-trace-history-resume').click()
  await expect(page.getByTestId('narrated-trace-header')).toContainText('Listening')
  await expect(page.getByTestId('narrated-trace-title')).toHaveValue('Patient card placement')
  await expect(page.getByTestId('narrated-trace-history-toggle')).toHaveAttribute(
    'aria-label',
    'Open trace history'
  )

  await page.getByTestId('narrated-trace-history-toggle').click()
  await expect(page.getByTestId('narrated-trace-history')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-history-record')).toHaveCount(1)
  await expect(page.getByTestId('narrated-trace-history-toggle')).toHaveAttribute(
    'aria-label',
    'Back to trace'
  )
  await page.getByTestId('narrated-trace-history-toggle').click()
  await expect(page.getByTestId('narrated-trace-timeline')).toBeVisible()
  await page.getByTestId('narrated-trace-new-session').click()
  await expect(page.getByTestId('narrated-trace-panel-stop')).toBeVisible()
  expect(pageErrors).toEqual([])
})
