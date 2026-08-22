import { expect, test, type Locator, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

async function dragSelectText(page: Page, target: Locator) {
  const points = await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let node = walker.nextNode()
    while (node) {
      const textNode = node as Text
      if (textNode.data.trim()) nodes.push(textNode)
      node = walker.nextNode()
    }
    const first = nodes.at(0)
    const last = nodes.at(-1)
    if (!first || !last) throw new Error('Selection target has no text nodes')
    const firstRange = document.createRange()
    firstRange.setStart(first, 0)
    firstRange.setEnd(first, Math.min(1, first.length))
    const lastOffset = last.data.trimEnd().length
    const lastRange = document.createRange()
    lastRange.setStart(last, Math.max(0, lastOffset - 1))
    lastRange.setEnd(last, lastOffset)
    const firstRect = firstRange.getBoundingClientRect()
    const lastRect = lastRange.getBoundingClientRect()
    return {
      end: { x: firstRect.left + 1, y: firstRect.top + firstRect.height / 2 },
      start: { x: lastRect.right - 1, y: lastRect.top + lastRect.height / 2 }
    }
  })
  await page.mouse.move(points.start.x, points.start.y)
  await page.mouse.down()
  await page.mouse.move(points.end.x, points.end.y, { steps: 12 })
  await page.mouse.up()
}

const THREAD = {
  canFollowUp: true,
  createdAt: '2026-08-21T20:00:00.000Z',
  effort: 'medium',
  id: 'annotation-thread',
  messages: [
    {
      createdAt: '2026-08-21T20:00:00.000Z',
      id: 'annotation-message',
      role: 'assistant',
      text: 'A concrete sentence to annotate.'
    }
  ],
  model: 'xai-auth/grok-4.6',
  recentUpdate: 'Ready for annotation',
  state: 'running',
  task: 'Annotation interaction',
  updatedAt: '2026-08-21T20:00:00.000Z',
  workerId: 'worker-annotation'
}

async function mockAnnotationThread(page: Page) {
  await Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
      route.fulfill({
        body: JSON.stringify({ threads: [THREAD] }),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/conversations\/annotation-thread$/, (route) =>
      route.fulfill({ body: JSON.stringify(THREAD), contentType: 'application/json' })
    ),
    page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
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
  ])
}

test('creates, reopens, and submits a compact transcript annotation', async ({ page }) => {
  const steers: string[] = []
  await mockAnnotationThread(page)
  await page.route(/\/agent-router\/v1\/pi\/conversations\/[^/]+\/steer$/, async (route) => {
    steers.push((route.request().postDataJSON() as { message: string }).message)
    await route.fulfill({
      body: '{"dispatchedAt":"2026-08-21T20:01:00.000Z","jobId":"job-1","state":"running","threadId":"annotation-thread"}',
      contentType: 'application/json',
      status: 202
    })
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Annotation interaction').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const message = conversation
    .getByTestId('ai-message')
    .filter({ hasText: THREAD.messages[0].text })
  await expect(message).toHaveCSS('user-select', 'text')
  await dragSelectText(page, message.locator('[data-stream-markdown="paragraph"]'))
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
    .toBe(THREAD.messages[0].text)
  const actions = page.getByTestId('ai-selection-actions')
  await expect(actions).toBeVisible()
  await actions.getByRole('button', { name: 'Add to chat' }).click()
  const composer = conversation.getByRole('textbox', { name: 'Follow up' })
  await expect(composer).toHaveValue('')
  await expect(conversation.getByTestId('ai-prompt-annotation-summary')).toHaveText('1 annotation')

  const editor = page.getByTestId('ai-annotation-editor')
  const comment = editor.getByRole('textbox', { name: 'Annotation comment' })
  await expect(comment).toHaveAttribute('placeholder', 'Add an optional comment…')
  await comment.fill('Make this sentence more concrete.')
  await comment.press('Enter')
  await expect(editor).toHaveCount(0)

  const marker = page.getByRole('button', { name: 'Open annotation 1' })
  await marker.click()
  await expect(page.getByTestId('ai-annotation-highlight').first()).toBeVisible()
  await expect(comment).toHaveValue('Make this sentence more concrete.')
  await comment.fill('Use a specific example.')
  await comment.press('Enter')

  await composer.press('Enter')
  await expect
    .poll(() => steers)
    .toEqual([
      [
        'Annotations:',
        '',
        'Annotation 1:',
        `> ${THREAD.messages[0].text}`,
        'Comment: Use a specific example.'
      ].join('\n')
    ])
  await expect(conversation.getByTestId('ai-prompt-annotation-summary')).toHaveCount(0)
  await expect(marker).toHaveCount(0)
})
