import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

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
  const newTaskComposer = conversation.getByRole('textbox', { name: 'New task' })
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
  await expect(conversation.getByText('Task 11 conversation message 24')).toBeVisible()
  const composer = conversation.getByRole('textbox', { name: 'Follow up' })
  const viewport = conversation.getByTestId('ai-conversation-viewport')
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
    return store ? { panX: store.state.panX, panY: store.state.panY, zoom: store.state.zoom } : null
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
        ? { panX: store.state.panX, panY: store.state.panY, zoom: store.state.zoom }
        : null
    })
  ).toEqual(cameraBefore)

  await composer.fill('Give me a concise status update.')
  await conversation.getByRole('button', { name: 'Send message' }).click()
  await expect
    .poll(() => followUps)
    .toEqual([
      {
        message: 'Give me a concise status update.',
        url: expect.stringContaining('/conversations/thread-11/follow-up')
      }
    ])
})

test('steers a running task from the live composer instead of queueing a follow-up', async ({
  page
}) => {
  const steers: string[] = []
  const followUps: string[] = []
  await mockThreads(page, [worker(0)])
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
  const composer = panel.getByRole('textbox', { name: 'Follow up' })
  await expect(composer).toHaveAttribute('placeholder', 'Add instructions…')
  await expect(panel.getByRole('button', { name: 'Stop response' })).toBeVisible()
  await composer.fill('Keep the current work, but make the card smaller.')
  await panel.getByRole('button', { name: 'Steer task' }).click()

  await expect.poll(() => steers).toEqual(['Keep the current work, but make the card smaller.'])
  expect(followUps).toEqual([])
  await expect(composer).toHaveValue('')
})

test('shows Pi context remaining and measured stream throughput', async ({ page }) => {
  const workers = [{ ...worker(0), state: 'completed' }]
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
  expect(
    await contextIndicator
      .getByTestId('ai-context-progress')
      .evaluate((element) => getComputedStyle(element).maskImage)
  ).not.toBe('none')
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

test('selects transcript text and quotes it into the composer', async ({ page }) => {
  const workers = [worker(0)]
  await mockThreads(page, workers)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-selector').getByText('Human task title 0').click()

  const conversation = page.getByTestId('agent-selected-conversation')
  const message = conversation.getByTestId('ai-message').filter({ hasText: 'message 24' })
  await expect(message).toHaveCSS('user-select', 'text')
  await message.locator('p').selectText()
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
    .toBe('Task 0 conversation message 24')
  await message.dispatchEvent('pointerup')

  const actions = page.getByTestId('ai-selection-actions')
  await expect(actions).toBeVisible()
  await expect(actions).toHaveScreenshot('agent-selection-actions.png')
  await actions.getByRole('button', { name: 'Add to chat' }).click()
  await expect(conversation.getByRole('textbox', { name: 'Follow up' })).toHaveValue(
    '> Task 0 conversation message 24\n\n'
  )
})

test('renders AI Elements Vue parts and chat lifecycle controls', async ({ page }) => {
  let lifecycle: 'complete' | 'streaming' = 'streaming'
  let followUpAttempts = 0
  let stopAttempts = 0
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
        { state: 'complete', text: 'Checked the scoped files.', type: 'reasoning' },
        { input: '{"path":"README.md"}', name: 'read_file', state: 'pending', type: 'tool' },
        { input: '{"query":"chat"}', name: 'search', state: 'running', type: 'tool' },
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
        { error: 'Permission denied', name: 'write_file', state: 'error', type: 'tool' },
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
      followUpAttempts += 1
      sentMessages.push((route.request().postDataJSON() as { message: string }).message)
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
      await route.fulfill({ body: '{"stopped":true}', contentType: 'application/json' })
    }
  )

  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()

  const panel = page.getByTestId('agent-chats-panel')
  await panel.getByTestId('agent-thread-selector').getByText('Rich chat rendering').click()
  const viewport = panel.getByTestId('ai-conversation-viewport')
  await expect(panel.getByTestId('ai-activity-disclosure')).toBeVisible()
  const durationDivider = panel.getByTestId('ai-turn-duration')
  await expect(durationDivider).toContainText('Working for')
  await expect(panel.getByTestId('ai-reasoning')).toBeVisible()
  const reasoning = panel.getByTestId('ai-reasoning')
  const reasoningToggle = reasoning.getByTestId('ai-reasoning-toggle')
  await expect(reasoningToggle.getByTestId('ai-disclosure-chevron')).toHaveAttribute(
    'data-direction',
    'right'
  )
  await reasoningToggle.click()
  await expect(reasoning.getByTestId('ai-reasoning-content')).toContainText(
    'Checked the scoped files.'
  )
  await expect(reasoningToggle.getByTestId('ai-disclosure-chevron')).toHaveAttribute(
    'data-direction',
    'down'
  )
  const toolGroup = panel.getByTestId('ai-tool-group')
  await expect(toolGroup).toContainText('Read files, searched, used tools, edited files')
  await expect(panel.getByTestId('ai-tool-call')).toHaveCount(0)
  await toolGroup.getByTestId('ai-tool-group-toggle').click()
  await expect(panel.getByTestId('ai-tool-call')).toHaveCount(5)
  await expect(panel.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Reject' })).toHaveCount(0)
  await expect(panel.getByTestId('ai-tool-call').filter({ hasText: 'Read' })).toBeVisible()
  await expect(panel.getByTestId('ai-tool-call').filter({ hasText: 'Searched' })).toBeVisible()
  await expect(panel.getByTestId('ai-tool-call').filter({ hasText: 'Read' })).toHaveAttribute(
    'data-kind',
    'read'
  )
  await expect(panel.getByTestId('ai-tool-call').filter({ hasText: 'Searched' })).toHaveAttribute(
    'data-kind',
    'search'
  )
  const timeline = panel.getByTestId('ai-activity-timeline')
  expect(
    await timeline.evaluate((element) => {
      const style = getComputedStyle(element)
      return { borderLeftWidth: style.borderLeftWidth, paddingLeft: style.paddingLeft }
    })
  ).toEqual({ borderLeftWidth: '0px', paddingLeft: '0px' })
  const screenshotTool = panel.getByTestId('ai-tool-call').filter({ hasText: 'verify' })
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
  const failedTool = panel.getByTestId('ai-tool-call').filter({ hasText: 'Edited files' })
  await failedTool.getByRole('button', { name: 'Show tool output' }).click()
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
  await expect(panel.getByTestId('ai-reasoning')).toHaveCount(0)
  await durationDivider.click()
  await expect(panel.getByTestId('ai-reasoning')).toHaveAttribute('data-state', 'complete')
  await panel.getByTestId('ai-tool-group').getByTestId('ai-tool-group-toggle').click()
  await expect(
    panel.getByTestId('ai-tool-call').and(page.locator('[data-state="success"]'))
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

  await expect(panel.getByTestId('ai-conversation-status')).toHaveCount(0, { timeout: 4_000 })

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
