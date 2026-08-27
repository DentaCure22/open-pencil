import { resolve } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { setLocalStorageItem } from '#tests/helpers/storage'

function mockThreads(page: Page, threads: object[]) {
  return Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
      route.fulfill({
        body: JSON.stringify({ threads }),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/conversations\/[^/?]+$/, (route) => {
      const id = decodeURIComponent(route.request().url().split('/conversations/')[1] ?? '')
      const thread = threads.find((item) => (item as { id?: string }).id === id)
      return route.fulfill({
        body: JSON.stringify(thread ?? {}),
        contentType: 'application/json',
        status: thread ? 200 : 404
      })
    }),
    page.route(/\/agent-router\/v1\/pi\/jobs\//, (route) =>
      route.fulfill({
        body: '{"createdAt":"2026-08-16T00:02:00.000Z","jobId":"job-1","response":"Done.","state":"completed","threadId":"thread-1","updatedAt":"2026-08-16T00:02:01.000Z"}',
        contentType: 'application/json'
      })
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

function worker(index: number) {
  const updatedAt = new Date(Date.UTC(2026, 7, 16, 12, 0, 12 - index)).toISOString()
  return {
    canFollowUp: true,
    contextUsage: {
      autoCompactionEnabled: true,
      cacheHitPercent: 86,
      compacting: false,
      contextWindow: 500_000,
      percent: 18,
      tokens: 90_000,
      tokensPerSecond: 24.5,
      tokensPerSecondBasis: 'streamed-output'
    },
    createdAt: updatedAt,
    effort: 'medium',
    id: `thread-${String(index)}`,
    messages: Array.from({ length: 24 }, (_, messageIndex) => ({
      createdAt: updatedAt,
      id: `message-${String(index)}-${String(messageIndex)}`,
      role: messageIndex % 2 === 0 ? 'user' : 'assistant',
      text: `Task ${String(index)} conversation message ${String(messageIndex + 1)}`
    })),
    model: 'cursor/composer-2.5-fast',
    recentUpdate: `Result preview for task ${String(index)}`,
    state: index === 0 ? 'running' : 'completed',
    task: `Human task title ${String(index)}`,
    updatedAt,
    workerId: `worker-${String(index + 1)}`
  }
}

function messagesApprovalThread(index: number) {
  const thread = worker(index)
  thread.state = 'needs_attention'
  return {
    ...thread,
    messages: [...thread.messages] as object[],
    pendingUiRequests: [
      {
        id: `message-approval-${String(index)}`,
        method: 'select' as const,
        options: ['Allow once', 'Allow for session', 'Deny'],
        requestedAt: '2026-08-22T14:30:00.000Z',
        title:
          'MCP: messages__send wants to run send_message\n\nArguments:\n' +
          JSON.stringify({
            chat_guid: 'iMessage;-;test-recipient',
            recipient_label: 'Test Recipient',
            texts: ['Be there in 10 minutes.', 'I’ll text when I arrive.']
          })
      }
    ],
    recentUpdate: 'Waiting for your approval.'
  }
}

test('shows whole-turn timing while running and marks finished chats', async ({ page }) => {
  const running = {
    ...worker(0),
    activeTurnStartedAt: new Date(Date.now() - 60_000).toISOString(),
    recentUpdate: 'bash failed. · 7s'
  }
  const finished = worker(1)
  await mockThreads(page, [running, finished])
  await setLocalStorageItem(
    page,
    'open-pencil:agent-thread-preferences-v1',
    JSON.stringify({ 'thread-1': { unread: true } })
  )

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const selector = page.getByTestId('agent-thread-selector')
  const runningThread = selector.getByTestId('agent-chat-thread-agent:thread-0')
  const runningStatus = runningThread.locator('span').filter({ hasText: 'bash failed.' }).last()
  const elapsed = await runningStatus.textContent()
  const elapsedSeconds = Number(/ · (\d+)s$/.exec(elapsed ?? '')?.[1])
  expect(elapsedSeconds).toBeGreaterThanOrEqual(59)
  expect(elapsedSeconds).toBeLessThan(75)
  await expect(runningThread.getByTestId('agent-thread-finished-marker')).toHaveCount(0)

  const finishedThread = selector.getByTestId('agent-chat-thread-agent:thread-1')
  const runningHeight = (await runningThread.boundingBox())?.height
  const finishedHeight = (await finishedThread.boundingBox())?.height
  expect(runningHeight).toBeGreaterThanOrEqual(52)
  expect(finishedHeight).toBe(runningHeight)
  await expect(finishedThread.getByTestId('agent-thread-finished-marker')).toHaveAttribute(
    'aria-label',
    'Unread'
  )
  await finishedThread.click()
  await page.getByRole('button', { name: 'Back to tasks' }).click()
  await expect(finishedThread.getByTestId('agent-thread-finished-marker')).toHaveCount(0)
})

test('keeps one clean task list and preserves a conversation while navigating back', async ({
  page
}) => {
  const followUps: Array<{ message: string; url: string }> = []
  const newTasks: string[] = []
  const workers = Array.from({ length: 12 }, (_, index) => worker(index))
  await mockThreads(page, workers)
  await page.route(/\/agent-router\/v1\/pi\/dispatch$/, async (route) => {
    newTasks.push((route.request().postDataJSON() as { prompt: string }).prompt)
    await route.fulfill({
      body: '{"dispatchedAt":"2026-08-16T00:02:00.000Z","jobId":"job-new","state":"queued","threadId":"thread-new"}',
      contentType: 'application/json',
      status: 202
    })
  })
  await page.route(/\/agent-router\/v1\/pi\/conversations\/[^/]+\/follow-up/, async (route) => {
    followUps.push({
      message: (route.request().postDataJSON() as { message: string }).message,
      url: route.request().url()
    })
    await route.fulfill({
      body: '{"dispatchedAt":"2026-08-16T00:02:00.000Z","jobId":"job-1","state":"queued","threadId":"thread-11"}',
      contentType: 'application/json',
      status: 202
    })
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const panel = page.getByTestId('agent-chats-panel')
  const conversation = page.getByTestId('agent-selected-conversation')
  const selector = page.getByTestId('agent-thread-selector')
  await expect(panel).toBeVisible()
  await expect(selector).toHaveAttribute('aria-hidden', 'false')
  await expect(conversation).toHaveAttribute('aria-hidden', 'true')
  await expect(selector.getByText('Open Pencil:Board')).toHaveCount(0)
  await expect(selector.getByText('Human task title 0')).toBeVisible()
  await expect(selector.getByTestId(/^agent-chat-thread-agent:/)).toHaveCount(12)
  await panel.getByTestId('agent-thread-new').click()
  const newTaskComposer = conversation.getByRole('textbox', {
    name: 'New task'
  })
  await newTaskComposer.fill('Start a clean task')
  await newTaskComposer.press('Enter')
  await expect.poll(() => newTasks).toEqual(['Start a clean task'])
  await conversation.getByRole('button', { name: 'Back to tasks' }).click()
  const oldestThread = selector.getByText('Human task title 11')
  await oldestThread.scrollIntoViewIfNeeded()
  await expect(oldestThread).toBeVisible()
  await oldestThread.click()
  await expect(selector).toHaveAttribute('aria-hidden', 'true')
  await expect(conversation).toHaveAttribute('aria-hidden', 'false')
  await expect(conversation.getByTestId('agent-selected-header')).toContainText(
    'Human task title 11'
  )
  await expect(conversation.getByTestId('agent-selected-header')).toHaveCSS(
    'border-bottom-width',
    '0px'
  )
  const headerFade = conversation.getByTestId('ai-conversation-header-fade')
  await expect(headerFade).toBeVisible()
  const headerFadeBackground = await headerFade.evaluate(
    (element) => getComputedStyle(element).backgroundImage
  )
  expect(headerFadeBackground).toContain('linear-gradient')
  await expect(conversation.getByText('Task 11 conversation message 24')).toBeVisible()
  const composer = conversation.getByRole('textbox', { name: 'Follow up' })
  const viewport = conversation.getByTestId('ai-conversation-viewport')
  const chapterRail = conversation.getByRole('navigation', {
    name: 'User messages'
  })
  const chapterMarkers = chapterRail.getByTestId('ai-conversation-chapter-marker')
  await expect(chapterRail).toBeVisible()
  await expect(chapterMarkers).toHaveCount(12)
  const viewportBox = await viewport.boundingBox()
  const chapterRailBox = await chapterRail.boundingBox()
  expect(viewportBox).not.toBeNull()
  expect(chapterRailBox).not.toBeNull()
  if (!viewportBox || !chapterRailBox) throw new Error('Conversation navigation bounds missing')
  const chapterRailCenter = chapterRailBox.y + chapterRailBox.height / 2
  const viewportCenter = viewportBox.y + viewportBox.height / 2
  expect(chapterRailCenter - viewportCenter).toBeGreaterThan(24)
  expect(chapterRailCenter - viewportCenter).toBeLessThan(40)
  await chapterMarkers.nth(2).hover()
  const chapterTooltip = page.getByTestId('ai-conversation-chapter-tooltip')
  await expect(chapterTooltip).toContainText('Task 11 conversation message 5')
  await expect(chapterTooltip).toContainText('Task 11 conversation message 6')
  const hoveredMarkerBox = await chapterMarkers.nth(2).locator('span').nth(1).boundingBox()
  const distantMarkerBox = await chapterMarkers.nth(8).locator('span').nth(1).boundingBox()
  expect(hoveredMarkerBox?.width).toBeGreaterThan(
    (distantMarkerBox?.width ?? Number.POSITIVE_INFINITY) * 2
  )
  await chapterMarkers.nth(2).click()
  await expect(conversation.getByText('Task 11 conversation message 5')).toBeInViewport()
  await composer.fill('Draft preserved while browsing history')
  await viewport.evaluate((element) => {
    element.scrollTop = 120
  })
  const scrollTop = await viewport.evaluate((element) => element.scrollTop)
  await conversation.getByRole('button', { name: 'Back to tasks' }).click()
  await expect(selector).toHaveAttribute('aria-hidden', 'false')
  await expect(conversation).toHaveAttribute('aria-hidden', 'true')
  await selector.getByText('Human task title 11').click()
  await expect(composer).toHaveValue('Draft preserved while browsing history')
  expect(await viewport.evaluate((element) => element.scrollTop)).toBe(scrollTop)

  const cameraBefore = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    return store
      ? {
          panX: store.state.panX,
          panY: store.state.panY,
          zoom: store.state.zoom
        }
      : null
  })
  await viewport.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await viewport.hover()
  await page.mouse.wheel(0, 4_000)
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await page.mouse.wheel(0, 4_000)
  await viewport.dispatchEvent('wheel', { ctrlKey: true, deltaY: 120 })
  await viewport.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('PageUp')
  await page.keyboard.press('Space')
  expect(
    await page.evaluate(() => {
      const store = window.openPencil?.getStore?.()
      return store
        ? {
            panX: store.state.panX,
            panY: store.state.panY,
            zoom: store.state.zoom
          }
        : null
    })
  ).toEqual(cameraBefore)

  await viewport.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeGreaterThan(100)
  await composer.fill('Give me a concise status update.')
  await conversation.getByRole('button', { name: 'Send message' }).click()
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeLessThanOrEqual(1)
  await expect
    .poll(() => followUps)
    .toEqual([
      {
        message: 'Give me a concise status update.',
        url: expect.stringContaining('/conversations/thread-11/follow-up')
      }
    ])
})

test('renders conversation navigation as a plain left-edge rail', async ({ page }) => {
  await mockThreads(page, [worker(11)])
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 11').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const viewport = conversation.getByTestId('ai-conversation-viewport')
  const rail = conversation.getByRole('navigation', { name: 'User messages' })
  const markers = rail.getByTestId('ai-conversation-chapter-marker')
  const viewportBox = await viewport.boundingBox()
  const railBox = await rail.boundingBox()
  expect(viewportBox).not.toBeNull()
  expect(railBox).not.toBeNull()
  if (!viewportBox || !railBox) throw new Error('Conversation navigation bounds missing')
  expect(Math.abs(railBox.x - viewportBox.x)).toBeLessThan(8)
  expect(railBox.width).toBeLessThan(28)
  await expect(rail).toHaveCSS('border-top-width', '0px')
  await expect(rail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(rail).toHaveCSS('box-shadow', 'none')

  await markers.nth(2).hover()
  const tooltip = page.getByTestId('ai-conversation-chapter-tooltip')
  await expect(tooltip).toBeVisible()
  const hoveredLineBox = await markers.nth(2).locator('span').nth(1).boundingBox()
  const distantLineBox = await markers.nth(8).locator('span').nth(1).boundingBox()
  expect(hoveredLineBox).not.toBeNull()
  expect(distantLineBox).not.toBeNull()
  if (!hoveredLineBox || !distantLineBox) {
    throw new Error('Conversation navigation marker bounds missing')
  }
  expect(Math.abs(hoveredLineBox.x - distantLineBox.x)).toBeLessThan(1)
  expect(hoveredLineBox.x + hoveredLineBox.width).toBeGreaterThan(
    distantLineBox.x + distantLineBox.width + 4
  )
  const tooltipBox = await tooltip.boundingBox()
  expect(tooltipBox).not.toBeNull()
  if (!tooltipBox) throw new Error('Conversation navigation tooltip bounds missing')
  expect(tooltipBox.x).toBeGreaterThan(railBox.x + railBox.width + 8)
})

test('hands the first prompt to its thread without filler or a surface remount', async ({
  page
}, testInfo) => {
  const threads = [worker(1)]
  const newTasks: string[] = []
  let releaseDispatch: (() => void) | undefined
  const dispatchGate = new Promise<void>((resolve) => {
    releaseDispatch = resolve
  })
  await mockThreads(page, threads)
  await page.route(/\/agent-router\/v1\/pi\/dispatch$/, async (route) => {
    const prompt = (route.request().postDataJSON() as { prompt: string }).prompt
    newTasks.push(prompt)
    await dispatchGate
    threads.unshift({
      ...worker(2),
      id: 'thread-new',
      // A newly accepted worker can appear in the preview feed before its
      // transcript endpoint exposes the first prompt. The draft handoff must
      // keep the optimistic prompt visible across that eventual-consistency gap.
      messages: [],
      state: 'running',
      task: 'Polished first-prompt handoff'
    })
    await route.fulfill({
      body: '{"dispatchedAt":"2026-08-16T00:02:00.000Z","jobId":"job-new","state":"queued","threadId":"thread-new"}',
      contentType: 'application/json',
      status: 202
    })
  })

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  const panel = page.getByTestId('agent-chats-panel')
  await panel.getByTestId('agent-thread-new').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const surface = conversation.getByTestId('ai-conversation-surface')
  const composer = conversation.getByRole('textbox', { name: 'New task' })
  const headerTitle = conversation.getByTestId('agent-selected-header-title')
  await surface.evaluate((element) => element.setAttribute('data-first-prompt-surface', 'stable'))
  const composerBefore = await composer.boundingBox()
  expect(composerBefore).not.toBeNull()

  await composer.fill('Polish the first prompt transition')
  await composer.press('Enter')
  await expect.poll(() => newTasks).toEqual(['Polish the first prompt transition'])
  await expect(headerTitle).toHaveText('Polish the first prompt transition')
  await expect(conversation.getByTestId('ai-conversation-empty')).toHaveCount(0)

  releaseDispatch?.()
  await expect(headerTitle).toHaveText('Polished first-prompt handoff')
  await expect(surface).toHaveAttribute('data-first-prompt-surface', 'stable')
  await expect(conversation.getByText(/^Task started\.?$/)).toHaveCount(0)
  await expect(conversation.getByText('Polish the first prompt transition')).toHaveCount(1)
  await conversation.screenshot({ path: testInfo.outputPath('first-prompt-handoff.png') })
  const composerAfter = await conversation.getByRole('textbox', { name: 'Follow up' }).boundingBox()
  expect(composerAfter).not.toBeNull()
  if (!composerBefore || !composerAfter) throw new Error('Composer bounds unavailable')
  expect(Math.abs(composerAfter.y - composerBefore.y)).toBeLessThan(2)
})

test('restores a new-task draft after leaving and reload', async ({ page }) => {
  await mockThreads(page, [worker(1)])
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const panel = page.getByTestId('agent-chats-panel')
  const conversation = page.getByTestId('agent-selected-conversation')
  await panel.getByTestId('agent-thread-new').click()
  const composer = conversation.getByRole('textbox', { name: 'New task' })
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  await conversation.getByTestId('ai-prompt-file-input').setInputFiles({
    buffer: png,
    mimeType: 'image/png',
    name: 'reference.png'
  })
  await composer.fill('Unsent previous draft')
  await expect(conversation.getByTestId('ai-prompt-attachment')).toHaveCount(1)

  await conversation.getByRole('button', { name: 'Back to tasks' }).click()
  await panel.getByTestId('agent-thread-new').click()
  await expect(conversation.getByTestId('agent-selected-header')).toContainText('New task')
  await expect(conversation.getByRole('textbox', { name: 'New task' })).toHaveValue(
    'Unsent previous draft'
  )
  await expect(conversation.getByTestId('ai-prompt-attachment')).toContainText('reference.png')

  await page.reload()
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await panel.getByTestId('agent-thread-new').click()
  await expect(conversation.getByRole('textbox', { name: 'New task' })).toHaveValue(
    'Unsent previous draft'
  )
  await expect(conversation.getByTestId('ai-prompt-attachment')).toContainText('reference.png')
})

test('restores each existing thread draft and its attachments after switching and reload', async ({
  page
}) => {
  await mockThreads(page, [worker(1), worker(2)])
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const selector = page.getByTestId('agent-thread-selector')
  await selector.getByText('Human task title 1').click()
  const composer = conversation.getByRole('textbox', { name: 'Follow up' })
  await composer.fill('Keep this thread-specific draft')
  await conversation.getByTestId('ai-prompt-file-input').setInputFiles({
    buffer: Buffer.from('thread attachment'),
    mimeType: 'text/plain',
    name: 'thread-notes.txt'
  })
  await expect(conversation.getByTestId('ai-prompt-attachment')).toContainText('thread-notes.txt')

  await conversation.getByRole('button', { name: 'Back to tasks' }).click()
  await selector.getByText('Human task title 2').click()
  await expect(conversation.getByRole('textbox', { name: 'Follow up' })).toHaveValue('')
  await conversation.getByRole('button', { name: 'Back to tasks' }).click()
  await selector.getByText('Human task title 1').click()
  await expect(composer).toHaveValue('Keep this thread-specific draft')
  await expect(conversation.getByTestId('ai-prompt-attachment')).toContainText('thread-notes.txt')

  await page.reload()
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 1').click()
  await expect(conversation.getByRole('textbox', { name: 'Follow up' })).toHaveValue(
    'Keep this thread-specific draft'
  )
  await expect(conversation.getByTestId('ai-prompt-attachment')).toContainText('thread-notes.txt')
})

test('shows the exact Messages send and waits for the in-chat Send button', async ({ page }) => {
  const approvalThread = messagesApprovalThread(20)
  const responses: Array<{ requestId: string; value?: string }> = []
  const sendToolPart = {
    input: JSON.stringify({
      Arguments: {
        chat_guid: 'iMessage;-;test-recipient',
        recipient_label: 'Test Recipient',
        texts: ['Be there in 10 minutes.', 'I’ll text when I arrive.']
      },
      ServerName: 'pi-antigravity-bridge',
      ToolName: 'messages__send_send_message'
    }),
    name: 'messages__send_send_message',
    output: '',
    state: 'running' as 'running' | 'success',
    type: 'tool' as const
  }
  await mockThreads(page, [approvalThread])
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/[^/]+\/ui\/[^/]+\/respond$/,
    async (route) => {
      const url = new URL(route.request().url())
      responses.push({
        requestId: decodeURIComponent(url.pathname.split('/ui/')[1]?.split('/')[0] ?? ''),
        ...(route.request().postDataJSON() as { value?: string })
      })
      approvalThread.pendingUiRequests = []
      approvalThread.messages.push({
        completedAt: '2026-08-22T14:30:02.000Z',
        createdAt: '2026-08-22T14:30:01.000Z',
        id: 'message-send-tool',
        parts: [sendToolPart],
        role: 'assistant',
        text: ''
      })
      await route.fulfill({
        body: '{"accepted":true}',
        contentType: 'application/json'
      })
    }
  )

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 20').click()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })

  const conversation = page.getByTestId('agent-selected-conversation')
  const approval = page.getByTestId('agent-ui-approval')
  await expect(approval.getByTestId('agent-message-recipient')).toHaveText('Test Recipient')
  await expect(approval.getByTestId('agent-message-approval-text')).toHaveText([
    'Be there in 10 minutes.',
    'I’ll text when I arrive.'
  ])
  await expect(conversation.getByTestId('ai-conversation-status')).toHaveCount(0)
  await expect(conversation.getByText(/Needs attention/)).toHaveCount(0)
  await expect
    .poll(() =>
      approval.evaluate((element) => ({
        backgroundColor: getComputedStyle(element).backgroundColor,
        borderTopWidth: getComputedStyle(element).borderTopWidth,
        boxShadow: getComputedStyle(element).boxShadow
      }))
    )
    .toEqual({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderTopWidth: '0px',
      boxShadow: 'none'
    })
  expect(await approval.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(
    160
  )
  await expect
    .poll(() =>
      approval
        .getByRole('button', { name: 'Send', exact: true })
        .evaluate((element) => getComputedStyle(element).color)
    )
    .toBe('rgb(0, 122, 255)')
  const bubbleRightEdges = await approval
    .getByTestId('agent-message-approval-text')
    .evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().right))
    )
  expect(new Set(bubbleRightEdges).size).toBe(1)
  const sendButtonBox = await approval
    .getByRole('button', { name: 'Send', exact: true })
    .evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { right: Math.round(rect.right), top: Math.round(rect.top) }
    })
  const lastBubbleBox = await approval
    .getByTestId('agent-message-approval-text')
    .last()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { bottom: Math.round(rect.bottom), right: Math.round(rect.right) }
    })
  expect(sendButtonBox.top).toBeGreaterThanOrEqual(lastBubbleBox.bottom + 3)
  expect(sendButtonBox.right).toBe(lastBubbleBox.right)
  const cancel = approval.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeVisible()
  await expect(approval).toHaveScreenshot('agent-message-approval-pending-light.png')
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await expect(approval).toHaveScreenshot('agent-message-approval-pending-dark.png')
  expect(responses).toEqual([])
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })

  await approval.getByRole('button', { name: 'Send', exact: true }).click()
  await expect
    .poll(() => responses)
    .toEqual([{ requestId: 'message-approval-20', value: 'Allow once' }])
  await expect(approval).toHaveAttribute('data-state', 'sending')
  await expect(approval.getByTestId('agent-message-approval-status')).toHaveText('Sending')
  await expect(approval).toHaveScreenshot('agent-message-approval-sending-light.png', {
    maxDiffPixelRatio: 0.055
  })

  sendToolPart.output = 'Message sent.'
  sendToolPart.state = 'success'
  approvalThread.updatedAt = '2026-08-22T14:30:03.000Z'
  await expect(approval).toHaveAttribute('data-state', 'sent')
  await expect(approval.getByTestId('agent-message-approval-status')).toHaveText('Sent')
  await expect(conversation.getByTestId('ai-conversation-status')).toHaveCount(0)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await expect(approval).toHaveScreenshot('agent-message-approval-sent-light.png', {
    maxDiffPixelRatio: 0.055
  })
  await expect
    .poll(() => approval.evaluate((element) => getComputedStyle(element).boxShadow))
    .toBe('none')

  await page.reload()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 20').click()
  const restoredApproval = page.getByTestId('agent-ui-approval')
  await expect(restoredApproval).toHaveCount(1)
  await expect(restoredApproval).toHaveAttribute('data-state', 'sent')
  await expect(restoredApproval.getByTestId('agent-message-recipient')).toHaveText('Test Recipient')
  await expect(restoredApproval.getByTestId('agent-message-approval-status')).toHaveText('Sent')
})

