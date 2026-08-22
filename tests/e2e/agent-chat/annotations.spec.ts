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
  await page.clock.setFixedTime(new Date('2026-08-21T20:01:00.000Z'))
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
  await expect(page).toHaveScreenshot('agent-annotation-editor.png')
  await comment.fill('Make this sentence more concrete.')
  await comment.press('Enter')
  await expect(editor).toHaveCount(0)

  await dragSelectText(page, message.locator('[data-stream-markdown="paragraph"]'))
  await actions.getByRole('button', { name: 'Add to chat' }).click()
  await expect(conversation.getByTestId('ai-prompt-annotation-summary')).toHaveText('2 annotations')
  await expect(page.getByTestId('ai-annotation-marker')).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Open annotation 2' })).toBeVisible()
  await comment.press('Enter')

  const marker = page.getByRole('button', { exact: true, name: 'Open annotation 1' })
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
        'Comment: Use a specific example.',
        '',
        'Annotation 2:',
        `> ${THREAD.messages[0].text}`
      ].join('\n')
    ])
  await expect(conversation.getByTestId('ai-prompt-annotation-summary')).toHaveCount(0)
  await expect(marker).toHaveCount(0)
})

test('drops files, accepts video, and atomically sends the draft with attachments', async ({
  page
}) => {
  const steers: Array<{
    attachments?: Array<{ name: string; path: string; size?: number; type?: string }>
    displayPrompt?: string
    message: string
  }> = []
  let uploads = 0
  let markUploadStarted: () => void = () => undefined
  let releaseUpload: () => void = () => undefined
  const uploadStarted = new Promise<void>((resolve) => {
    markUploadStarted = resolve
  })
  const uploadGate = new Promise<void>((resolve) => {
    releaseUpload = resolve
  })
  await mockAnnotationThread(page)
  await page.route(/\/agent-router\/v1\/attachments$/, async (route) => {
    uploads += 1
    markUploadStarted()
    await uploadGate
    await route.fulfill({
      body: JSON.stringify({
        attachments: [
          { name: 'walkthrough.mp4', path: '/tmp/walkthrough.mp4' },
          { name: 'dropped.png', path: '/tmp/dropped.png' }
        ]
      }),
      contentType: 'application/json',
      status: 201
    })
  })
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/annotation-thread\/steer$/,
    async (route) => {
      steers.push(
        route.request().postDataJSON() as {
          attachments?: Array<{ name: string; path: string; size?: number; type?: string }>
          displayPrompt?: string
          message: string
        }
      )
      await route.fulfill({
        body: '{"dispatchedAt":"2026-08-21T20:01:00.000Z","jobId":"job-files","state":"running","threadId":"annotation-thread"}',
        contentType: 'application/json',
        status: 202
      })
    }
  )
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Annotation interaction').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const composer = conversation.getByTestId('ai-prompt-input')
  const fileInput = composer.locator('input[type="file"]')
  await expect(fileInput).not.toHaveAttribute('accept')
  await fileInput.setInputFiles([
    { buffer: Buffer.from('video bytes'), mimeType: 'video/mp4', name: 'walkthrough.mp4' },
    { buffer: Buffer.from('export const ok = true'), mimeType: 'text/typescript', name: 'index.ts' }
  ])
  await expect(composer.getByTestId('ai-prompt-attachment')).toHaveCount(2)
  await expect(composer.getByText('MP4', { exact: true })).toBeVisible()
  await expect(composer.getByText('TS', { exact: true })).toBeVisible()

  await composer.evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['image bytes'], 'dropped.png', { type: 'image/png' }))
    element.dispatchEvent(
      new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer })
    )
  })
  await expect(composer).toHaveAttribute('data-drag-active', 'true')
  await expect(composer.getByText('Drop files to attach')).toBeVisible()
  await composer.evaluate((element) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['image bytes'], 'dropped.png', { type: 'image/png' }))
    element.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    )
  })
  await expect(composer).toHaveAttribute('data-drag-active', 'false')
  await expect(composer.getByTestId('ai-prompt-attachment')).toHaveCount(3)

  const attachmentRow = composer.getByTestId('ai-prompt-attachments')
  await expect(attachmentRow).toHaveCSS('flex-wrap', 'nowrap')
  await expect(attachmentRow).toHaveCSS('overflow-x', 'auto')
  await expect
    .poll(() => attachmentRow.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true)
  await attachmentRow.evaluate((element) => element.scrollTo({ left: element.scrollWidth }))
  await expect
    .poll(() => attachmentRow.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0)

  const scriptChip = composer.getByTestId('ai-prompt-attachment').filter({ hasText: 'index.ts' })
  const removeScript = scriptChip.getByRole('button', { name: 'Remove index.ts' })
  await expect(removeScript).toHaveCSS('opacity', '0')
  await scriptChip.hover()
  await expect(removeScript).toHaveCSS('opacity', '1')
  await expect(removeScript).toHaveCSS('width', '14px')
  await expect(removeScript).toHaveCSS('top', '4px')
  await expect(removeScript).toHaveCSS('right', '4px')
  await removeScript.click()
  await expect(composer.getByTestId('ai-prompt-attachment')).toHaveCount(2)
  await composer.locator('textarea').fill("What's going on here?")
  await conversation.getByRole('button', { name: 'Steer task' }).click()

  await uploadStarted
  await expect(composer.locator('textarea')).toHaveValue('')
  await expect(composer.getByTestId('ai-prompt-attachment')).toHaveCount(0)
  const pendingTurn = conversation.getByTestId('ai-message').last()
  await expect(pendingTurn).toHaveAttribute('data-role', 'user')
  await expect(pendingTurn.getByRole('img', { name: 'dropped.png' })).toHaveCount(1)
  await expect(pendingTurn.getByText('walkthrough.mp4')).toBeVisible()
  await expect(pendingTurn.getByText("What's going on here?")).toBeVisible()
  const sentAttachments = pendingTurn.getByTestId('ai-attachments')
  const sentMessageBubble = pendingTurn.getByTestId('ai-message-content')
  await expect(sentMessageBubble.getByTestId('ai-attachments')).toHaveCount(0)
  await expect(
    pendingTurn.locator('[data-test-id="ai-attachments"] + [data-test-id="ai-message-content"]')
  ).toHaveCount(1)
  await expect(sentAttachments).toBeVisible()

  releaseUpload()
  await expect.poll(() => uploads).toBe(1)
  await expect
    .poll(() => steers.map((steer) => steer.message))
    .toEqual([
      [
        "What's going on here?",
        '',
        'Attached files:',
        '- "walkthrough.mp4": /tmp/walkthrough.mp4',
        '- "dropped.png": /tmp/dropped.png'
      ].join('\n')
    ])
  expect(steers[0]?.displayPrompt).toBe("What's going on here?")
  expect(steers[0]?.attachments).toEqual([
    { name: 'walkthrough.mp4', path: '/tmp/walkthrough.mp4' },
    { name: 'dropped.png', path: '/tmp/dropped.png' }
  ])
  await expect(composer.getByTestId('ai-prompt-attachment')).toHaveCount(0)
})

