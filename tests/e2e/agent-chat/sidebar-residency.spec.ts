import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

function worker(index: number) {
  const updatedAt = new Date(Date.UTC(2026, 7, 25, 12, 0, 40 - index)).toISOString()
  return {
    canFollowUp: true,
    createdAt: updatedAt,
    effort: 'medium',
    id: `thread-${String(index)}`,
    messages: [
      {
        createdAt: updatedAt,
        id: `message-${String(index)}`,
        role: 'user',
        text: `Task ${String(index)}`
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate: `Result preview for task ${String(index)}`,
    state: 'completed',
    task: `Human task title ${String(index)}`,
    updatedAt,
    workerId: `worker-${String(index)}`
  }
}

async function mockThreads(page: Page) {
  const threads = Array.from({ length: 40 }, (_, index) => worker(index))
  await Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
      route.fulfill({
        body: JSON.stringify({ threads }),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/conversations\/[^/?]+$/, (route) => {
      const id = decodeURIComponent(route.request().url().split('/conversations/')[1] ?? '')
      const thread = threads.find((candidate) => candidate.id === id)
      return route.fulfill({
        body: JSON.stringify(thread ?? {}),
        contentType: 'application/json',
        status: thread ? 200 : 404
      })
    }),
    page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
      route.fulfill({
        body: JSON.stringify({
          models: [
            {
              defaultEffort: 'medium',
              efforts: ['low', 'medium', 'high'],
              group: 'xAI',
              id: 'xai-auth/grok-4.6',
              label: 'Grok 4.6'
            }
          ]
        }),
        contentType: 'application/json'
      })
    )
  ])
}

test('shows Chats first by default and restores the last sidebar utility after reload', async ({
  page
}) => {
  await mockThreads(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const utilityTabs = page.getByRole('tablist', { name: 'Sidebar utilities' }).getByRole('tab')
  await expect(utilityTabs).toHaveText(['CHATS', 'LAYERS', 'ASSETS', 'ACTIVITY'])
  await expect(page.getByTestId('left-panel-chats-tab')).toHaveAttribute('data-state', 'active')
  await expect(page.getByTestId('agent-thread-selector')).toBeVisible()

  await page.getByTestId('left-panel-assets-tab').click()
  await expect(page.getByTestId('left-panel-assets-content')).toBeVisible()
  await page.reload()
  await new CanvasHelper(page).waitForInit()

  await expect(page.getByTestId('left-panel-assets-tab')).toHaveAttribute('data-state', 'active')
  await expect(page.getByTestId('left-panel-assets-content')).toBeVisible()
})

test('restores the open chat and task-list location after reload', async ({ page }) => {
  await mockThreads(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  await page.getByTestId('agent-thread-selector').getByText('Human task title 7').click()
  const conversation = page.getByTestId('agent-selected-conversation')
  await expect(conversation).toBeVisible()
  await expect(page.getByTestId('agent-selected-header-title')).toContainText('Human task title 7')

  await page.reload()
  await new CanvasHelper(page).waitForInit()

  await expect(page.getByTestId('left-panel-chats-tab')).toHaveAttribute('data-state', 'active')
  await expect(conversation).toBeVisible()
  await expect(page.getByTestId('agent-selected-header-title')).toContainText('Human task title 7')

  await page.getByTestId('agent-thread-back').click()
  await expect(page.getByTestId('agent-thread-selector')).toBeVisible()
  await page.reload()
  await new CanvasHelper(page).waitForInit()
  await expect(page.getByTestId('agent-thread-selector')).toBeVisible()
})

test('keeps the task list mounted and stable while switching sidebar utilities', async ({
  page
}) => {
  await mockThreads(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const taskList = page.getByTestId('agent-thread-list')
  await expect(taskList).toBeVisible()
  await taskList.evaluate((element) => {
    element.scrollTop = 640
    element.dataset.residencyProbe = 'retained'
  })
  const retainedScrollTop = await taskList.evaluate((element) => element.scrollTop)
  expect(retainedScrollTop).toBeGreaterThan(0)

  await page.getByTestId('left-panel-layers-tab').click()
  await expect(taskList).toBeAttached()
  await expect(taskList).not.toBeVisible()
  await page.getByTestId('left-panel-chats-tab').click()

  await expect(taskList).toHaveAttribute('data-residency-probe', 'retained')
  await expect.poll(() => taskList.evaluate((element) => element.scrollTop)).toBe(retainedScrollTop)
})