test('restores a completed Messages card from persisted tool history', async ({ page }) => {
  const thread = messagesApprovalThread(25)
  thread.pendingUiRequests = []
  thread.messages.push({
    completedAt: '2026-08-22T14:30:02.000Z',
    createdAt: '2026-08-22T14:30:01.000Z',
    id: 'persisted-message-send-tool',
    parts: [
      {
        input: JSON.stringify({
          chat_guid: 'iMessage;-;test-recipient',
          recipient_label: 'Test Recipient',
          text: 'Hi'
        }),
        name: 'messages__send_send_message',
        output: 'Message sent.',
        state: 'success',
        type: 'tool'
      }
    ],
    role: 'assistant',
    text: ''
  })
  await mockThreads(page, [thread])

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 25').click()

  const approval = page.getByTestId('agent-ui-approval')
  await expect(approval).toHaveCount(1)
  await expect(approval).toHaveAttribute('data-state', 'sent')
  await expect(approval.getByTestId('agent-message-recipient')).toHaveText('Test Recipient')
  await expect(approval.getByTestId('agent-message-approval-text')).toHaveText('Hi')
  await expect(approval.getByTestId('agent-message-approval-status')).toHaveText('Sent')
})

test('supersedes an untouched Messages approval and keeps it with its original turn', async ({
  page
}) => {
  const approvalThread = messagesApprovalThread(24)
  const followUps: string[] = []
  await mockThreads(page, [approvalThread])
  await page.route(/\/agent-router\/v1\/pi\/conversations\/[^/]+\/follow-up/, async (route) => {
    followUps.push((route.request().postDataJSON() as { message: string }).message)
    await route.fulfill({
      body: '{"dispatchedAt":"2026-08-22T14:31:00.000Z","jobId":"job-1","state":"running","threadId":"thread-24"}',
      contentType: 'application/json',
      status: 202
    })
  })

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 24').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const approval = conversation.getByTestId('agent-ui-approval')
  await expect(approval).toHaveAttribute('data-state', 'pending')

  const composer = conversation.getByRole('textbox', { name: 'Follow up' })
  await composer.fill('Use the newer wording instead.')
  await conversation.getByRole('button', { name: 'Send message' }).click()

  await expect.poll(() => followUps).toEqual(['Use the newer wording instead.'])
  await expect(approval).toHaveAttribute('data-state', 'cancelled')
  await expect(approval.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
  await expect(approval.getByRole('button', { name: 'Send', exact: true })).toHaveCount(0)
  await expect(approval.getByTestId('agent-message-approval-status')).toHaveText('Cancelled')
  await expect(
    conversation.getByText('Use the newer wording instead.', { exact: true })
  ).toBeVisible()
  await expect(conversation.getByTestId('agent-approval-column')).toHaveAttribute(
    'data-run-id',
    'agent:thread-24:message-24-22'
  )

  const approvalBox = await approval.boundingBox()
  const newerPromptBox = await conversation
    .getByText('Use the newer wording instead.', { exact: true })
    .boundingBox()
  expect(approvalBox?.y).toBeLessThan(newerPromptBox?.y ?? Number.NEGATIVE_INFINITY)
  await expect(conversation.getByRole('log', { name: 'Conversation transcript' })).toHaveScreenshot(
    'agent-message-approval-superseded-in-transcript.png'
  )
})

test('settles a declined Messages approval into the cancelled state', async ({ page }) => {
  const approvalThread = messagesApprovalThread(21)
  const responses: Array<{ requestId: string; value?: string }> = []
  await mockThreads(page, [approvalThread])
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/[^/]+\/ui\/[^/]+\/respond$/,
    async (route) => {
      const url = new URL(route.request().url())
      responses.push({
        requestId: decodeURIComponent(url.pathname.split('/ui/')[1]?.split('/')[0] ?? ''),
        ...(route.request().postDataJSON() as { value?: string })
      })
      approvalThread.pendingUiRequests = []
      await route.fulfill({
        body: '{"accepted":true}',
        contentType: 'application/json'
      })
    }
  )

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 21').click()

  const approval = page.getByTestId('agent-ui-approval')
  await approval.hover()
  await approval.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => responses).toEqual([{ requestId: 'message-approval-21', value: 'Deny' }])
  await expect(approval).toHaveAttribute('data-state', 'cancelled')
  await expect(approval.getByTestId('agent-message-approval-status')).toHaveText('Cancelled')
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await expect(approval).toHaveScreenshot('agent-message-approval-cancelled-light.png', {
    maxDiffPixelRatio: 0.055
  })
})

