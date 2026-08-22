import { expect, test, type Locator, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { setLocalStorageItem } from '#tests/helpers/storage'

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
    const lastVisibleOffset = last.data.trimEnd().length
    const lastRange = document.createRange()
    lastRange.setStart(last, Math.max(0, lastVisibleOffset - 1))
    lastRange.setEnd(last, lastVisibleOffset)
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
  const selectedBeforePointerUp = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  await page.mouse.up()
  return selectedBeforePointerUp
}

function taskThread() {
  return {
    canFollowUp: true,
    createdAt: '2026-08-16T00:00:00.000Z',
    effort: 'medium',
    id: 'task-thread-1',
    messages: [
      ...Array.from({ length: 28 }, (_, index) => ({
        createdAt: `2026-08-16T00:00:${String(index).padStart(2, '0')}.000Z`,
        id: `history-${String(index)}`,
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        text: `Scrollable Board conversation message ${String(index + 1)}.`
      })),
      {
        completedAt: '2026-08-16T00:00:31.000Z',
        createdAt: '2026-08-16T00:00:28.000Z',
        id: 'task-result',
        parts: [
          { state: 'complete', text: 'Read only the scoped project metadata.', type: 'reasoning' },
          {
            input: '{"path":"package.json"}',
            name: 'Read file',
            output: 'File: package.json',
            state: 'success',
            type: 'tool'
          },
          { text: 'Task transcript ready.', type: 'text' }
        ],
        role: 'assistant',
        text: 'Task transcript ready.'
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Task transcript ready.',
    state: 'completed',
    task: 'Board task conversation',
    updatedAt: '2026-08-16T00:00:31.000Z'
  }
}

test('keeps one normal mounted chat through design and interaction modes', async ({ page }) => {
  const thread = taskThread()
  const followUps: string[] = []
  await page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
    route.fulfill({ body: JSON.stringify({ threads: [thread] }), contentType: 'application/json' })
  )
  await page.route(/\/agent-router\/v1\/pi\/conversations\/task-thread-1$/, (route) =>
    route.fulfill({ body: JSON.stringify(thread), contentType: 'application/json' })
  )
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/task-thread-1\/follow-up$/,
    async (route) => {
      followUps.push((route.request().postDataJSON() as { message: string }).message)
      await route.fulfill({
        body: '{"jobId":"job-task","threadId":"task-thread-1"}',
        contentType: 'application/json',
        status: 202
      })
    }
  )
  await page.route(/\/agent-router\/v1\/pi\/jobs\/job-task$/, (route) =>
    route.fulfill({
      body: '{"response":"Done.","state":"completed"}',
      contentType: 'application/json'
    })
  )

  await setLocalStorageItem(
    page,
    'op-agent-board-known-conversations-v1',
    JSON.stringify(['task-thread-1'])
  )
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await expect(page.getByTestId('editor-root')).toHaveAttribute(
    'data-local-workspace-role',
    /^(cloud|viewer|writer)$/
  )
  await canvas.clearCanvas()
  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { codeObjectDocument, createAgentConversationTerminalDocument, createCodeObject } =
      await import('/src/app/code-object/model.ts')
    const existing = store.graph.getAllNodes().find((node) => {
      const document = codeObjectDocument(node)
      return (
        document?.component === 'agent-conversation-terminal' &&
        document.workerConversationId === 'task-thread-1'
      )
    })
    const card =
      existing ??
      createCodeObject(store, {
        document: createAgentConversationTerminalDocument({
          name: 'Board task conversation',
          workerConversationId: 'task-thread-1'
        }),
        height: 560,
        name: 'Board task conversation',
        parentId: store.state.currentPageId,
        width: 520,
        x: 160,
        y: 120
      })
    store.zoomToNode(card.id)
    store.requestRender()
  })

  const surface = page
    .getByTestId('agent-chat-board-surface')
    .and(page.locator('[data-conversation-id="task-thread-1"]'))
  const host = page.locator('[data-code-object-id]').filter({ has: surface })
  const objectId = await host.getAttribute('data-code-object-id')
  if (!objectId) throw new Error('Task Board object identity unavailable')
  const hitTarget = page
    .getByTestId(`code-object-overlay-${objectId}`)
    .getByTestId('code-object-design-hit-target')
  const composer = surface.getByRole('textbox', { name: 'Task conversation input' })

  await expect(host).toHaveAttribute('data-code-object-mode', 'design')
  await expect(hitTarget).toHaveAttribute(
    'aria-label',
    'Board task conversation. Click to interact or drag to move.'
  )
  await expect(surface).toHaveAttribute('data-agent-kind', 'task')
  await expect(surface).toContainText('Task transcript ready.')
  await expect(surface.getByTestId('ai-message')).toHaveCount(29)
  const activity = surface.getByTestId('ai-activity-disclosure').last()
  await expect(activity).toBeVisible()
  await expect(activity.getByTestId('ai-activity-timeline')).toHaveCount(0)
  await surface.evaluate((element) => element.setAttribute('data-residency-probe', 'surface'))

  const bounds = await hitTarget.boundingBox()
  if (!bounds) throw new Error('Task full-card hit target unavailable')
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height - 36)

  await expect(host).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(host).toHaveCSS('pointer-events', 'auto')
  await expect(surface).toHaveAttribute('data-residency-probe', 'surface')
  await expect(composer).toBeFocused()
  const selectableMessage = surface
    .getByTestId('ai-message')
    .filter({ hasText: 'Scrollable Board conversation message 28.' })
  await selectableMessage.scrollIntoViewIfNeeded()
  const selectedBeforePointerUp = await dragSelectText(page, selectableMessage)
  expect(selectedBeforePointerUp).toContain('Scrollable Board conversation message 28')
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
    .toContain('Scrollable Board conversation message 28')
  await expect(page.getByTestId('ai-selection-actions')).toBeVisible()
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  await page.keyboard.press('x')
  await expect(composer).toHaveValue('x')
  await composer.fill('')
  await activity.getByTestId('ai-turn-duration').click()
  const reasoning = activity.getByTestId('ai-reasoning')
  await reasoning.getByTestId('ai-reasoning-toggle').click()
  await expect(reasoning.getByTestId('ai-reasoning-content')).toContainText(
    'Read only the scoped project metadata.'
  )
  await activity.getByTestId('ai-tool-group-toggle').click()
  await expect(activity.getByTestId('ai-tool-call')).toContainText('Read')
  expect(
    await surface.evaluate((element) => {
      const summary = element.querySelector('[data-test-id="ai-turn-duration"]')
      const timeline = element.querySelector('[data-test-id="ai-activity-timeline"]')
      const answer = [...element.querySelectorAll('[data-test-id="ai-message"]')].find((message) =>
        message.textContent.includes('Task transcript ready.')
      )
      if (!summary || !timeline || !answer) return false
      return (
        Boolean(summary.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(timeline.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING)
      )
    })
  ).toBe(true)

  await composer.fill('Draft survives mode changes')
  await page.keyboard.press('Escape')
  await expect(host).toHaveAttribute('data-code-object-mode', 'design')
  await expect(surface).toHaveAttribute('data-residency-probe', 'surface')
  await expect(surface.getByTestId('ai-message')).toHaveCount(29)
  await expect(surface.getByTestId('ai-activity-disclosure')).toBeVisible()
  await expect(composer).toHaveValue('Draft survives mode changes')

  await page.keyboard.press('Enter')
  await expect(host).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(composer).toBeFocused()
  await composer.fill('Follow up from the Board')
  await composer.press('Enter')
  await expect.poll(() => followUps).toEqual(['Follow up from the Board'])
})
