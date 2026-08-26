import { expect, test, type Page } from '@playwright/test'

import { expectDefined } from '#tests/helpers/assert'
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

test('opens the completed turn in the T3-style right diff workspace', async ({ page }) => {
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
  await page.getByTestId('left-panel-chats-tab').click()
  const panel = page.getByTestId('agent-chats-panel')
  const expandMiscChats = panel.getByRole('button', { name: 'Expand Misc chats' })
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

  const diffButton = panel.getByTestId('agent-selected-diff')
  await expect(diffButton).toBeVisible()
  await expect(diffButton).toBeEnabled()
  await diffButton.click()
  const rightPanel = page.getByTestId('t3-right-panel')
  await expect(rightPanel).toBeVisible()
  await expect(rightPanel).toHaveAttribute('data-state', 'open')
  await expect(rightPanel.locator('[data-diff-file="src/app.ts"]')).toContainText('+line')
  await expect(rightPanel.locator('[data-diff-file="tests/app.test.ts"]')).toContainText(
    '+test two'
  )
  expect(
    await rightPanel.evaluate((element) =>
      Boolean(element.closest('[data-test-id="agent-chats-panel"]'))
    )
  ).toBe(false)

  const resizeHandle = page.getByTestId('t3-right-panel-resize-handle')
  const resizeHandleBounds = expectDefined(
    await resizeHandle.boundingBox(),
    'right workspace resize handle bounds'
  )
  const panelBoundsBeforeResize = expectDefined(
    await rightPanel.boundingBox(),
    'right workspace bounds before resize'
  )
  expect(resizeHandleBounds.width).toBeGreaterThanOrEqual(40)
  const rightEdgeHits = await page.evaluate(
    ({ left, right, y }) =>
      [left + 2, right - 2].map((x) =>
        document.elementFromPoint(x, y)?.getAttribute('data-test-id')
      ),
    {
      left: resizeHandleBounds.x,
      right: resizeHandleBounds.x + resizeHandleBounds.width,
      y: resizeHandleBounds.y + resizeHandleBounds.height / 2
    }
  )
  expect(rightEdgeHits).toEqual(['t3-right-panel-resize-handle', 't3-right-panel-resize-handle'])
  const resizeY = resizeHandleBounds.y + resizeHandleBounds.height / 2
  await page.mouse.move(resizeHandleBounds.x + 2, resizeY)
  await page.mouse.down()
  await expect(page.locator('html')).toHaveAttribute('data-horizontal-resizing', '')
  await expect(rightPanel).toHaveAttribute('data-resizing', 'true')
  await page.mouse.move(resizeHandleBounds.x - 78, resizeY, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('html')).not.toHaveAttribute('data-horizontal-resizing')
  await expect(rightPanel).toHaveAttribute('data-resizing', 'false')
  const panelBoundsAfterResize = expectDefined(
    await rightPanel.boundingBox(),
    'right workspace bounds after resize'
  )
  expect(panelBoundsAfterResize.width).toBeGreaterThan(panelBoundsBeforeResize.width + 40)

  await rightPanel
    .locator('[data-diff-file="src/app.ts"] [data-diff-line-kind="addition"]')
    .last()
    .click()
  await rightPanel.getByRole('button', { name: 'Comment on selected lines' }).click()
  await rightPanel.getByLabel(/Comment on line/).fill('Keep this covered by the focused test.')
  await rightPanel.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(panel.getByTestId('ai-prompt-annotation-summary')).toContainText('1 annotation')

  await rightPanel.getByRole('button', { name: 'Close right panel' }).click()
  await expect(rightPanel).toHaveAttribute('data-state', 'closed')
})
