import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

function mockThread(page: Page, thread: object) {
  return Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
      route.fulfill({
        body: JSON.stringify({ threads: [thread] }),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/conversations\/[^/?]+(?:\/messages)?(?:\?.*)?$/, (route) =>
      route.fulfill({ body: JSON.stringify(thread), contentType: 'application/json' })
    ),
    page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
      route.fulfill({ body: '{"models":[]}', contentType: 'application/json' })
    )
  ])
}

test('opens changed files first, then the selected file diff', async ({ page }) => {
  await mockThread(page, {
    canFollowUp: true,
    createdAt: '2026-08-25T12:00:00.000Z',
    effort: 'high',
    id: 'turn-changes',
    messages: [
      {
        changes: {
          additions: 12,
          capturedAt: '2026-08-25T12:00:04.000Z',
          deletions: 3,
          files: [
            {
              additions: 10,
              deletions: 3,
              patch:
                'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1,2 @@\n-old\n+new\n+line',
              path: 'src/app.ts',
              status: 'modified'
            },
            {
              additions: 2,
              deletions: 0,
              patch:
                'diff --git a/tests/app.test.ts b/tests/app.test.ts\n--- /dev/null\n+++ b/tests/app.test.ts\n@@ -0,0 +1,2 @@\n+test one\n+test two',
              path: 'tests/app.test.ts',
              status: 'added'
            }
          ]
        },
        completedAt: '2026-08-25T12:00:04.000Z',
        createdAt: '2026-08-25T12:00:00.000Z',
        id: 'turn-changes-prompt',
        role: 'user',
        text: 'Update the app.'
      },
      {
        completedAt: '2026-08-25T12:00:04.000Z',
        createdAt: '2026-08-25T12:00:04.000Z',
        id: 'turn-changes-answer',
        role: 'assistant',
        text: 'The app and its focused test are updated.'
      }
    ],
    model: 'openai/gpt-5.5',
    recentUpdate: 'The app and its focused test are updated.',
    state: 'completed',
    task: 'Turn changes',
    updatedAt: '2026-08-25T12:00:04.000Z',
    workerId: 'worker-turn-changes'
  })

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  const panel = page.getByTestId('agent-chats-panel')
  const expandMiscChats = panel.getByRole('button', { name: 'Expand Chats' })
  if (await expandMiscChats.isVisible()) await expandMiscChats.click()
  await panel.getByTestId('agent-thread-selector').getByText('Turn changes').click()

  const changes = panel.getByTestId('ai-turn-changes')
  await expect(changes).toContainText('2 files changed')
  await expect(changes).toContainText('+12')
  await expect(changes).toContainText('−3')
  await expect(panel.getByTestId('ai-turn-changes-dock')).toBeVisible()
  expect(
    await panel
      .getByTestId('ai-turn-changes-dock')
      .evaluate((element) => element.nextElementSibling?.getAttribute('data-test-id'))
  ).toBe('ai-prompt-input')

  await expect(panel.getByTestId('agent-selected-diff')).toHaveCount(0)
  const changesButton = panel.getByRole('button', { name: 'Show files changed in latest turn' })
  const changesToggle = panel.getByTestId('ai-turn-changes-toggle')
  await expect(changesButton).toBeEnabled()
  await expect(changesToggle).toHaveCSS('border-radius', '10px')
  await changesButton.click()
  const changedFiles = panel.getByTestId('turn-changed-files')
  await expect(changedFiles).toBeVisible()
  await expect(changedFiles.getByRole('menuitem', { name: 'src/app.ts' })).toBeVisible()
  await expect(changedFiles.getByRole('menuitem', { name: 'tests/app.test.ts' })).toBeVisible()
  const [pillBounds, changedFilesBounds] = await Promise.all([
    changesToggle.boundingBox(),
    changedFiles.boundingBox()
  ])
  if (!pillBounds || !changedFilesBounds) throw new Error('Changed-files pill bounds missing')
  expect(changedFilesBounds.y + changedFilesBounds.height).toBeLessThanOrEqual(pillBounds.y)

  const rightPanel = page.getByTestId('t3-right-panel')
  await expect(rightPanel).toHaveAttribute('data-state', 'closed')

  await changedFiles.locator('[data-changed-file="src/app.ts"]').click()
  await expect(rightPanel).toHaveAttribute('data-state', 'open')
  await expect(rightPanel.locator('[data-diff-file="src/app.ts"]')).toContainText('+line')
  await expect(rightPanel.locator('[data-diff-file="tests/app.test.ts"]')).toHaveCount(0)
  expect(
    await rightPanel.evaluate((element) =>
      Boolean(element.closest('[data-test-id="agent-chats-panel"]'))
    )
  ).toBe(false)
})