test('removes one annotation from its editor or clears all from the composer', async ({ page }) => {
  await mockAnnotationThread(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Annotation interaction').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const message = conversation
    .getByTestId('ai-message')
    .filter({ hasText: THREAD.messages[0].text })
  const paragraph = message.locator('[data-stream-markdown="paragraph"]')
  const actions = page.getByTestId('ai-selection-actions')
  const editor = page.getByTestId('ai-annotation-editor')
  const comment = editor.getByRole('textbox', { name: 'Annotation comment' })

  await dragSelectText(page, paragraph)
  await actions.getByRole('button', { name: 'Add to chat' }).click()
  await comment.fill('First note')
  await comment.press('Enter')

  await dragSelectText(page, paragraph)
  await actions.getByRole('button', { name: 'Add to chat' }).click()
  await comment.fill('Second note')
  await comment.press('Enter')

  const summary = conversation.getByTestId('ai-prompt-annotation-summary')
  await expect(summary).toHaveText('2 annotations')
  await page.getByTestId('ai-annotation-marker').first().click()
  await editor.getByTestId('ai-annotation-remove').click()

  await expect(summary).toHaveText('1 annotation')
  await expect(page.getByTestId('ai-annotation-marker')).toHaveCount(1)
  const clearAll = conversation.getByTestId('ai-prompt-clear-annotations')
  await expect(clearAll).toHaveCSS('opacity', '0')
  await summary.hover()
  await expect(clearAll).toHaveCSS('opacity', '1')
  await expect(page).toHaveScreenshot('agent-annotation-clear-hover.png')
  await clearAll.click()

  await expect(summary).toHaveCount(0)
  await expect(page.getByTestId('ai-annotation-marker')).toHaveCount(0)
})
