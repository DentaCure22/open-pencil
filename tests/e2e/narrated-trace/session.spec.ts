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
  const runId = crypto.randomUUID().slice(0, 8)
  const backgroundName = `Trace E2E background ${runId}`
  const rectangleName = `Trace E2E rectangle ${runId}`
  await expect(page.getByTestId('narrated-trace-history')).toBeVisible()
  await expect(page.getByTestId('narrated-trace-history-toggle')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-timeline')).toHaveCount(0)

  const rectangleId = await page.evaluate((name) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setTool('RECTANGLE')
    const createdId = store.createShape('RECTANGLE', 120, 120, 100, 80)
    const created = store.graph.getNode(createdId)
    if (!created) throw new Error('Rectangle was not created')
    store.graph.updateNode(created.id, { name })
    store.clearSelection()
    store.select([created.id])
    return created.id
  }, rectangleName)
  await page.waitForTimeout(1300)

  const rectangleShapeRow = page
    .getByTestId('narrated-trace-row-shape')
    .filter({ hasText: rectangleName })
  const rectangleSelectionRow = page
    .getByTestId('narrated-trace-row-selection')
    .filter({ hasText: rectangleName })
  await expect(rectangleShapeRow).toHaveCount(1)
  await expect(rectangleSelectionRow).toHaveCount(1)
  await expect(
    page.getByTestId('narrated-trace-row-tool').filter({ hasText: 'Activated RECTANGLE' })
  ).toHaveCount(1)

  await page.evaluate((nodeId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.updateNode(nodeId, { height: 90, width: 140, x: 135, y: 130 })
    store.updateNode(nodeId, { height: 105, width: 180, x: 150, y: 145 })
    store.updateNode(nodeId, { height: 120, width: 220, x: 165, y: 160 })
  }, rectangleId)
  await page.waitForTimeout(800)

  const rectangleEditRows = page
    .getByTestId('narrated-trace-row-edit')
    .filter({ hasText: rectangleName })
  const transformRow = rectangleEditRows.first()
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
  await expect(rectangleEditRows).toHaveCount(2)

  await page.evaluate((name) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.clearSelection()
    const backgroundId = store.createShape('RECTANGLE', 20, 20, 20, 20)
    store.graph.updateNode(backgroundId, { name, width: 24 })
  }, backgroundName)
  await page.waitForTimeout(1300)
  await expect(rectangleShapeRow).toHaveCount(1)
  await expect(rectangleEditRows).toHaveCount(2)
  await expect(
    page.getByTestId('narrated-trace-row-shape').filter({ hasText: backgroundName })
  ).toHaveCount(0)
  await expect(
    page.getByTestId('narrated-trace-row-edit').filter({ hasText: backgroundName })
  ).toHaveCount(0)

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
  await expect(page.getByTestId('narrated-trace-retrieval-result')).toHaveAttribute(
    'data-status',
    'matched'
  )
  await expect(page.getByTestId('narrated-trace-retrieval-detail')).toContainText('exact Board')
  await expect(page.getByTestId('narrated-trace-retrieval-scope')).toContainText(
    queryProof.scope.pageName ?? queryProof.scope.pageId
  )

  const readPersistedRectangleKinds = () =>
    page.evaluate(async (name) => {
      const { loadNarratedTraceActivityFeed } = await import('/src/app/narrated-trace/history.ts')
      const items = await loadNarratedTraceActivityFeed({ itemLimit: 80 })
      return items.filter((item) => item.event.target?.name === name).map((item) => item.event.kind)
    }, rectangleName)
  await expect.poll(readPersistedRectangleKinds, { timeout: 10_000 }).toContain('shape')
  const persistedRectangleKinds = await readPersistedRectangleKinds()
  expect(persistedRectangleKinds.filter((kind) => kind === 'edit')).toHaveLength(2)

  await page.reload()
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await page.getByTestId('left-panel-trace-tab').click()
  await expect(page.getByTestId('narrated-trace-activity-feed')).toBeVisible()
  await expect(
    page.getByTestId('narrated-trace-row-shape').filter({ hasText: rectangleName })
  ).toHaveCount(1)
  await expect(
    page.getByTestId('narrated-trace-row-edit').filter({ hasText: rectangleName })
  ).toHaveCount(2)
  expect(pageErrors).toEqual([])
})

