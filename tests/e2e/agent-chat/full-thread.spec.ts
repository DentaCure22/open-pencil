import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const messages = Array.from({ length: 12 }, (_, index) => ({
  createdAt: new Date(Date.UTC(2026, 7, 16, 12, 0, index)).toISOString(),
  id: `full-thread-message-${String(index)}`,
  role: index % 2 === 0 ? 'user' : 'assistant',
  text: `Full thread item ${String(index + 1)}`
}))

const thread = {
  canFollowUp: true,
  createdAt: '2026-08-16T12:00:00.000Z',
  effort: 'medium',
  id: 'full-thread',
  messages,
  model: 'xai-auth/grok-4.6',
  recentUpdate: 'Done.',
  state: 'completed',
  task: 'Whole thread proof',
  updatedAt: '2026-08-16T12:01:00.000Z'
}

const tail = {
  ...thread,
  hasOlder: true,
  messages: messages.slice(-4),
  olderBefore: messages[8]?.id
}

async function mockConversation(page: Page) {
  await page.route(/\/agent-router\/v1\/pi\/conversations\?preview=1$/, (route) =>
    route.fulfill({
      body: JSON.stringify({ threads: [tail] }),
      contentType: 'application/json'
    })
  )
  await page.route(/\/agent-router\/v1\/pi\/conversations\/full-thread\?page=1$/, (route) =>
    route.fulfill({
      body: JSON.stringify(tail),
      contentType: 'application/json'
    })
  )
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/full-thread\/messages(?:\?.*)?$/,
    (route) =>
      route.fulfill({
        body: JSON.stringify(tail),
        contentType: 'application/json'
      })
  )
  await page.route(/\/agent-router\/v1\/pi\/conversations\/full-thread$/, (route) =>
    route.fulfill({
      body: JSON.stringify(thread),
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

test('opens the whole thread without an earlier-messages control', async ({ page }) => {
  await mockConversation(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Whole thread proof').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  await expect(conversation.getByText('Full thread item 1', { exact: true })).toBeVisible()
  await expect(conversation.getByText('Full thread item 12', { exact: true })).toBeVisible()
  await expect(conversation.getByTestId('ai-conversation-load-older')).toHaveCount(0)
})
