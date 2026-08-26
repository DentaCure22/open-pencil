import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

function mockModels(page: Page) {
  return page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
    route.fulfill({
      body: JSON.stringify({
        models: [
          {
            defaultEffort: 'high',
            efforts: ['low', 'medium', 'high', 'xhigh'],
            group: 'xAI',
            id: 'xai-auth/grok-4.6',
            label: 'Grok 4.6'
          }
        ]
      }),
      contentType: 'application/json'
    })
  )
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0
}

test('keeps completed Markdown inert while the live tail streams', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  const completed = Array.from(
    { length: 60 },
    (_, index) => `## Section ${String(index + 1)}\n\nCompleted paragraph ${String(index + 1)}.`
  ).join('\n\n')
  const tokens = [
    ' keeps',
    ' growing',
    ' smoothly',
    ' while',
    ' completed',
    ' sections',
    ' remain',
    ' inert.'
  ]
  let liveTail = 'The live tail'
  let revision = 0
  let fullRequests = 0
  const transcriptRequestUrls: string[] = []
  const thread = () => ({
    canFollowUp: true,
    createdAt: '2026-08-24T17:00:00.000Z',
    effort: 'medium',
    id: 'smooth-stream-thread',
    messages: [
      {
        createdAt: '2026-08-24T17:00:00.000Z',
        id: 'smooth-stream-prompt',
        role: 'user',
        text: 'Write a long structured answer.'
      },
      {
        createdAt: '2026-08-24T17:00:01.000Z',
        id: 'smooth-stream-answer',
        role: 'assistant',
        text: `${completed}\n\n${liveTail}`
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate: liveTail,
    state: 'running',
    task: 'Smooth streaming proof',
    updatedAt: new Date(Date.UTC(2026, 7, 24, 17, 0, 1, revision)).toISOString()
  })

  await page.route(/\/agent-router\/v1\/pi\/conversations\?preview=1$/, (route) =>
    route.fulfill({
      body: JSON.stringify({ threads: [thread()] }),
      contentType: 'application/json'
    })
  )
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/smooth-stream-thread(?:\?page=1|\/messages(?:\?.*)?)$/,
    (route) => {
      transcriptRequestUrls.push(route.request().url())
      return route.fulfill({
        body: JSON.stringify(thread()),
        contentType: 'application/json',
        headers: { 'x-openpencil-test-request': String(++fullRequests) }
      })
    }
  )
  await page.route('http://127.0.0.1:7602/local-workspace/v1/trace/sessions', (route) =>
    route.fulfill({
      body: JSON.stringify({ summaries: [] }),
      contentType: 'application/json'
    })
  )
  await mockModels(page)

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Smooth streaming proof').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  await expect(conversation.getByTestId('ai-turn-duration')).toContainText('Working for')
  await expect(conversation.getByTestId('ai-activity-live')).toHaveCount(0)
  const markdown = conversation.getByTestId('ai-markdown').last()
  const completedHeading = markdown.getByRole('heading', { exact: true, name: 'Section 1' })
  await expect(markdown).toContainText(liveTail)
  await completedHeading.evaluate((element) =>
    element.setAttribute('data-stream-residency-probe', 'completed-block')
  )
  await conversation.screenshot({ path: testInfo.outputPath('stream-00.png') })

  const frameSamplePromise = markdown.evaluate(
    (element) =>
      new Promise<{ gaps: number[]; liveEdgeSteps: number[]; scrollSteps: number[] }>(
        (resolve, reject) => {
          const viewport = element
            .closest('[data-test-id="ai-conversation-surface"]')
            ?.querySelector<HTMLElement>('[data-test-id="ai-conversation-viewport"]')
          if (!viewport) {
            reject(new Error('Conversation viewport is unavailable'))
            return
          }
          const gaps: number[] = []
          const liveEdgeSteps: number[] = []
          const scrollSteps: number[] = []
          let previous = performance.now()
          let previousLiveEdgeInset =
            viewport.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom
          let previousScrollTop = viewport.scrollTop
          const timeout = window.setTimeout(
            () => reject(new Error('Frame sampling timed out')),
            4_000
          )
          const sample = (now: number) => {
            gaps.push(now - previous)
            previous = now
            const liveEdgeInset =
              viewport.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom
            liveEdgeSteps.push(Math.abs(liveEdgeInset - previousLiveEdgeInset))
            previousLiveEdgeInset = liveEdgeInset
            scrollSteps.push(Math.abs(viewport.scrollTop - previousScrollTop))
            previousScrollTop = viewport.scrollTop
            if (element.textContent?.includes('remain inert.')) {
              window.clearTimeout(timeout)
              resolve({
                gaps: gaps.slice(1),
                liveEdgeSteps: liveEdgeSteps.slice(1),
                scrollSteps: scrollSteps.slice(1)
              })
              return
            }
            requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        }
      )
  )
  const waitForFullRequest = (expectedRevision: number) =>
    expect.poll(() => fullRequests, { timeout: 2_000 }).toBeGreaterThan(expectedRevision)

  for (const [index, token] of tokens.entries()) {
    liveTail += token
    revision += 1
    await waitForFullRequest(revision)
    await expect(markdown).toContainText(liveTail, { timeout: 2_000 })
    await expect(completedHeading).toHaveAttribute('data-stream-residency-probe', 'completed-block')
    if ([1, 3, 5].includes(index)) {
      await conversation.screenshot({
        path: testInfo.outputPath(`stream-${String(index + 1).padStart(2, '0')}.png`)
      })
    }
  }

  const frameSample = await frameSamplePromise
  const frameMetrics = {
    maximumGapMs: Math.max(...frameSample.gaps),
    maximumLiveEdgeStepPx: Math.max(...frameSample.liveEdgeSteps),
    maximumScrollStepPx: Math.max(...frameSample.scrollSteps),
    p95GapMs: percentile(frameSample.gaps, 0.95),
    sampleCount: frameSample.gaps.length
  }
  await testInfo.attach('frame-metrics', {
    body: JSON.stringify(frameMetrics, null, 2),
    contentType: 'application/json'
  })
  await testInfo.attach('console-errors', {
    body: JSON.stringify(consoleErrors, null, 2),
    contentType: 'application/json'
  })

  expect(frameMetrics.p95GapMs).toBeLessThan(40)
  expect(frameMetrics.maximumGapMs).toBeLessThan(120)
  // Completed content should move up naturally when a new line wraps. The live
  // edge itself must stay pinned instead of dropping a line and catching up.
  expect(frameMetrics.maximumLiveEdgeStepPx).toBeLessThan(2)
  expect(
    transcriptRequestUrls.some((url) =>
      decodeURIComponent(url).includes('/messages?after=smooth-stream-prompt')
    )
  ).toBe(true)
  expect(pageErrors).toEqual([])
})
