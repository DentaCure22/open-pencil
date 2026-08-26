import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const thread = {
  canFollowUp: true,
  createdAt: '2026-08-16T12:00:00.000Z',
  effort: 'medium',
  id: 'smooth-send-thread',
  messages: Array.from({ length: 24 }, (_, index) => ({
    createdAt: new Date(Date.UTC(2026, 7, 16, 12, 0, index)).toISOString(),
    id: `smooth-send-message-${String(index)}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `Conversation item ${String(index + 1)}\nLine two keeps this transcript tall.\nLine three keeps this transcript tall.`
  })),
  model: 'xai-auth/grok-4.6',
  recentUpdate: 'Ready',
  state: 'completed',
  task: 'Smooth send proof',
  updatedAt: '2026-08-16T12:01:00.000Z'
}

async function mockConversation(page: Page) {
  await page.route(/\/agent-router\/v1\/pi\/conversations\?preview=1$/, (route) =>
    route.fulfill({
      body: JSON.stringify({ threads: [thread] }),
      contentType: 'application/json'
    })
  )
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/smooth-send-thread(?:\?page=1|\/messages(?:\?.*)?)?$/,
    (route) =>
      route.fulfill({
        body: JSON.stringify(thread),
        contentType: 'application/json'
      })
  )
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/smooth-send-thread\/follow-up$/,
    (route) =>
      route.fulfill({
        body: '{"dispatchedAt":"2026-08-16T12:02:00.000Z","jobId":"smooth-send-job","state":"queued","threadId":"smooth-send-thread"}',
        contentType: 'application/json',
        status: 202
      })
  )
  await page.route(/\/agent-router\/v1\/pi\/jobs\/smooth-send-job$/, (route) =>
    route.fulfill({
      body: '{"createdAt":"2026-08-16T12:02:00.000Z","jobId":"smooth-send-job","response":"","state":"running","threadId":"smooth-send-thread","updatedAt":"2026-08-16T12:02:00.000Z"}',
      contentType: 'application/json'
    })
  )
  await page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
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

test('passes a sent prompt smoothly from the composer into the transcript', async ({ page }) => {
  await mockConversation(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Smooth send proof').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const viewport = conversation.getByTestId('ai-conversation-viewport')
  const composer = conversation.getByRole('textbox', { name: 'Follow up' })
  await composer.fill('Move this into the chat smoothly.')
  await viewport.hover()
  await page.mouse.wheel(0, -5_000)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeLessThan(100)
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeGreaterThan(500)

  const sendMotion = viewport.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const positions: number[] = []
        const startedAt = performance.now()
        let moving = false
        const sample = (now: number) => {
          positions.push(element.scrollTop)
          moving ||= element.scrollTop > (positions[0] ?? 0)
          const gap = element.scrollHeight - element.scrollTop - element.clientHeight
          if ((moving && gap <= 1) || now - startedAt >= 1_500) {
            resolve(positions)
            return
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
  )

  await conversation.getByRole('button', { name: 'Send message' }).click()
  const enteringPrompt = conversation
    .getByTestId('ai-message')
    .and(conversation.locator('[data-entering="true"]'))
  await expect(enteringPrompt).toContainText('Move this into the chat smoothly.')
  expect(
    await enteringPrompt.evaluate((element) => getComputedStyle(element).animationName)
  ).toContain('agent-prompt-enter')

  const positions = await sendMotion
  const scrollDistance = Math.max(...positions) - (positions[0] ?? 0)
  const scrollSteps = positions
    .slice(1)
    .map((position, index) => Math.abs(position - (positions[index] ?? position)))
    .filter((step) => step > 0.5)
  expect(scrollDistance).toBeGreaterThan(500)
  expect(scrollSteps.length).toBeGreaterThan(2)
  expect(Math.max(...scrollSteps)).toBeLessThan(scrollDistance * 0.8)
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeLessThanOrEqual(1)
})

test('does not snap an ordinary bottom-pinned prompt into place', async ({ page }) => {
  await mockConversation(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Smooth send proof').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const viewport = conversation.getByTestId('ai-conversation-viewport')
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeLessThanOrEqual(1)

  const sendMotion = viewport.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const positions: number[] = []
        const startedAt = performance.now()
        let moving = false
        const sample = (now: number) => {
          positions.push(element.scrollTop)
          moving ||= element.scrollTop > (positions[0] ?? 0)
          const gap = element.scrollHeight - element.scrollTop - element.clientHeight
          if ((moving && gap <= 1) || now - startedAt >= 1_500) {
            resolve(positions)
            return
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
  )

  await conversation.getByRole('textbox', { name: 'Follow up' }).fill('Keep this send gentle.')
  await conversation.getByRole('button', { name: 'Send message' }).click()
  await expect(conversation.locator('[data-entering="true"]')).toContainText(
    'Keep this send gentle.'
  )

  const positions = await sendMotion
  const scrollDistance = Math.max(...positions) - (positions[0] ?? 0)
  const scrollSteps = positions
    .slice(1)
    .map((position, index) => Math.abs(position - (positions[index] ?? position)))
    .filter((step) => step > 0.5)
  expect(scrollDistance).toBeGreaterThan(20)
  expect(scrollSteps.length).toBeGreaterThan(1)
  expect(Math.max(...scrollSteps)).toBeLessThan(scrollDistance * 0.9)
})