test('settles a failed Messages send into the inline Not sent state', async ({ page }) => {
  const approvalThread = messagesApprovalThread(22)
  await mockThreads(page, [approvalThread])
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/[^/]+\/ui\/[^/]+\/respond$/,
    async (route) => {
      approvalThread.pendingUiRequests = []
      approvalThread.messages.push({
        completedAt: '2026-08-22T14:30:02.000Z',
        createdAt: '2026-08-22T14:30:01.000Z',
        id: 'message-send-error',
        parts: [
          {
            input: JSON.stringify({
              chat_guid: 'iMessage;-;test-recipient',
              recipient_label: 'Test Recipient',
              texts: ['Be there in 10 minutes.', 'I’ll text when I arrive.']
            }),
            name: 'messages__send_send_message',
            output: 'Messages unavailable.',
            state: 'error',
            type: 'tool'
          }
        ],
        role: 'assistant',
        text: ''
      })
      approvalThread.updatedAt = '2026-08-22T14:30:03.000Z'
      await route.fulfill({
        body: '{"accepted":true}',
        contentType: 'application/json'
      })
    }
  )

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 22').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const approval = conversation.getByTestId('agent-ui-approval')
  await approval.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(approval).toHaveAttribute('data-state', 'failed')
  await expect(approval.getByTestId('agent-message-approval-status')).toHaveText('Not sent')
  await expect(conversation.getByTestId('ai-conversation-status')).toHaveCount(0)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await expect(approval).toHaveScreenshot('agent-message-approval-not-sent-light.png', {
    maxDiffPixelRatio: 0.055
  })
})