test('keeps a pinned mic session on for multiple Trace turns until explicit stop', async () => {
  await page.evaluate(() => {
    class FakeSpeechRecognition extends EventTarget implements SpeechRecognition {
      static async available(): Promise<SpeechRecognitionAvailability> {
        return 'unavailable'
      }

      continuous = false
      interimResults = false
      lang = ''
      maxAlternatives = 1
      processLocally = false
      onend: (() => void) | null = null
      onerror: ((event: SpeechRecognitionErrorEvent) => void) | null = null
      onresult: ((event: SpeechRecognitionEvent) => void) | null = null
      private startCount = 0

      abort() {
        this.onend?.()
      }

      start() {
        this.startCount += 1
        this.dispatchEvent(new Event('speechstart'))
        if (this.startCount > 1) {
          setTimeout(() => {
            const result = {
              0: { confidence: 1, transcript: 'Now I am showing the chart controls' },
              isFinal: false,
              length: 1
            } as SpeechRecognitionResult
            this.onresult?.({
              resultIndex: 0,
              results: { 0: result, length: 1 }
            } as SpeechRecognitionEvent)
          }, 100)
          setTimeout(() => {
            const result = {
              0: { confidence: 1, transcript: 'Now I am showing the chart controls' },
              isFinal: true,
              length: 1
            } as SpeechRecognitionResult
            this.onresult?.({
              resultIndex: 0,
              results: { 0: result, length: 1 }
            } as SpeechRecognitionEvent)
          }, 700)
          return
        }
        setTimeout(() => {
          const result = {
            0: { confidence: 1, transcript: 'The selected card feels crowded' },
            isFinal: true,
            length: 1
          } as SpeechRecognitionResult
          this.onresult?.({
            resultIndex: 0,
            results: { 0: result, length: 1 }
          } as SpeechRecognitionEvent)
        }, 250)
        setTimeout(() => this.onend?.(), 300)
      }

      stop() {
        setTimeout(() => this.onend?.(), 0)
      }
    }

    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition
    })
  })
  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { OPENPENCIL_WORKSPACE_DOCUMENT_NAME, stampOpenPencilWorkspaceIdentity } =
      await import('/src/app/workspace-document/identity.ts')
    stampOpenPencilWorkspaceIdentity(store.graph, {
      documentId: 'document-trace-mic-test',
      documentName: OPENPENCIL_WORKSPACE_DOCUMENT_NAME,
      roomId: 'workspace-room-trace-mic-test',
      schemaVersion: 1,
      workspaceId: 'workspace-trace-mic-test'
    })
  })

  await page.getByTestId('left-panel-trace-tab').click()
  await page.getByTestId('narrated-trace-mic-toggle').click()

  const micToggle = page.getByTestId('narrated-trace-mic-toggle')
  await expect(micToggle).toHaveAccessibleName('Microphone pinned on · recording continuously')
  await expect(micToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('narrated-trace-row-transcript')).toContainText(
    'The selected card feels crowded'
  )
  await expect(page.getByTestId('narrated-trace-mic-listening')).toBeVisible()

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setTool(store.state.activeTool === 'RECTANGLE' ? 'ELLIPSE' : 'RECTANGLE')
  })

  await expect(page.getByTestId('narrated-trace-row-transcript')).toHaveCount(2)
  await expect(
    page
      .getByTestId('narrated-trace-row-transcript')
      .filter({ hasText: 'Now I am showing the chart controls' })
  ).toHaveCount(1)
  await expect(micToggle).toHaveAccessibleName('Microphone pinned on · recording continuously')
  await expect(micToggle).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(1200)

  const queryProof = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { narratedTraceScopeForStore } = await import('/src/app/narrated-trace/scope.ts')
    const { queryNarratedTraceHistory } = await import('/src/app/narrated-trace/query.ts')
    const result = await queryNarratedTraceHistory({
      latestSpokenTurn: true,
      scope: narratedTraceScopeForStore(store)
    })
    return {
      eventKinds: result.matches.flatMap((match) => match.events.map((event) => event.kind)),
      reason: result.reason,
      sourceSpokenTurn: result.sourceSpokenTurn,
      status: result.status
    }
  })

  expect(queryProof).toMatchObject({
    eventKinds: expect.arrayContaining(['tool']),
    sourceSpokenTurn: {
      text: 'Now I am showing the chart controls'
    },
    status: 'matched'
  })
  await expect(page.getByTestId('narrated-trace-retrieval-result')).toHaveAttribute(
    'data-status',
    'matched'
  )

  await page.evaluate(async () => {
    const { narratedTraceMicTurns, pruneNarratedTraceMicTurns } =
      await import('/src/app/narrated-trace/index.ts')
    const latest = narratedTraceMicTurns.value.at(-1)
    if (!latest) throw new Error('Expected a latest spoken Trace turn')
    narratedTraceMicTurns.value = narratedTraceMicTurns.value.map((turn) =>
      turn.id === latest.id ? { ...turn, expiresAtEpochMs: Date.now() - 1 } : turn
    )
    pruneNarratedTraceMicTurns(Date.now())
  })
  await expect(page.getByTestId('narrated-trace-row-transcript')).toHaveCount(1)
  await expect(page.getByTestId('narrated-trace-retrieval-result')).toHaveCount(0)

  const remainingStatus = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { narratedTraceScopeForStore } = await import('/src/app/narrated-trace/scope.ts')
    const { queryNarratedTraceHistory } = await import('/src/app/narrated-trace/query.ts')
    const result = await queryNarratedTraceHistory({
      latestSpokenTurn: true,
      scope: narratedTraceScopeForStore(store)
    })
    return result.status
  })
  await expect(page.getByTestId('narrated-trace-retrieval-result')).toHaveAttribute(
    'data-status',
    remainingStatus
  )

  await micToggle.click()
  await expect(micToggle).toHaveAccessibleName(
    'Pin microphone on · records continuously, independent of Focus'
  )
  await expect(micToggle).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('narrated-trace-mic-clear').click()
  await expect(page.getByTestId('narrated-trace-row-transcript')).toHaveCount(0)
  await expect(page.getByTestId('narrated-trace-retrieval-result')).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