test('steers a running task from the live composer instead of queueing a follow-up', async ({
  page
}) => {
  const steers: string[] = []
  const followUps: string[] = []
  const running = worker(0)
  await mockThreads(page, [
    {
      ...running,
      messages: [
        {
          createdAt: running.createdAt,
          id: 'initial-prompt',
          role: 'user',
          text: 'Start the task.'
        },
        {
          createdAt: running.createdAt,
          id: 'initial-activity',
          parts: [
            {
              state: 'streaming',
              text: '',
              type: 'reasoning'
            },
            {
              input: '{"prompt":"A calm abstract dental illustration"}',
              name: 'ima2-media_generate_image',
              state: 'running',
              type: 'tool'
            }
          ],
          role: 'assistant',
          text: ''
        },
        {
          createdAt: running.createdAt,
          id: 'first-steer',
          role: 'user',
          text: 'Keep the current direction.'
        }
      ]
    }
  ])
  await page.route(/\/agent-router\/v1\/pi\/conversations\/[^/]+\/steer$/, async (route) => {
    steers.push((route.request().postDataJSON() as { message: string }).message)
    await route.fulfill({
      body: '{"dispatchedAt":"2026-08-16T00:02:00.000Z","jobId":"job-1","state":"running","threadId":"thread-0"}',
      contentType: 'application/json',
      status: 202
    })
  })
  await page.route(/\/agent-router\/v1\/pi\/conversations\/[^/]+\/follow-up$/, async (route) => {
    followUps.push((route.request().postDataJSON() as { message: string }).message)
    await route.fulfill({ status: 500 })
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const panel = page.getByTestId('agent-chats-panel')
  await panel.getByTestId('agent-thread-selector').getByText('Human task title 0').click()
  await expect(panel.getByText('No final response')).toHaveCount(0)
  const imageGeneration = panel.getByTestId('ai-image-generation')
  await expect(imageGeneration).toBeVisible()
  await expect(imageGeneration).toHaveAttribute('data-state', 'running')
  const imageDuration = imageGeneration.locator('xpath=../..').getByTestId('ai-turn-duration')
  await expect(imageDuration).toContainText('Creating image for')
  await expect(imageDuration).not.toContainText('Working')
  await expect(panel.getByTestId('ai-reasoning')).toHaveCount(0)
  const composer = panel.getByRole('textbox', { name: 'Follow up' })
  await expect(composer).toHaveAttribute('placeholder', 'Add instructions…')
  await expect(panel.getByRole('button', { name: 'Stop response' })).toBeVisible()
  await composer.fill('Keep the current work, but make the card smaller.')
  await panel.getByRole('button', { name: 'Steer task' }).click()

  await expect.poll(() => steers).toEqual(['Keep the current work, but make the card smaller.'])
  expect(followUps).toEqual([])
  await expect(composer).toHaveValue('')
  await expect(panel.getByText('No final response')).toHaveCount(0)
  await expect(imageGeneration).toBeVisible()
  await expect(imageGeneration).toHaveAttribute('data-state', 'running')
})

test('copies user prompts and assistant responses', async ({ page }) => {
  const thread = {
    ...worker(1),
    id: 'copy-thread',
    messages: [
      {
        createdAt: '2026-08-16T12:00:00.000Z',
        id: 'copy-user',
        role: 'user',
        text: 'User prompt to copy.'
      },
      {
        createdAt: '2026-08-16T12:00:01.000Z',
        id: 'copy-assistant',
        role: 'assistant',
        text: 'Assistant response to copy.'
      }
    ],
    task: 'Copy controls'
  }
  await mockThreads(page, [thread])
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const panel = page.getByTestId('agent-chats-panel')
  await panel.getByTestId('agent-thread-selector').getByText('Copy controls').click()
  const userMessage = panel.getByTestId('ai-message').and(panel.locator('[data-role="user"]'))
  const userCopy = userMessage.getByRole('button', { name: 'Copy prompt' })
  const userActions = userMessage.getByTestId('ai-message-actions')
  await expect(userMessage.getByTestId('ai-message-time')).toHaveAttribute(
    'datetime',
    '2026-08-16T12:00:00.000Z'
  )
  await expect(userMessage.getByTestId('ai-message-time')).toHaveText(/\d{1,2}:\d{2}/)
  await expect(userActions).toHaveCSS('opacity', '0')
  const userContentBox = await userMessage.getByTestId('ai-message-content').boundingBox()
  const userActionsBox = await userActions.boundingBox()
  expect(userActionsBox?.y).toBeGreaterThanOrEqual(
    (userContentBox?.y ?? 0) + (userContentBox?.height ?? Number.POSITIVE_INFINITY)
  )
  await userMessage.hover()
  await expect(userActions).toHaveCSS('opacity', '1')
  await userCopy.click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('User prompt to copy.')

  const assistantMessage = panel
    .getByTestId('ai-message')
    .and(panel.locator('[data-role="assistant"]'))
  const assistantCopy = assistantMessage.getByRole('button', {
    name: 'Copy message'
  })
  const assistantActions = assistantMessage.getByTestId('ai-message-actions')
  await expect(assistantMessage.getByTestId('ai-message-time')).toHaveAttribute(
    'datetime',
    '2026-08-16T12:00:01.000Z'
  )
  await expect(assistantMessage.getByTestId('ai-message-time')).toHaveText(/\d{1,2}:\d{2}/)
  await expect(assistantActions).toHaveCSS('opacity', '0')
  const assistantContentBox = await assistantMessage.getByTestId('ai-message-content').boundingBox()
  const assistantActionsBox = await assistantActions.boundingBox()
  expect(assistantActionsBox?.y).toBeGreaterThanOrEqual(
    (assistantContentBox?.y ?? 0) + (assistantContentBox?.height ?? Number.POSITIVE_INFINITY)
  )
  await assistantMessage.hover()
  await expect(assistantActions).toHaveCSS('opacity', '1')
  await assistantCopy.click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('Assistant response to copy.')
})

test('shows Pi context remaining and measured stream throughput', async ({ page }) => {
  const estimatedWorker = {
    ...worker(1),
    contextUsage: { ...worker(1).contextUsage, tokensPerSecondEstimated: true }
  }
  const unavailableWorker = {
    ...worker(2),
    contextUsage: {
      autoCompactionEnabled: true,
      cacheHitPercent: 86,
      compacting: false,
      contextWindow: 500_000,
      percent: 18,
      tokens: 90_000
    }
  }
  const workers = [{ ...worker(0), state: 'completed' }, estimatedWorker, unavailableWorker]
  await mockThreads(page, workers)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  await page.getByTestId('agent-thread-selector').getByText('Human task title 0').click()
  const contextIndicator = conversation.getByTestId('ai-context-indicator')
  await expect(contextIndicator).toHaveAttribute('aria-label', /25 t\/s measured stream average/)
  await expect(contextIndicator.getByTestId('ai-context-throughput')).toHaveText('25 t/s')
  await contextIndicator.hover()
  await expect(page.getByRole('tooltip')).toContainText('82% context left')
  await expect(page.getByRole('tooltip')).toContainText('Auto-compaction on')
  const ring = contextIndicator.getByTestId('ai-context-ring')
  await expect(ring).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(ring).toHaveCSS('overflow', 'hidden')
  const progress = contextIndicator.getByTestId('ai-context-progress')
  await expect(progress).toHaveAttribute('stroke-linecap', 'round')
  expect(
    await progress.evaluate((element) => {
      const circle = element as SVGCircleElement
      return circle.r.baseVal.value + Number(circle.getAttribute('stroke-width')) / 2
    })
  ).toBeLessThan(6)
  await expect(ring).toHaveScreenshot('agent-context-ring.png')

  await conversation.getByTestId('agent-thread-back').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 1').click()
  await expect(contextIndicator.getByTestId('ai-context-throughput')).toHaveText('~25 t/s')
  await expect(contextIndicator).toHaveAttribute('aria-label', /estimated from streamed text/)

  await conversation.getByTestId('agent-thread-back').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 2').click()
  await expect(contextIndicator.getByTestId('ai-context-throughput')).toHaveText('— t/s')
  await expect(contextIndicator).toHaveAttribute('aria-label', /Throughput unavailable/)

  await conversation.getByTestId('agent-thread-back').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 0').click()
  const toolbar = conversation.getByTestId('ai-prompt-toolbar')
  const model = toolbar.getByTestId('agent-model-trigger')
  await expect(model).toContainText('Grok 4.6')
  await page.route(/\/agent-router\/v1\/pi\/provider-usage\/xAI$/, (route) =>
    route.fulfill({
      body: JSON.stringify({
        usage: {
          provider: 'xAI',
          queriedAt: '2026-08-21T20:00:00.000Z',
          remainingPercent: 98,
          resetAt: '2026-08-28T00:00:00Z',
          subscription: 'SuperGrok',
          usedPercent: 2
        }
      }),
      contentType: 'application/json'
    })
  )
  await model.click()
  await expect(page.getByTestId('agent-model-menu')).toBeVisible()
  await expect(page.getByTestId('agent-provider-usage')).toHaveText('98% left')
  await expect(page.getByTestId('agent-model-menu')).toHaveScreenshot(
    'agent-model-provider-usage.png'
  )
  await expect(contextIndicator).toHaveScreenshot('agent-context-transparent-ring.png')
  await page.keyboard.press('Escape')
  expect(
    await toolbar.evaluate((element) => {
      const context = element.querySelector('[data-test-id="ai-context-indicator"]')
      const modelTrigger = element.querySelector('[data-test-id="agent-model-trigger"]')
      const action = element.querySelector(
        '[data-test-id="ai-prompt-send"], [data-test-id="ai-prompt-stop"], [data-test-id="ai-prompt-retry"], [data-test-id="ai-prompt-dictation"]'
      )
      if (!context || !modelTrigger || !action) return false
      return (
        Boolean(context.compareDocumentPosition(modelTrigger) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        Boolean(modelTrigger.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING)
      )
    })
  ).toBe(true)
})

test('renders AI Elements Vue parts and chat lifecycle controls', async ({ page }) => {
  let lifecycle: 'complete' | 'streaming' = 'streaming'
  let followUpAttempts = 0
  let stopAttempts = 0
  let imageEvidenceBase64 = ''
  const imageEditHandoffs: Array<{
    displayPrompt: string
    evidenceId: string
    message: string
  }> = []
  const sentMessages: string[] = []
  const messages = [
    ...Array.from({ length: 18 }, (_, index) => ({
      ...(index === 16 ? { completedAt: '2026-08-16T00:02:00.000Z' } : {}),
      createdAt: '2026-08-16T00:00:00.000Z',
      id: `scroll-message-${String(index)}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `Scrollable conversation row ${String(index + 1)}`
    })),
    {
      createdAt: '2026-08-16T00:01:00.000Z',
      id: 'rich-message',
      role: 'assistant',
      text: '',
      parts: [
        { text: '**Structured response**', type: 'text' },
        {
          state: 'complete',
          text: 'Checked the scoped files.',
          type: 'commentary'
        },
        {
          input: '{"path":"README.md"}',
          name: 'read_file',
          state: 'pending',
          type: 'tool'
        },
        {
          input: '{"query":"chat"}',
          name: 'search',
          state: 'running',
          type: 'tool'
        },
        {
          images: [
            {
              alt: 'Board screenshot',
              url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>'
            }
          ],
          name: 'verify',
          output: 'Passed',
          state: 'success',
          type: 'tool'
        },
        {
          images: [
            {
              alt: 'Generated enamel illustration',
              url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><defs><linearGradient id="g"><stop stop-color="%236366f1"/><stop offset="1" stop-color="%2306b6d4"/></linearGradient></defs><rect x="36" y="20" width="248" height="200" rx="52" fill="url(%23g)"/><circle cx="160" cy="120" r="62" fill="white" fill-opacity=".85"/></svg>'
            }
          ],
          input: '{"prompt":"A translucent enamel anatomy illustration"}',
          name: 'ima2-media_generate_image',
          state: 'running',
          type: 'tool'
        },
        {
          error: 'Permission denied',
          name: 'write_file',
          state: 'error',
          type: 'tool'
        },
        { name: 'publish', state: 'approval', type: 'tool' },
        {
          code: 'const status = "ready"',
          filename: 'status.ts',
          language: 'ts',
          type: 'code'
        },
        {
          mediaType: 'text/plain',
          name: 'agent-notes.txt',
          size: 2048,
          type: 'attachment'
        },
        {
          alt: 'Agent preview',
          type: 'image',
          url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="purple"/></svg>'
        },
        {
          label: 'OpenPencil docs',
          title: 'OpenPencil',
          type: 'source',
          url: 'https://openpencil.dev'
        }
      ]
    }
  ]

  const richThread = () => ({
    canFollowUp: true,
    createdAt: '2026-08-16T00:00:00.000Z',
    effort: 'medium',
    id: 'rich-thread',
    messages,
    model: 'cursor/composer-2.5-fast',
    recentUpdate: 'AI Elements Vue state coverage',
    get state() {
      return lifecycle === 'streaming' ? 'running' : 'completed'
    },
    task: 'Rich chat rendering',
    updatedAt: '2026-08-16T00:02:00.000Z',
    workerId: 'worker-1'
  })
  await mockThreads(page, [richThread()])
  await page.route(
    'http://127.0.0.1:7602/agent-router/v1/pi/conversations/rich-thread/follow-up',
    async (route) => {
      const body = route.request().postDataJSON() as {
        displayPrompt?: string
        evidenceId?: string
        message: string
      }
      if (body.evidenceId) {
        imageEditHandoffs.push({
          displayPrompt: body.displayPrompt ?? '',
          evidenceId: body.evidenceId,
          message: body.message
        })
        await route.fulfill({
          body: '{"dispatchedAt":"2026-08-16T00:02:00.000Z","jobId":"job-image-edit","state":"queued","threadId":"rich-thread"}',
          contentType: 'application/json',
          status: 202
        })
        return
      }
      followUpAttempts += 1
      sentMessages.push(body.message)
      if (followUpAttempts === 1) {
        await route.fulfill({
          body: '{"error":"Temporary agent error"}',
          contentType: 'application/json',
          status: 503
        })
        return
      }
      await route.fulfill({
        body: '{"dispatchedAt":"2026-08-16T00:02:00.000Z","jobId":"job-rich","state":"queued","threadId":"rich-thread"}',
        contentType: 'application/json',
        status: 202
      })
    }
  )
  await page.route(
    'http://127.0.0.1:7602/agent-router/v1/pi/conversations/rich-thread/stop',
    async (route) => {
      stopAttempts += 1
      lifecycle = 'complete'
      await route.fulfill({
        body: '{"stopped":true}',
        contentType: 'application/json'
      })
    }
  )
  await page.route('http://127.0.0.1:7602/local-workspace/v1/trace/evidence', async (route) => {
    imageEvidenceBase64 =
      (route.request().postDataJSON() as { evidenceBase64?: string }).evidenceBase64 ?? ''
    await route.fulfill({
      body: '{"persisted":true}',
      contentType: 'application/json'
    })
  })

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const panel = page.getByTestId('agent-chats-panel')
  await panel.getByTestId('agent-thread-selector').getByText('Rich chat rendering').click()
  const viewport = panel.getByTestId('ai-conversation-viewport')
  const activityDisclosure = panel.getByTestId('ai-activity-disclosure').last()
  await expect(activityDisclosure).toBeVisible()
  const durationDivider = activityDisclosure.getByTestId('ai-turn-duration')
  await expect(durationDivider).toContainText('Thinking')
  await expect(activityDisclosure.getByTestId('ai-activity-timeline')).toHaveCount(0)
  await durationDivider.click()
  const commentaries = activityDisclosure.getByTestId('ai-commentary')
  await expect(commentaries).toHaveText('Checked the scoped files.')
  await expect(commentaries.locator('svg, button')).toHaveCount(0)
  const toolGroup = activityDisclosure
    .getByTestId('ai-tool-group')
    .filter({ hasText: 'Read files, searched, used tools, edited files' })
  await expect(toolGroup).toBeVisible()
  await expect(toolGroup.getByTestId('ai-tool-group-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(activityDisclosure.getByTestId('ai-tool-call')).toHaveCount(0)
  await toolGroup.getByTestId('ai-tool-group-toggle').click()
  await expect(activityDisclosure.getByTestId('ai-tool-call')).toHaveCount(5)
  const imageGeneration = panel.getByTestId('ai-image-generation')
  await expect(imageGeneration).toBeVisible()
  await expect(imageGeneration).toHaveAttribute('data-provider', 'codex')
  await expect(imageGeneration).toHaveAttribute('data-state', 'running')
  await expect(imageGeneration).toContainText('Creating image')
  await expect(imageGeneration).toContainText('A translucent enamel anatomy illustration')
  const replyBox = await panel.getByText('Structured response', { exact: true }).boundingBox()
  const imageBox = await imageGeneration.boundingBox()
  expect(imageBox?.y).toBeGreaterThan(replyBox?.y ?? Number.POSITIVE_INFINITY)
  await expect(imageGeneration).toHaveScreenshot('agent-image-generation-loading.png')
  await expect(panel.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Reject' })).toHaveCount(0)
  const timeline = activityDisclosure.getByTestId('ai-activity-timeline')
  expect(
    await timeline.evaluate((element) =>
      [...element.children].map((child) => ({
        id: child.getAttribute('data-test-id'),
        text: child.textContent?.trim()
      }))
    )
  ).toEqual([{ id: 'ai-commentary', text: 'Checked the scoped files.' }])
  expect(
    await timeline.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        borderLeftWidth: style.borderLeftWidth,
        paddingLeft: style.paddingLeft
      }
    })
  ).toEqual({ borderLeftWidth: '0px', paddingLeft: '0px' })
  const screenshotTool = activityDisclosure
    .getByTestId('ai-tool-call')
    .filter({ hasText: 'verify' })
  const screenshotDisclosure = screenshotTool.getByTestId('ai-tool-disclosure')
  await expect(screenshotDisclosure).toHaveCSS('opacity', '0')
  await screenshotTool.hover()
  await expect(screenshotDisclosure).toHaveCSS('opacity', '1')
  await expect(screenshotDisclosure.getByTestId('ai-disclosure-chevron')).toHaveAttribute(
    'data-direction',
    'right'
  )
  await screenshotDisclosure.click()
  await expect(screenshotDisclosure.getByTestId('ai-disclosure-chevron')).toHaveAttribute(
    'data-direction',
    'down'
  )
  await expect(screenshotTool.getByAltText('Board screenshot')).toBeVisible()
  const failedTool = activityDisclosure
    .getByTestId('ai-tool-call')
    .filter({ hasText: 'Edited files' })
  await failedTool.getByTestId('ai-tool-disclosure').click()
  await expect(failedTool).toContainText('Permission denied')
  await expect(panel.getByTestId('ai-code-block')).toContainText('const status = "ready"')
  await expect(panel.getByText('agent-notes.txt')).toBeVisible()
  await expect(panel.getByAltText('Agent preview')).toBeVisible()
  await expect(panel.getByText('1 source')).toBeVisible()
  const copyMessage = panel.getByRole('button', { name: 'Copy message' }).first()
  await expect(copyMessage).toBeVisible()
  expect(await copyMessage.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  await panel.getByRole('button', { name: 'Stop response' }).click()
  await expect.poll(() => stopAttempts).toBe(1)
  await expect(panel.getByTestId('ai-conversation-status')).toHaveCount(0)
  await expect(durationDivider).toContainText('Worked for 2m 0s')
  await expect(imageGeneration).toHaveAttribute('data-state', 'success')
  await expect(imageGeneration.getByAltText('Generated enamel illustration')).toBeVisible()
  await expect(imageGeneration).not.toContainText('Image created')
  await expect(imageGeneration).not.toContainText('Codex Image')
  const completedImageSize = await imageGeneration.evaluate((element) => {
    const image = element.querySelector('img')
    const stage = element.querySelector('button')
    if (!image || !stage) return null
    const cardBox = element.getBoundingClientRect()
    const stageBox = stage.getBoundingClientRect()
    const imageBox = image.getBoundingClientRect()
    return {
      backgroundImage: getComputedStyle(stage).backgroundImage,
      height: imageBox.height,
      imageRadius: getComputedStyle(image).borderRadius,
      leftInset: imageBox.left - stageBox.left,
      objectFit: getComputedStyle(image).objectFit,
      rightInset: stageBox.right - imageBox.right,
      widthDifference: Math.abs(cardBox.width - imageBox.width)
    }
  })
  expect(completedImageSize?.height).toBeLessThanOrEqual(340)
  expect(completedImageSize?.widthDifference).toBeLessThanOrEqual(2)
  expect(completedImageSize?.leftInset).toBeLessThanOrEqual(1)
  expect(completedImageSize?.rightInset).toBeLessThanOrEqual(1)
  expect(completedImageSize?.imageRadius).toBe('14px')
  expect(completedImageSize?.objectFit).toBe('contain')
  expect(completedImageSize?.backgroundImage).toBe('none')
  await imageGeneration.getByRole('button', { name: 'Annotate generated image' }).click()
  const imageEditor = page.getByTestId('context-comment-screenshot-editor')
  await expect(imageEditor).toBeVisible()
  await expect(imageEditor.getByAltText('Generated image being annotated')).toBeVisible()
  await expect(imageEditor.getByTestId('context-comment-resize-capture')).toHaveCount(0)
  await expect.poll(() => imageEvidenceBase64.length).toBeGreaterThan(0)
  expect(
    await page.evaluate(
      (base64) =>
        new Promise<number>((resolve, reject) => {
          const image = new Image()
          image.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            const context = canvas.getContext('2d')
            if (!context) return reject(new Error('Canvas context unavailable'))
            context.drawImage(image, 0, 0)
            resolve(context.getImageData(0, 0, 1, 1).data[3])
          }
          image.onerror = () => reject(new Error('Evidence image unavailable'))
          image.src = `data:image/png;base64,${base64}`
        }),
      imageEvidenceBase64
    )
  ).toBe(0)
  await imageEditor
    .getByTestId('context-comment-capture-image')
    .click({ position: { x: 160, y: 90 } })
  await imageEditor.getByRole('textbox', { name: 'Image comment 1' }).fill('Make this edge softer')
  await imageEditor.getByRole('textbox', { name: 'Additional instructions' }).fill('Keep alpha.')
  await imageEditor.getByRole('button', { name: 'Send image edit' }).click()
  await expect(imageEditor).toHaveCount(0)
  await expect.poll(() => imageEditHandoffs).toHaveLength(1)
  expect(imageEditHandoffs[0]?.displayPrompt).toContain('Make this edge softer')
  expect(imageEditHandoffs[0]?.message).toContain('Edit the attached image')
  expect(imageEditHandoffs[0]?.message).toContain(
    'Preserve its alpha channel and keep the background transparent.'
  )
  expect(imageEditHandoffs[0]?.message).toContain('Do not flatten it onto white, black')
  expect(imageEditHandoffs[0]?.message).toContain('Keep alpha.')
  await expect(activityDisclosure.getByTestId('ai-commentary')).toHaveText(
    'Checked the scoped files.'
  )
  await expect(
    activityDisclosure.getByTestId('ai-tool-call').and(page.locator('[data-state="success"]'))
  ).toHaveCount(3)
  await expect(failedTool).toHaveAttribute('data-state', 'error')

  await panel.getByRole('button', { name: 'Copy code' }).click()
  await expect(panel.getByRole('button', { name: 'Code copied' })).toBeVisible()

  await viewport.evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(panel.getByRole('button', { name: 'Scroll to latest message' })).toBeVisible()
  await panel.getByRole('button', { name: 'Scroll to latest message' }).click()
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeLessThan(3)

  await expect(panel.getByTestId('ai-conversation-status')).toHaveCount(0, {
    timeout: 4_000
  })

  const composer = panel.getByRole('textbox', { name: 'Follow up' })
  await composer.fill('First line')
  await composer.press('Shift+Enter')
  await composer.type('Second line')
  await composer.press('Enter')
  await expect(panel.getByText('First line\nSecond line')).toBeVisible()
  await expect(panel.getByTestId('ai-activity-disclosure').last()).toBeVisible()
  await expect(panel.getByText('Temporary agent error')).toBeVisible()
  await expect(composer).toHaveValue('First line\nSecond line')
  await expect(panel.getByRole('button', { name: 'Retry message' })).toHaveCount(0)
  await panel.getByRole('button', { name: 'Send message' }).click()
  await expect
    .poll(() => sentMessages)
    .toEqual(['First line\nSecond line', 'First line\nSecond line'])
})

test('clears an accepted follow-up and exposes Stop while the job runs', async ({ page }) => {
  let releaseFollowUp: (() => void) | undefined
  const followUpGate = new Promise<void>((resolve) => {
    releaseFollowUp = resolve
  })
  let releaseJob: (() => void) | undefined
  const jobGate = new Promise<void>((resolve) => {
    releaseJob = resolve
  })
  await mockThreads(page, [worker(1)])
  await page.route(/\/agent-router\/v1\/pi\/conversations\/[^/]+\/follow-up/, async (route) => {
    await followUpGate
    await route.fulfill({
      body: '{"dispatchedAt":"2026-08-16T00:02:00.000Z","jobId":"job-1","state":"running","threadId":"thread-1"}',
      contentType: 'application/json',
      status: 202
    })
  })
  await page.route(/\/agent-router\/v1\/pi\/jobs\/job-1$/, async (route) => {
    await jobGate
    await route.fulfill({
      body: '{"response":"Done.","state":"completed"}',
      contentType: 'application/json'
    })
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  const panel = page.getByTestId('agent-chats-panel')
  await panel.getByTestId('agent-thread-selector').getByText('Human task title 1').click()
  const composer = panel.getByRole('textbox', { name: 'Follow up' })
  await composer.fill('Show the immediate pending state')
  await composer.press('Enter')
  await expect(panel.getByText('Show the immediate pending state')).toBeVisible()
  await expect(panel.getByTestId('ai-activity-disclosure')).toBeVisible()
  releaseFollowUp?.()
  await expect(composer).toHaveValue('')
  await expect(panel.getByRole('button', { name: 'Stop response' })).toBeVisible()
  releaseJob?.()
  await expect(panel.getByText('Done.')).toBeVisible()
})

test('shows one video generation card and opens the completed clip in a viewer', async ({
  page
}) => {
  const videoTool: {
    input: string
    name: string
    state: string
    type: string
    videos?: Array<{ mimeType: string; name: string; url: string }>
  } = {
    input: '{"prompt":"A cinematic paper airplane crossing a studio"}',
    name: 'ima2-media_generate_video',
    state: 'running',
    type: 'tool'
  }
  const thread = {
    canFollowUp: true,
    createdAt: '2026-08-22T02:00:00.000Z',
    effort: 'high',
    id: 'video-thread',
    messages: [
      {
        createdAt: '2026-08-22T02:00:00.000Z',
        id: 'video-prompt',
        role: 'user',
        text: 'Make a short video.'
      },
      {
        createdAt: '2026-08-22T02:00:01.000Z',
        id: 'video-tool',
        parts: [{ state: 'streaming', text: '', type: 'reasoning' }, videoTool],
        role: 'assistant',
        text: ''
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Generating video',
    state: 'running',
    task: 'Video generation',
    updatedAt: '2026-08-22T02:00:01.000Z',
    workerId: 'worker-video'
  }
  await mockThreads(page, [thread])
  await page.route(/\/agent-router\/v1\/pi\/media\/.*\.webm$/, (route) =>
    route.fulfill({
      contentType: 'video/webm',
      path: resolve('packages/demos/videos/toolbar.webm')
    })
  )

  async function openVideoThread() {
    await page.goto('/?test&no-rulers')
    await new CanvasHelper(page).waitForInit()
    await page.getByTestId('left-panel-chats-tab').click()
    const panel = page.getByTestId('agent-chats-panel')
    await panel.getByTestId('agent-thread-selector').getByText('Video generation').click()
    return panel
  }

  let panel = await openVideoThread()
  const runningCard = panel.getByTestId('ai-video-generation')
  await expect(runningCard).toHaveAttribute('data-state', 'running')
  await expect(runningCard).toContainText('Creating video…')
  await expect(panel.getByTestId('ai-turn-duration')).toContainText('Creating video for')
  await expect(panel.getByTestId('ai-reasoning')).toHaveCount(0)

  thread.state = 'completed'
  thread.recentUpdate = 'Video generated'
  thread.updatedAt = '2026-08-22T02:00:05.000Z'
  videoTool.state = 'success'
  videoTool.videos = [
    {
      mimeType: 'video/webm',
      name: 'generated.webm',
      url: '/agent-router/v1/pi/media/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webm'
    }
  ]

  panel = await openVideoThread()
  const completedCard = panel.getByTestId('ai-video-generation')
  await expect(completedCard).toHaveAttribute('data-state', 'success')
  const inlineVideo = completedCard.locator('video')
  await expect(inlineVideo).toBeVisible()
  await expect(inlineVideo).toHaveAttribute('controls', '')
  await expect.poll(() => inlineVideo.evaluate((element) => element.readyState)).toBeGreaterThan(0)
  const promptBox = await panel.getByText('Make a short video.').boundingBox()
  const cardBox = await completedCard.boundingBox()
  expect(cardBox?.y).toBeGreaterThan(promptBox?.y ?? Number.POSITIVE_INFINITY)

  await completedCard.getByRole('button', { name: 'Open generated video 1 in viewer' }).click()
  const viewer = page.getByTestId('ai-video-viewer')
  await expect(viewer).toBeVisible()
  await expect(viewer.locator('video')).toHaveAttribute('controls', '')
  await viewer.getByRole('button', { name: 'Close video viewer' }).click()
  await expect(viewer).toHaveCount(0)
})

test('does not jump the sidebar chat when menus open or a new chat starts', async ({ page }) => {
  await mockThreads(page, [worker(11)])
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  await page.getByTestId('agent-thread-selector').getByText('Human task title 11').click()
  await expect(conversation.getByTestId('agent-selected-header')).toContainText(
    'Human task title 11'
  )

  async function chromeGeometry() {
    return conversation.evaluate((root) => {
      const header = root.querySelector('[data-test-id="agent-selected-header"]')
      const composer = root.querySelector('[data-test-id="ai-prompt-input"]')
      const viewport = root.querySelector('[data-test-id="ai-conversation-viewport"]')
      if (
        !(header instanceof HTMLElement) ||
        !(composer instanceof HTMLElement) ||
        !(viewport instanceof HTMLElement)
      ) {
        throw new Error('missing chat chrome')
      }
      const scrolled: Array<{ id: string | null; scrollTop: number }> = []
      for (
        let node: HTMLElement | null = root;
        node instanceof HTMLElement;
        node = node.parentElement
      ) {
        if (node.scrollTop !== 0) {
          scrolled.push({ id: node.getAttribute('data-test-id'), scrollTop: node.scrollTop })
        }
      }
      return {
        composerY: Math.round(composer.getBoundingClientRect().top),
        headerY: Math.round(header.getBoundingClientRect().top),
        scrolled,
        viewportY: Math.round(viewport.getBoundingClientRect().top)
      }
    })
  }

  const before = await chromeGeometry()
  expect(before.scrolled).toEqual([])

  await conversation.getByTestId('agent-model-trigger').click()
  await expect(page.getByTestId('agent-model-menu')).toBeVisible()
  expect(await chromeGeometry()).toEqual(before)
  await page.keyboard.press('Escape')

  await conversation.getByTestId('ai-prompt-attach').click()
  await expect(page.getByTestId('ai-prompt-attach-menu')).toBeVisible()
  expect(await chromeGeometry()).toEqual(before)
  await page.keyboard.press('Escape')

  await conversation.getByTestId('agent-selected-new').click()
  await expect(conversation.getByRole('textbox', { name: 'New task' })).toBeVisible()
  const afterNew = await chromeGeometry()
  expect(afterNew.headerY).toBe(before.headerY)
  expect(afterNew.composerY).toBe(before.composerY)
  expect(afterNew.viewportY).toBe(before.viewportY)
  expect(afterNew.scrolled).toEqual([])
})
