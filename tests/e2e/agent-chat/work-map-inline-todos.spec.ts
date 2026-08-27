import { expect, test, type Locator, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { setLocalStorageItem } from '#tests/helpers/storage'

type WorkMapApplyRequest = {
  operations?: unknown[]
}

async function mockAgentShell(page: Page, options: { threads?: object[]; workMap?: object } = {}) {
  const workMap = options.workMap ?? {
    placements: [],
    projects: [
      {
        createdAt: '2026-08-25T12:00:00.000Z',
        id: 'project:dental-chart',
        name: 'Dental Chart',
        updatedAt: '2026-08-25T12:00:00.000Z'
      },
      {
        createdAt: '2026-08-25T12:00:00.000Z',
        id: 'project:work-map',
        name: 'Work Map',
        parentId: 'project:dental-chart',
        updatedAt: '2026-08-25T12:00:00.000Z'
      }
    ],
    revision: 1,
    todos: [
      {
        createdAt: '2026-08-25T12:00:00.000Z',
        id: 'todo:refine-chart',
        projectId: 'project:dental-chart',
        status: 'todo',
        title: 'Refine chart editor interactions',
        updatedAt: '2026-08-25T12:00:00.000Z'
      }
    ]
  }
  await Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
      route.fulfill({
        body: JSON.stringify({ threads: options.threads ?? [] }),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
      route.fulfill({
        body: '{"models":[]}',
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/work-map$/, (route) =>
      route.fulfill({
        body: JSON.stringify(workMap),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/work-map\/apply$/, (route) =>
      route.fulfill({
        body: JSON.stringify(workMap),
        contentType: 'application/json'
      })
    )
  ])
}

async function sampleProjectContentHeights(page: Page, projectId: string, durationMs = 360) {
  return page.evaluate(
    async ({ durationMs, projectId }) => {
      const samples: Array<number | null> = []
      const startedAt = performance.now()
      while (performance.now() - startedAt < durationMs) {
        const content = document.querySelector(
          `[data-test-id="work-map-project-content-${projectId}"]`
        )
        samples.push(content ? content.getBoundingClientRect().height : null)
        await new Promise(requestAnimationFrame)
      }
      return samples
    },
    { durationMs, projectId }
  )
}

async function projectContentHeightAtGridTransitionBoundary(page: Page, projectId: string) {
  return page.evaluate(
    ({ projectId }) =>
      new Promise<number>((resolve, reject) => {
        const content = document.querySelector<HTMLElement>(
          `[data-test-id="work-map-project-content-${projectId}"]`
        )
        if (!content) {
          reject(new Error(`Project content ${projectId} is not mounted`))
          return
        }
        document.documentElement.dataset.workMapGridTransitionArmed = projectId
        const timeout = window.setTimeout(
          () =>
            reject(new Error(`Project content ${projectId} did not finish its grid transition`)),
          1_000
        )
        const captureGridBoundary = (event: TransitionEvent) => {
          if (event.propertyName !== 'grid-template-rows') return
          window.clearTimeout(timeout)
          delete document.documentElement.dataset.workMapGridTransitionArmed
          resolve(content.getBoundingClientRect().height)
        }
        content.addEventListener('transitionend', captureGridBoundary, { capture: true })
        content.addEventListener('transitioncancel', captureGridBoundary, { capture: true })
      }),
    { projectId }
  )
}

async function sampleWorkMapRowY(page: Page, testId: string, durationMs = 650) {
  return page.evaluate(
    async ({ durationMs, testId }) => {
      const samples: Array<number | null> = []
      const startedAt = performance.now()
      while (performance.now() - startedAt < durationMs) {
        const row = document.querySelector(`[data-test-id="${testId}"]`)
        samples.push(row ? row.getBoundingClientRect().y : null)
        await new Promise(requestAnimationFrame)
      }
      return samples
    },
    { durationMs, testId }
  )
}

async function sampleElementBounds(locator: Locator, axis: 'width' | 'x', durationMs = 500) {
  return locator.evaluate(
    async (element, { axis, durationMs }) => {
      const samples: number[] = []
      const startedAt = performance.now()
      while (performance.now() - startedAt < durationMs) {
        samples.push(element.getBoundingClientRect()[axis])
        await new Promise(requestAnimationFrame)
      }
      return samples
    },
    { axis, durationMs }
  )
}

function largestStepRatio(samples: Array<number | null>) {
  const positions = samples.filter((sample): sample is number => sample !== null)
  const totalMovement = Math.abs((positions.at(-1) ?? 0) - (positions[0] ?? 0))
  const largestStep = Math.max(
    0,
    ...positions.slice(1).map((position, index) => Math.abs(position - positions[index]))
  )
  return totalMovement ? largestStep / totalMovement : 0
}

function paginationThread(index: number) {
  const updatedAt = new Date(Date.UTC(2026, 7, 25, 12, 0, index)).toISOString()
  return {
    canFollowUp: true,
    createdAt: updatedAt,
    effort: 'medium',
    id: `pagination-${String(index)}`,
    messages: [],
    model: 'openai/gpt-5.5',
    pendingUiRequests: [],
    recentUpdate: '',
    state: 'completed',
    task: `Misc chat ${String(index + 1)}`,
    updatedAt,
    workerId: `worker-${String(index)}`
  }
}

test('renders standalone chats only inside Chats', async ({ page }) => {
  const placedChat = paginationThread(0)
  const looseChat = paginationThread(1)
  await mockAgentShell(page, {
    threads: [placedChat, looseChat],
    workMap: {
      placements: [
        {
          manual: true,
          projectId: 'project:chat-free',
          threadId: placedChat.id,
          updatedAt: placedChat.updatedAt
        }
      ],
      projects: [
        {
          createdAt: placedChat.createdAt,
          id: 'project:chat-free',
          name: 'Categorized work',
          updatedAt: placedChat.updatedAt
        }
      ],
      revision: 1,
      todos: []
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const projectContent = page.getByTestId('work-map-project-content-project:chat-free')
  await expect(page.getByTestId('work-map-project-row-project:chat-free')).toBeVisible()
  await expect(projectContent.getByTestId(/^agent-chat-thread-agent:/)).toHaveCount(0)
  await expect(page.getByTestId('work-map-misc-row')).toBeVisible()
  await page.getByRole('button', { name: 'Expand Chats' }).first().click()
  await expect(page.getByTestId('agent-chat-thread-agent:pagination-0')).toBeVisible()
  await expect(page.getByTestId('agent-chat-thread-agent:pagination-1')).toBeVisible()
})

test('reveals Work map rows in calm fixed-size pages', async ({ page }) => {
  const updatedAt = '2026-08-25T12:00:00.000Z'
  const statuses = ['todo', 'in_motion'] as const
  const todos = [
    ...statuses.flatMap((status) =>
      Array.from({ length: 11 }, (_, index) => ({
        createdAt: updatedAt,
        id: `todo:${status}-${String(index)}`,
        projectId: 'project:pagination',
        status,
        title: `${status} task ${String(index + 1)}`,
        updatedAt: new Date(Date.UTC(2026, 7, 25, 12, 0, index)).toISOString()
      }))
    ),
    {
      archivedAt: updatedAt,
      createdAt: updatedAt,
      id: 'todo:archived',
      projectId: 'project:pagination',
      status: 'in_motion',
      title: 'Archived work',
      updatedAt
    }
  ]
  await mockAgentShell(page, {
    threads: Array.from({ length: 26 }, (_, index) => paginationThread(index)),
    workMap: {
      placements: [],
      projects: [
        {
          createdAt: updatedAt,
          id: 'project:pagination',
          name: 'Pagination',
          updatedAt
        }
      ],
      revision: 1,
      todos
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const todoRows = page.getByTestId(/^work-map-todo-todo:todo-/)
  await expect(todoRows).toHaveCount(5)
  const showMoreTodo = page.getByTestId('work-map-show-more-project:pagination-todo')
  await expect(showMoreTodo).toHaveText('Show more')
  await showMoreTodo.click()
  await expect(todoRows).toHaveCount(10)
  await expect(showMoreTodo).toHaveAttribute('aria-label', 'Show 1 more todo tasks')
  await showMoreTodo.click()
  await expect(todoRows).toHaveCount(11)
  await expect(showMoreTodo).toHaveCount(0)

  const inMotionRows = page.getByTestId(/^work-map-todo-todo:in_motion-/)
  await expect(inMotionRows).toHaveCount(5)
  await page.getByTestId('work-map-show-more-project:pagination-in_motion').click()
  await expect(inMotionRows).toHaveCount(10)

  await expect(page.getByTestId('work-map-todo-todo:archived')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Finished' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Expand Chats' }).first().click()
  const miscRows = page.getByTestId(/^agent-chat-thread-agent:pagination-/)
  await expect(miscRows).toHaveCount(15)
  const showMoreMisc = page.getByTestId('work-map-show-more-misc')
  await expect(showMoreMisc).toHaveAttribute('aria-label', 'Show 10 more chats')
  await showMoreMisc.click()
  await expect(miscRows).toHaveCount(25)
  await expect(showMoreMisc).toHaveAttribute('aria-label', 'Show 1 more chats')
  await showMoreMisc.click()
  await expect(miscRows).toHaveCount(26)
  await expect(showMoreMisc).toHaveCount(0)
})

test('renders only Todo and In motion as active task statuses', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  await expect(page.getByText('Todo', { exact: true })).toBeVisible()
  await expect(page.getByText('In motion', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finished' })).toHaveCount(0)
  await expect(page.getByTestId('work-map-empty-project:dental-chart-todo')).toHaveCount(0)
  await expect(page.getByTestId('work-map-empty-project:dental-chart-in_motion')).toHaveText(
    'No working chats'
  )
  await expect(page.getByTestId('work-map-empty-project:dental-chart-needs_you')).toHaveCount(0)
  await expect(page.getByTestId('work-map-empty-project:dental-chart-review')).toHaveCount(0)
})

test('keeps recurring Bot work in the Scheduled section', async ({ page }) => {
  const updatedAt = '2026-08-26T12:00:00.000Z'
  const botThread = {
    ...paginationThread(0),
    messages: [
      {
        createdAt: updatedAt,
        id: 'message:morning-user',
        role: 'user',
        text: 'Can you keep an eye on the morning inbox?'
      },
      {
        createdAt: updatedAt,
        id: 'message:morning-assistant',
        role: 'assistant',
        text: "Yep.\n\nI'll send a short update when something needs you."
      }
    ],
    task: 'Morning Email Check Assistant',
    updatedAt
  }
  const scheduledWorkMap = {
    bots: [
      {
        avatarVariant: 5,
        createdAt: updatedAt,
        id: 'bot:morning-email',
        projectId: 'project:dental-chart',
        threadId: botThread.id,
        updatedAt
      }
    ],
    inbox: [],
    placements: [],
    projects: [
      {
        botId: 'bot:morning-email',
        createdAt: updatedAt,
        id: 'project:dental-chart',
        name: 'Dental Chart',
        updatedAt
      }
    ],
    revision: 1,
    routines: [
      {
        botId: 'bot:morning-email',
        createdAt: updatedAt,
        enabled: true,
        everyMinutes: 1_440,
        id: 'routine:morning-inbox',
        nextRunAt: '2026-08-27T13:00:00.000Z',
        prompt: 'Review the morning inbox',
        updatedAt
      }
    ],
    todos: []
  }
  let releaseRunResponse = () => {
    throw new Error('Scheduled run response gate was not initialized')
  }
  const runResponseGate = new Promise<void>((resolve) => {
    releaseRunResponse = resolve
  })
  await page.route(/\/work-map\/routines\/routine%3Amorning-inbox\/run$/, async (route) => {
    await runResponseGate
    await route.fulfill({
      body: JSON.stringify({
        ...scheduledWorkMap,
        inbox: [
          {
            botId: 'bot:morning-email',
            createdAt: updatedAt,
            id: 'inbox:morning-inbox-running',
            projectId: 'project:dental-chart',
            routineId: 'routine:morning-inbox',
            status: 'running',
            summary: 'Scheduled work is running.',
            threadId: botThread.id,
            updatedAt
          }
        ],
        revision: 2
      }),
      contentType: 'application/json',
      status: 202
    })
  })
  await mockAgentShell(page, {
    threads: [botThread],
    workMap: scheduledWorkMap
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const projectContent = page.getByTestId('work-map-project-content-project:dental-chart')
  const row = page.getByTestId('work-map-project-row-project:dental-chart')
  const botChat = page.getByTestId('work-map-open-bot-chat-project:dental-chart')
  const avatar = botChat.getByTestId('work-map-bot-avatar-bot:morning-email')
  const projectToggle = page.getByTestId('work-map-project-toggle-project:dental-chart')
  const scheduled = page.getByTestId('work-map-scheduled-project:dental-chart')
  const scheduledItem = page.getByTestId('work-map-scheduled-item-routine:morning-inbox')
  const todoStatus = projectContent.getByText('Todo', { exact: true }).locator('xpath=..')
  const inMotionStatus = projectContent.getByText('In motion', { exact: true }).locator('xpath=..')
  const todoStatusIcon = todoStatus.locator('svg').first()
  const inMotionStatusIcon = inMotionStatus.locator('svg').first()

  await expect(projectContent.getByText('Bots', { exact: true })).toHaveCount(0)
  await expect(row).toContainText('Dental Chart')
  await expect(row).not.toContainText('Daily')
  await expect(row).not.toContainText('Aug 27')
  await expect(row).not.toContainText('8:00 AM')
  await expect(avatar).toBeVisible()
  await expect(avatar).toHaveAttribute('data-variant', '5')
  await expect(projectToggle).toHaveAttribute('aria-expanded', 'true')

  await botChat.click()
  await expect(page.getByTestId('agent-selected-header-title')).toContainText(
    'Morning Email Check Assistant'
  )
  await expect(page.getByTestId('ai-conversation-surface')).toHaveAttribute(
    'data-conversation-mode',
    'bot-text'
  )
  await expect(page.locator('.assistant-text-bubble')).toHaveCount(2)
  await expect(page.getByTestId('ai-message-reaction-trigger')).toHaveCount(2)
  await expect(page.getByTestId('agent-model-trigger')).toHaveCount(0)
  await page.getByTestId('agent-thread-back').click()
  await expect(projectToggle).toHaveAttribute('aria-expanded', 'true')

  await avatar.click()
  await expect(page.getByTestId('agent-selected-header-title')).toContainText(
    'Morning Email Check Assistant'
  )
  await page.getByTestId('agent-thread-back').click()

  await projectToggle.click()
  await expect(projectToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(projectContent).toHaveCount(0)
  await projectToggle.click()
  await expect(projectToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(projectContent).toBeVisible()

  await page.getByTestId('agent-thread-new').dragTo(row)
  await expect(page.getByTestId('agent-selected-header-title')).toContainText('New chat')
  await page.getByTestId('agent-thread-back').click()

  await expect(scheduled).toBeVisible()
  await expect(scheduledItem).toContainText('Review the morning inbox')
  await expect(scheduledItem).toContainText('Daily')

  const runButton = page.getByTestId('work-map-run-scheduled-routine:morning-inbox')
  await scheduledItem.hover()
  await runButton.click()
  await expect(runButton).toHaveAttribute('aria-label', 'Scheduled work running')
  await expect(runButton.locator('svg.animate-spin')).toBeVisible()
  const runResponse = page.waitForResponse(/\/work-map\/routines\/routine%3Amorning-inbox\/run$/)
  releaseRunResponse()
  await runResponse
  await expect(runButton.locator('svg.animate-spin')).toBeVisible()

  const rowClasses = await row.getAttribute('class')
  expect(rowClasses).not.toContain('ml-8')
  expect(rowClasses).not.toContain('before:')
  expect(rowClasses).not.toContain('after:')

  const [rowBounds, todoBounds, inMotionBounds, avatarBounds, todoIconBounds, inMotionIconBounds] =
    await Promise.all([
      row.boundingBox(),
      todoStatus.boundingBox(),
      inMotionStatus.boundingBox(),
      avatar.boundingBox(),
      todoStatusIcon.boundingBox(),
      inMotionStatusIcon.boundingBox()
    ])
  if (
    !rowBounds ||
    !todoBounds ||
    !inMotionBounds ||
    !avatarBounds ||
    !todoIconBounds ||
    !inMotionIconBounds
  ) {
    throw new Error('Project Bot or status row bounds missing')
  }
  expect(todoBounds.x - rowBounds.x).toBe(8)
  expect(inMotionBounds.x - rowBounds.x).toBe(8)
  expect(avatarBounds.width).toBeGreaterThan(todoIconBounds.width)
  expect(avatarBounds.height).toBeGreaterThan(todoIconBounds.height)
  expect(avatarBounds.width).toBeGreaterThan(inMotionIconBounds.width)
  expect(avatarBounds.height).toBeGreaterThan(inMotionIconBounds.height)

  await expect(page.getByTestId('work-map-routine-dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open scheduled chat: Review the morning inbox' }).click()
  await expect(page.getByTestId('agent-selected-header-title')).toContainText(
    'Morning Email Check Assistant'
  )
})

test('renders a persistent Bot chat as a compact direct-message conversation', async ({ page }) => {
  const firstMessageAt = '2026-08-26T12:00:00.000Z'
  const followUpAt = '2026-08-26T12:45:00.000Z'
  const responses: Array<{ requestId: string; value?: string }> = []
  const botThread = {
    ...paginationThread(0),
    messages: [
      {
        completedAt: '2026-08-26T12:00:03.000Z',
        createdAt: firstMessageAt,
        id: 'message:grokky-greeting',
        role: 'assistant',
        text: "Hey. What's up?"
      },
      {
        changes: {
          additions: 1,
          capturedAt: '2026-08-26T12:45:02.000Z',
          deletions: 0,
          files: [
            {
              additions: 1,
              deletions: 0,
              patch:
                'diff --git a/notes.txt b/notes.txt\n--- a/notes.txt\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+private work detail',
              path: 'notes.txt',
              status: 'modified'
            }
          ]
        },
        completedAt: '2026-08-26T12:45:05.000Z',
        createdAt: followUpAt,
        id: 'message:grokky-user',
        role: 'user',
        text: 'what u doing'
      },
      {
        completedAt: '2026-08-26T12:45:05.000Z',
        createdAt: '2026-08-26T12:45:05.000Z',
        id: 'message:grokky-answer',
        parts: [
          {
            alt: 'Completed Bot preview',
            type: 'image',
            url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="black"/></svg>'
          }
        ],
        role: 'assistant',
        text: 'Just sitting here. You around?'
      }
    ],
    pendingUiRequests: [
      {
        id: 'choice:documents',
        method: 'select',
        options: ['Leave it all', 'File the empty stubs only', 'Move the whole thing into Filed'],
        requestedAt: '2026-08-26T12:45:06.000Z',
        title: "What should I do with Documents - Omar's MacBook Pro?"
      }
    ],
    recentUpdate: 'Waiting for your choice.',
    state: 'needs_attention',
    task: 'Grokky',
    updatedAt: '2026-08-26T12:45:06.000Z'
  }
  const workMap = {
    bots: [
      {
        avatarVariant: 5,
        createdAt: firstMessageAt,
        id: 'bot:grokky',
        projectId: 'project:dental-chart',
        threadId: botThread.id,
        updatedAt: followUpAt
      }
    ],
    inbox: [],
    placements: [],
    projects: [
      {
        botId: 'bot:grokky',
        createdAt: firstMessageAt,
        id: 'project:dental-chart',
        name: 'Dental Chart',
        updatedAt: followUpAt
      }
    ],
    revision: 1,
    routines: [],
    todos: []
  }
  await page.route(
    /\/agent-router\/v1\/pi\/conversations\/[^/]+\/ui\/[^/]+\/respond$/,
    async (route) => {
      const url = new URL(route.request().url())
      responses.push({
        requestId: decodeURIComponent(url.pathname.split('/ui/')[1]?.split('/')[0] ?? ''),
        ...(route.request().postDataJSON() as { value?: string })
      })
      botThread.pendingUiRequests = []
      botThread.state = 'completed'
      botThread.updatedAt = '2026-08-26T12:45:07.000Z'
      await route.fulfill({ body: '{"accepted":true}', contentType: 'application/json' })
    }
  )
  await mockAgentShell(page, { threads: [botThread], workMap })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })

  await page.getByTestId('work-map-open-bot-chat-project:dental-chart').click()
  const conversation = page.getByTestId('agent-selected-conversation')
  const surface = conversation.getByTestId('ai-conversation-surface')
  await expect(page.getByTestId('agent-selected-header-title')).toContainText('Grokky')
  await expect(surface).toHaveAttribute('data-conversation-mode', 'bot-text')
  await expect(conversation.getByTestId('ai-activity-disclosure')).toHaveCount(0)
  await expect(conversation.getByTestId('ai-turn-duration')).toHaveCount(0)
  await expect(conversation.getByTestId('ai-turn-changes-dock')).toHaveCount(0)
  await expect(conversation.getByTestId('ai-message-time')).toHaveCount(0)

  const separator = conversation.getByTestId('ai-message-time-separator')
  await expect(separator).toHaveCount(1)
  await expect(separator).toHaveAttribute('datetime', followUpAt)
  await expect
    .poll(() => separator.evaluate((element) => getComputedStyle(element).textAlign))
    .toBe('center')

  const messages = conversation.getByTestId('ai-message')
  await expect(messages).toHaveCount(3)
  const userMessage = messages.filter({ hasText: 'what u doing' })
  const userBubble = userMessage.getByTestId('ai-message-content')
  await expect
    .poll(() =>
      userBubble.evaluate((element) => ({
        backgroundColor: getComputedStyle(element).backgroundColor,
        color: getComputedStyle(element).color
      }))
    )
    .toEqual({ backgroundColor: 'rgb(5, 5, 5)', color: 'rgb(255, 255, 255)' })
  await expect(conversation.locator('.assistant-text-bubble')).toHaveCount(2)
  const assistantMessage = messages.filter({ hasText: 'Just sitting here. You around?' })
  const assistantBubble = assistantMessage.locator('.assistant-text-bubble').last()
  await expect(assistantMessage.getByRole('img', { name: 'Completed Bot preview' })).toBeVisible()
  await expect(conversation.getByTestId('ai-bot-presence')).toHaveCount(0)
  await expect(conversation.getByTestId('work-map-bot-avatar-bot:grokky')).toHaveCount(0)
  await expect
    .poll(() => assistantBubble.evaluate((element) => getComputedStyle(element).backgroundColor))
    .toBe('rgb(240, 241, 243)')
  const [surfaceBox, assistantBubbleBox, userBubbleBox] = await Promise.all([
    surface.boundingBox(),
    assistantBubble.boundingBox(),
    userBubble.boundingBox()
  ])
  if (!surfaceBox || !assistantBubbleBox || !userBubbleBox) {
    throw new Error('Bot direct-message bubble bounds missing')
  }
  expect(assistantBubbleBox.width).toBeLessThan(surfaceBox.width * 0.85)
  expect(userBubbleBox.x).toBeGreaterThan(assistantBubbleBox.x)

  await assistantMessage.hover()
  const react = assistantMessage.getByTestId('ai-message-reaction-trigger')
  const reply = assistantMessage.getByRole('button', { name: 'Reply to message' })
  const overflow = assistantMessage.getByTestId('ai-message-actions-trigger')
  await expect(react).toBeVisible()
  await expect(reply).toBeVisible()
  await expect(overflow).toBeVisible()
  const overflowBox = await overflow.boundingBox()
  if (!overflowBox) throw new Error('Bot message action bounds missing')
  expect(overflowBox.x).toBeGreaterThanOrEqual(assistantBubbleBox.x + assistantBubbleBox.width)

  await reply.click()
  const replyContext = conversation.getByTestId('ai-reply-context')
  await expect(replyContext).toContainText('Replying to Grokky')
  await expect(replyContext).toContainText('Just sitting here. You around?')
  await expect(page.getByPlaceholder('Message Grokky…')).toBeFocused()
  await replyContext.getByRole('button', { name: 'Cancel reply' }).click()
  await expect(replyContext).toHaveCount(0)

  await assistantMessage.hover()
  await overflow.click()
  const actionsMenu = page.getByTestId('ai-message-actions-menu')
  await expect(actionsMenu.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  await expect(actionsMenu.getByRole('button', { name: 'Copy request ID' })).toBeVisible()
  await page.keyboard.press('Escape')

  await assistantMessage.hover()
  await react.click()
  await page.getByTestId('ai-message-reaction-menu').getByRole('button', { name: 'Like' }).click()
  const reaction = assistantMessage.getByTestId('ai-message-reaction')
  await expect(reaction).toBeVisible()
  const [currentAssistantBubbleBox, reactionBox] = await Promise.all([
    assistantBubble.boundingBox(),
    reaction.boundingBox()
  ])
  if (!currentAssistantBubbleBox || !reactionBox) {
    throw new Error('Bot message reaction bounds missing')
  }
  const assistantBubbleBottom = currentAssistantBubbleBox.y + currentAssistantBubbleBox.height
  expect(assistantBubbleBottom - reactionBox.y).toBeGreaterThanOrEqual(6)
  expect(reactionBox.y + reactionBox.height).toBeGreaterThan(assistantBubbleBottom)

  const composer = conversation.getByTestId('ai-prompt-input')
  const attach = composer.getByTestId('ai-prompt-attach')
  const dictation = composer.getByTestId('ai-prompt-dictation')
  await expect(page.getByPlaceholder('Message Grokky…')).toBeVisible()
  await expect(attach).toBeVisible()
  await expect(dictation).toBeVisible()
  await expect(dictation.locator('svg')).toBeVisible()
  await expect(dictation.locator('canvas')).toHaveCount(0)
  const attachStyle = await attach.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: Number.parseFloat(style.borderRadius),
      width: element.getBoundingClientRect().width
    }
  })
  expect(attachStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(attachStyle.borderRadius).toBeGreaterThanOrEqual(attachStyle.width / 2)
  const composerBox = await composer.boundingBox()
  if (!composerBox) throw new Error('Bot composer bounds missing')
  expect(surfaceBox.width - composerBox.width).toBeLessThanOrEqual(32)

  const textbox = page.getByPlaceholder('Message Grokky…')
  await textbox.fill('On my way')
  await expect(composer.getByTestId('ai-prompt-dictation')).toHaveCount(0)
  await expect(composer.getByTestId('ai-prompt-send')).toBeVisible()

  const approval = conversation.getByTestId('agent-ui-approval')
  await expect(approval).toHaveAttribute('data-presentation', 'bot-text')
  await expect(approval).toContainText("What should I do with Documents - Omar's MacBook Pro?")
  await expect(approval.getByRole('button')).toHaveCount(4)
  await approval.getByRole('button', { name: 'File the empty stubs only' }).click()
  await expect
    .poll(() => responses)
    .toEqual([{ requestId: 'choice:documents', value: 'File the empty stubs only' }])
  await expect(approval).toHaveCount(0)

  await page.getByTestId('agent-thread-back').click()
  botThread.state = 'running'
  botThread.recentUpdate = 'Thinking'
  botThread.updatedAt = '2026-08-26T12:45:08.000Z'
  await page.reload()
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('work-map-open-bot-chat-project:dental-chart').click()

  const presence = page.getByTestId('agent-selected-conversation').getByTestId('ai-bot-presence')
  await expect(presence).toHaveText('Grokky is thinking…')
  await expect(presence.getByTestId('work-map-bot-avatar-bot:grokky')).toHaveAttribute(
    'data-active',
    'true'
  )
  await expect
    .poll(() =>
      presence.evaluate((element) => ({
        backgroundColor: getComputedStyle(element).backgroundColor,
        borderTopWidth: getComputedStyle(element).borderTopWidth
      }))
    )
    .toEqual({ backgroundColor: 'rgba(0, 0, 0, 0)', borderTopWidth: '0px' })
})

test('starts a dedicated Bot charter instead of opening an unrelated scheduled Bot', async ({
  page
}) => {
  const updatedAt = '2026-08-26T12:00:00.000Z'
  const scheduledThread = {
    ...paginationThread(0),
    task: 'Morning Email Check Assistant',
    updatedAt
  }
  await mockAgentShell(page, {
    threads: [scheduledThread],
    workMap: {
      bots: [
        {
          avatarVariant: 5,
          createdAt: updatedAt,
          id: 'bot:morning-email',
          projectId: 'project:dental-chart',
          threadId: scheduledThread.id,
          updatedAt
        }
      ],
      inbox: [],
      placements: [],
      projects: [
        {
          createdAt: updatedAt,
          id: 'project:dental-chart',
          name: 'Dental Chart',
          updatedAt
        }
      ],
      revision: 1,
      routines: [
        {
          botId: 'bot:morning-email',
          createdAt: updatedAt,
          enabled: true,
          everyMinutes: 1_440,
          id: 'routine:morning-inbox',
          nextRunAt: '2026-08-27T13:00:00.000Z',
          prompt: 'Review the morning inbox',
          updatedAt
        }
      ],
      todos: []
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  await page.getByTestId('work-map-open-bot-chat-project:dental-chart').click()
  await expect(page.getByTestId('agent-selected-header-title')).toContainText('New chat')
  await expect(page.getByRole('heading', { name: 'Set up this Bot' })).toBeVisible()
  await expect(page.getByTestId('ai-conversation-surface')).toHaveAttribute(
    'data-conversation-mode',
    'bot-text'
  )
  await expect(page.getByPlaceholder('Message this Bot…')).toBeVisible()
  await expect(page.getByTestId('agent-model-trigger')).toHaveCount(0)
})

test('archives a linked Todo chat from its active Work Map row', async ({ page }) => {
  const updatedAt = '2026-08-25T12:00:00.000Z'
  const thread = paginationThread(0)
  const archiveOperations: unknown[] = []
  page.on('request', (request) => {
    if (!request.url().endsWith('/agent-router/v1/pi/work-map/apply')) return
    const body = request.postDataJSON() as WorkMapApplyRequest
    archiveOperations.push(...(body.operations ?? []))
  })
  await mockAgentShell(page, {
    threads: [thread],
    workMap: {
      placements: [],
      projects: [
        {
          createdAt: updatedAt,
          id: 'project:archive',
          name: 'Archive test',
          updatedAt
        }
      ],
      revision: 1,
      todos: [
        {
          createdAt: updatedAt,
          id: 'todo:archive',
          projectId: 'project:archive',
          status: 'in_motion',
          threadId: thread.id,
          title: 'Settle this chat',
          updatedAt
        }
      ]
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  await page.getByTestId('work-map-todo-todo:archive').hover()
  await page.getByTestId('work-map-archive-todo-todo:archive').click()
  await expect(page.getByTestId('agent-conversation-archive-dialog')).toBeVisible()
  await page.getByTestId('agent-conversation-archive-confirm').click()
  await expect
    .poll(() => archiveOperations)
    .toContainEqual({
      op: 'archive_todo',
      todo_id: 'todo:archive'
    })
  await expect(page.getByTestId('work-map-todo-todo:archive')).toHaveCount(0)
  await expect(page.getByTestId('agent-thread-archive-toggle')).toHaveCount(0)
})

test('archives a project chat from its In motion row', async ({ page }) => {
  const updatedAt = '2026-08-25T12:00:00.000Z'
  const thread = paginationThread(0)
  await mockAgentShell(page, {
    threads: [thread],
    workMap: {
      placements: [
        {
          manual: true,
          projectId: 'project:archive-chat',
          threadId: thread.id,
          updatedAt
        }
      ],
      projects: [
        {
          createdAt: updatedAt,
          id: 'project:archive-chat',
          name: 'Archive chat test',
          updatedAt
        }
      ],
      revision: 1,
      todos: []
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const chat = page.getByTestId(`work-map-project-chat-agent:${thread.id}`)
  const archive = page.getByTestId(`work-map-archive-chat-agent:${thread.id}`)
  await chat.hover()
  await expect(archive).toHaveCSS('transition-duration', '0s')
  await expect(archive).toHaveCSS('opacity', '1')
  await archive.click()
  await expect(page.getByTestId('agent-conversation-archive-dialog')).toBeVisible()
  await page.getByTestId('agent-conversation-archive-confirm').click()
  await expect(chat).toHaveCount(0)
})

test('uses a dedicated full-height sidebar close rail', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const closeSidebar = page.getByRole('button', { name: 'Close sidebar' })
  const closeSidebarChevron = closeSidebar.locator('svg')
  const closeSidebarChevronWrapper = closeSidebar.locator('[data-sidebar-collapse-arrow="true"]')
  const closeSidebarDivider = closeSidebar.locator('[data-sidebar-collapse-divider="true"]')
  await page.mouse.move(800, 400)
  await expect(closeSidebar).toHaveCSS('opacity', '1')

  const [closeBounds, resizeBounds] = await Promise.all([
    closeSidebar.boundingBox(),
    page.getByTestId('left-splitter-handle').boundingBox()
  ])
  if (!closeBounds || !resizeBounds) throw new Error('Sidebar edge rail bounds missing')
  expect(Math.round(closeBounds.x)).toBe(Math.round(resizeBounds.x + resizeBounds.width))
  expect(Math.round(closeBounds.width)).toBe(20)
  expect(Math.round(closeBounds.y)).toBe(0)
  expect(Math.round(closeBounds.height)).toBe(await page.evaluate(() => window.innerHeight))
  await expect(closeSidebarChevron).toBeVisible()
  await expect(closeSidebarChevronWrapper).toHaveCSS('opacity', '0')

  await page.mouse.move(
    closeBounds.x + closeBounds.width / 2,
    closeBounds.y + closeBounds.height / 2
  )
  await expect(closeSidebarChevronWrapper).toHaveCSS('opacity', '1')
  await expect(closeSidebarDivider).toHaveCSS('opacity', '0')

  await page.mouse.move(closeBounds.x + closeBounds.width / 2, closeBounds.y + 80)
  await expect(closeSidebarChevronWrapper).toHaveCSS('opacity', '1')
  await expect(closeSidebarDivider).toHaveCSS('opacity', '0.35')

  await closeSidebar.focus()
  await page.mouse.click(
    closeBounds.x + closeBounds.width / 2,
    closeBounds.y + closeBounds.height * 0.82
  )
  const openSidebar = page.getByRole('button', { name: 'Open sidebar' })
  await expect(openSidebar).toBeVisible()
  const reopenCenterOffsets = await page.evaluate(async () => {
    const offsets: number[] = []
    for (let frame = 0; frame < 6; frame += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
      const reopen = document.querySelector<HTMLElement>('[data-test-id="open-layers-panel"]')
      if (!reopen) continue
      const bounds = reopen.getBoundingClientRect()
      offsets.push(Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2))
    }
    return offsets
  })
  expect(reopenCenterOffsets.length).toBeGreaterThan(0)
  expect(Math.max(...reopenCenterOffsets)).toBeLessThanOrEqual(1)
  const openBounds = await openSidebar.boundingBox()
  expect(openBounds).not.toBeNull()
  if (!openBounds) throw new Error('Sidebar reopen tab bounds missing')
  expect(Math.round(openBounds.x)).toBe(12)
  expect(Math.round(openBounds.width)).toBe(28)
  expect(Math.round(openBounds.height)).toBe(44)
  await expect(openSidebar).toHaveCSS('border-radius', '10px')
  await expect(page.getByRole('toolbar', { name: 'Sidebar' })).toBeVisible()
  await expect(page.getByTestId('sidebar-compact-tab-drag-handle')).toHaveCount(0)
  await openSidebar.focus()
  await expect
    .poll(() => openSidebar.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe('none')
  await openSidebar.click()
  await expect(page.getByRole('button', { name: 'Close sidebar' })).toBeVisible()
})

test('uses matching floating reopen pills for both sidebars', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const openRight = page.getByRole('button', { name: 'Open right sidebar' })
  await expect(openRight).toBeVisible()
  const rightBounds = await openRight.boundingBox()
  if (!rightBounds) throw new Error('Right sidebar reopen bounds missing')
  const viewport = await page.evaluate(() => ({
    height: window.innerHeight,
    width: window.innerWidth
  }))
  expect(Math.round(viewport.width - rightBounds.x - rightBounds.width)).toBe(12)
  expect(Math.round(rightBounds.y + rightBounds.height / 2)).toBe(Math.round(viewport.height / 2))
  expect(Math.round(rightBounds.width)).toBe(28)
  expect(Math.round(rightBounds.height)).toBe(44)
  await expect(openRight).toHaveCSS('border-radius', '10px')

  await openRight.click()
  const rightPanel = page.getByTestId('t3-right-panel')
  await expect(rightPanel).toHaveAttribute('data-state', 'open')
  await expect(page.getByTestId('workspace-layers-surface')).toBeVisible()
  await expect(openRight).toHaveCount(0)
  await expect(rightPanel.getByRole('button', { name: 'Close right panel' })).toHaveCount(0)
  const rightCloseHinge = page.getByTestId('close-right-panel-hinge')
  const rightCloseArrow = rightCloseHinge.locator('[data-sidebar-collapse-arrow="true"]')
  const rightCloseDivider = rightCloseHinge.locator('[data-sidebar-collapse-divider="true"]')
  await expect(rightCloseHinge).toHaveCSS('opacity', '1')
  const [rightPanelBounds, rightCloseHingeBounds, rightResizeBounds] = await Promise.all([
    rightPanel.boundingBox(),
    rightCloseHinge.boundingBox(),
    page.getByTestId('t3-right-panel-resize-handle').boundingBox()
  ])
  if (!rightPanelBounds || !rightCloseHingeBounds || !rightResizeBounds) {
    throw new Error('Right sidebar edge rail bounds missing')
  }
  expect(Math.round(rightCloseHingeBounds.x + rightCloseHingeBounds.width)).toBe(
    Math.round(rightResizeBounds.x)
  )
  expect(Math.round(rightCloseHingeBounds.width)).toBe(20)
  expect(Math.round(rightCloseHingeBounds.y)).toBe(0)
  expect(Math.round(rightCloseHingeBounds.height)).toBe(viewport.height)
  expect(rightCloseHingeBounds.x + rightCloseHingeBounds.width).toBeLessThanOrEqual(
    rightPanelBounds.x
  )
  await page.mouse.move(
    rightCloseHingeBounds.x + rightCloseHingeBounds.width / 2,
    rightCloseHingeBounds.y + rightCloseHingeBounds.height / 2
  )
  await expect(rightCloseArrow).toHaveCSS('opacity', '1')
  await expect(rightCloseDivider).toHaveCSS('opacity', '0')

  await page.mouse.move(
    rightCloseHingeBounds.x + rightCloseHingeBounds.width / 2,
    rightCloseHingeBounds.y + 80
  )
  await expect(rightCloseArrow).toHaveCSS('opacity', '1')
  await expect(rightCloseDivider).toHaveCSS('opacity', '0.35')
  await page.mouse.click(
    rightCloseHingeBounds.x + rightCloseHingeBounds.width / 2,
    rightCloseHingeBounds.y + rightCloseHingeBounds.height * 0.82
  )
  await expect(rightPanel).toHaveAttribute('data-state', 'closed')
  await expect(openRight).toBeVisible()

  await page.getByRole('button', { name: 'Close sidebar' }).click()
  const openLeft = page.getByRole('button', { name: 'Open sidebar' })
  await expect(openLeft).toBeVisible()
  const leftBounds = await openLeft.boundingBox()
  if (!leftBounds) throw new Error('Left sidebar reopen bounds missing')
  expect(Math.round(leftBounds.x)).toBe(12)
  expect(Math.round(leftBounds.y + leftBounds.height / 2)).toBe(Math.round(viewport.height / 2))
  expect(Math.round(leftBounds.width)).toBe(Math.round(rightBounds.width))
  expect(Math.round(leftBounds.height)).toBe(Math.round(rightBounds.height))
  await expect(openLeft).toHaveCSS('border-radius', '10px')
})

test('keeps Diff open and preserves the right-sidebar reopen control', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const openRight = page.getByRole('button', { name: 'Open right sidebar' })
  await expect(openRight).toBeVisible()

  await page.getByRole('button', { name: 'Open Dental Chart layers' }).click()
  const rightPanel = page.getByTestId('t3-right-panel')
  await expect(rightPanel).toHaveAttribute('data-state', 'open')
  await expect(page.getByTestId('workspace-layers-surface')).toBeVisible()

  await rightPanel.getByRole('button', { name: 'Diff', exact: true }).click()
  await expect(rightPanel).toHaveAttribute('data-state', 'open')
  await expect(rightPanel.getByTestId('t3-diff-toolbar')).toBeVisible()

  await page.getByTestId('close-right-panel-hinge').click()
  await expect(rightPanel).toHaveAttribute('data-state', 'closed')
  await expect(openRight).toBeVisible()
  await openRight.click()
  await expect(rightPanel).toHaveAttribute('data-state', 'open')
  await expect(page.getByTestId('workspace-layers-surface')).toBeVisible()
})

test('moves both sidebar shells continuously in both directions', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const leftShell = page.getByTestId('layers-shell-motion')
  const [leftClosingPositions] = await Promise.all([
    sampleElementBounds(leftShell, 'x'),
    (async () => {
      await page.waitForTimeout(50)
      await page.getByRole('button', { name: 'Close sidebar' }).click()
    })()
  ])
  expect(largestStepRatio(leftClosingPositions)).toBeLessThan(0.2)

  const [leftOpeningPositions] = await Promise.all([
    sampleElementBounds(leftShell, 'x'),
    (async () => {
      await page.waitForTimeout(50)
      await page.getByRole('button', { name: 'Open sidebar' }).click()
    })()
  ])
  expect(largestStepRatio(leftOpeningPositions)).toBeLessThan(0.2)

  const rightPanel = page.getByTestId('t3-right-panel')
  const [rightOpeningPositions] = await Promise.all([
    sampleElementBounds(rightPanel, 'x'),
    (async () => {
      await page.waitForTimeout(50)
      await page.getByRole('button', { name: 'Open right sidebar' }).click()
    })()
  ])
  expect(largestStepRatio(rightOpeningPositions)).toBeLessThan(0.2)

  const [rightClosingPositions] = await Promise.all([
    sampleElementBounds(rightPanel, 'x'),
    (async () => {
      await page.waitForTimeout(50)
      await page.getByTestId('close-right-panel-hinge').click()
    })()
  ])
  expect(largestStepRatio(rightClosingPositions)).toBeLessThan(0.2)
})

test('crossfades both sidebar reopen controls through disclosure changes', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const leftToggle = page.getByTestId('sidebar-toggle-motion')
  await expect(leftToggle).toHaveCSS('opacity', '0')
  await page.getByRole('button', { name: 'Close sidebar' }).click()
  await page.waitForTimeout(100)
  const leftClosingOpacity = await leftToggle.evaluate((toggle) =>
    Number(getComputedStyle(toggle).opacity)
  )
  expect(leftClosingOpacity).toBeGreaterThan(0)
  expect(leftClosingOpacity).toBeLessThan(1)
  await expect(leftToggle).toHaveCSS('opacity', '1')

  await page.getByRole('button', { name: 'Open sidebar' }).click()
  await page.waitForTimeout(80)
  const leftOpeningOpacity = await leftToggle.evaluate((toggle) =>
    Number(getComputedStyle(toggle).opacity)
  )
  expect(leftOpeningOpacity).toBeGreaterThan(0)
  expect(leftOpeningOpacity).toBeLessThan(1)
  await expect(leftToggle).toHaveCSS('opacity', '0')

  const rightToggle = page.getByTestId('right-sidebar-toggle-motion')
  await expect(rightToggle).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: 'Open right sidebar' }).click()
  await page.waitForTimeout(80)
  const rightOpeningOpacity = await rightToggle.evaluate((toggle) =>
    Number(getComputedStyle(toggle).opacity)
  )
  expect(rightOpeningOpacity).toBeGreaterThan(0)
  expect(rightOpeningOpacity).toBeLessThan(1)
  await expect(rightToggle).toHaveCSS('opacity', '0')

  await page.getByTestId('close-right-panel-hinge').click()
  await page.waitForTimeout(100)
  const rightClosingOpacity = await rightToggle.evaluate((toggle) =>
    Number(getComputedStyle(toggle).opacity)
  )
  expect(rightClosingOpacity).toBeGreaterThan(0)
  expect(rightClosingOpacity).toBeLessThan(1)
  await expect(rightToggle).toHaveCSS('opacity', '1')
})

test('aligns subprojects and hides them with collapsed parents', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const parentProjectToggle = page.getByTestId('work-map-project-toggle-project:dental-chart')
  const accessibleChildProjectToggle = page.getByRole('button', {
    name: 'Expand Work Map',
    exact: true
  })
  const todoIcon = page
    .getByText('Todo', { exact: true })
    .locator('..')
    .locator('svg[data-iconly="time-circle"]')
  const childIcon = page.getByTestId('work-map-bot-avatar-project:work-map')
  await expect(accessibleChildProjectToggle).toHaveCount(1)
  const [todoIconBounds, childIconBounds] = await Promise.all([
    todoIcon.boundingBox(),
    childIcon.boundingBox()
  ])
  expect(todoIconBounds).not.toBeNull()
  expect(childIconBounds).not.toBeNull()
  if (!todoIconBounds || !childIconBounds) throw new Error('Work Map icon bounds missing')
  const iconCenterOffset =
    childIconBounds.x + childIconBounds.width / 2 - (todoIconBounds.x + todoIconBounds.width / 2)
  expect(Math.abs(iconCenterOffset)).toBeLessThanOrEqual(4)

  await parentProjectToggle.click()
  await expect(accessibleChildProjectToggle).toHaveCount(0)
  await expect(parentProjectToggle).toHaveAttribute('aria-expanded', 'false')
  await parentProjectToggle.click()
  await expect(accessibleChildProjectToggle).toHaveCount(1)
})

test('opens and closes project content from a true zero-height frame', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const content = page.getByTestId('work-map-project-content-project:dental-chart')
  await page.getByRole('button', { name: 'Collapse Dental Chart' }).click()
  await expect(content).toHaveCount(0)

  const [openingHeights] = await Promise.all([
    sampleProjectContentHeights(page, 'project:dental-chart'),
    page.getByRole('button', { name: 'Expand Dental Chart' }).click()
  ])
  const firstMountedHeight = openingHeights.find((height) => height !== null)
  expect(firstMountedHeight).toBeDefined()
  expect(firstMountedHeight).toBeLessThanOrEqual(1)
  await expect(content).toBeVisible()

  const closingEndpointHeightPromise = projectContentHeightAtGridTransitionBoundary(
    page,
    'project:dental-chart'
  )
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.workMapGridTransitionArmed))
    .toBe('project:dental-chart')
  await page.getByRole('button', { name: 'Collapse Dental Chart' }).click()
  const closingEndpointHeight = await closingEndpointHeightPromise
  expect(closingEndpointHeight).toBeLessThanOrEqual(1)
  await expect(content).toHaveCount(0)
})

test('moves the former directory tray icon to Chats', async ({ page }) => {
  const miscThread = paginationThread(0)
  await mockAgentShell(page, { threads: [miscThread] })
  await setLocalStorageItem(
    page,
    'open-pencil:work-map-open-projects-v1',
    JSON.stringify({ __misc__: true, 'project:dental-chart': true })
  )
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const closedIcon = page.getByTestId('work-map-misc-icon-closed')
  const openIcon = page.getByTestId('work-map-misc-icon-open')
  await expect(closedIcon).toHaveCSS('opacity', '0')
  await expect(openIcon).toHaveCSS('opacity', '1')

  await page.getByRole('button', { name: 'Collapse Chats' }).click()
  await page.waitForTimeout(80)
  const [closedOpacity, openOpacity] = await Promise.all([
    closedIcon.evaluate((icon) => Number(getComputedStyle(icon).opacity)),
    openIcon.evaluate((icon) => Number(getComputedStyle(icon).opacity))
  ])
  expect(closedOpacity).toBeGreaterThan(0)
  expect(closedOpacity).toBeLessThan(1)
  expect(openOpacity).toBeGreaterThan(0)
  expect(openOpacity).toBeLessThan(1)

  await expect(closedIcon).toHaveCSS('opacity', '1')
  await expect(openIcon).toHaveCSS('opacity', '0')
})

test('moves rows below child projects continuously with their parent disclosure', async ({
  page
}) => {
  const updatedAt = '2026-08-25T12:00:00.000Z'
  await mockAgentShell(page, {
    workMap: {
      placements: [],
      projects: [
        {
          createdAt: updatedAt,
          id: 'project:dental-chart',
          name: 'Dental Chart',
          updatedAt
        },
        {
          createdAt: updatedAt,
          id: 'project:work-map',
          name: 'Work Map',
          parentId: 'project:dental-chart',
          updatedAt
        },
        {
          createdAt: updatedAt,
          id: 'project:following',
          name: 'Following project',
          updatedAt
        }
      ],
      revision: 1,
      todos: []
    }
  })
  await setLocalStorageItem(
    page,
    'open-pencil:work-map-open-projects-v1',
    JSON.stringify({ 'project:dental-chart': true, 'project:work-map': true })
  )
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const followingRow = page.getByTestId('work-map-project-row-project:following')
  await expect(followingRow).toBeVisible()
  const [closingPositions] = await Promise.all([
    sampleWorkMapRowY(page, 'work-map-project-row-project:following'),
    (async () => {
      await page.waitForTimeout(50)
      await page.getByRole('button', { name: 'Collapse Dental Chart' }).click()
    })()
  ])
  expect(largestStepRatio(closingPositions)).toBeLessThan(0.1)

  const [openingPositions] = await Promise.all([
    sampleWorkMapRowY(page, 'work-map-project-row-project:following'),
    (async () => {
      await page.waitForTimeout(50)
      await page.getByRole('button', { name: 'Expand Dental Chart' }).click()
    })()
  ])
  expect(largestStepRatio(openingPositions)).toBeLessThan(0.1)
})

test('keeps Bot rows quiet and exposes separate Bot and chat controls in the header', async ({
  page
}) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const parentProjectRow = page.getByTestId('work-map-project-row-project:dental-chart')
  const addDirectory = page.getByTestId('work-map-add-subproject-project:dental-chart')
  const newChat = page.getByTestId('work-map-new-chat-project:dental-chart')
  await parentProjectRow.hover()

  await expect(addDirectory).toHaveCount(0)
  await expect(newChat).toHaveCount(0)

  const createBot = page.getByTestId('work-map-new-project')
  const createChat = page.getByTestId('agent-thread-new')
  await expect(createBot).toBeVisible()
  await expect(createChat).toBeVisible()
  await expect(createBot).toHaveAttribute('draggable', 'true')
  await expect(createChat).toHaveAttribute('draggable', 'true')
  await expect(createBot).toHaveAttribute('aria-label', 'Add Bot')
  await expect(createChat).toHaveAttribute('aria-label', 'Add chat')
})

test('drops new chat and Bot templates into sidebar and Board destinations', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const dentalChart = page.getByTestId('work-map-project-row-project:dental-chart')
  await page.getByTestId('agent-thread-new').dragTo(dentalChart)
  await expect(page.getByTestId('agent-selected-header-title')).toContainText('New chat')

  await page.getByTestId('agent-thread-back').click()
  await page.getByTestId('work-map-new-project').dragTo(dentalChart)
  await expect(page.getByTestId('work-map-create-dialog')).toContainText(
    'Add one sub-bot inside Dental Chart.'
  )
  await page.getByRole('button', { name: 'Cancel' }).click()

  await page.getByTestId('work-map-new-project').dragTo(page.getByTestId('canvas-area'), {
    targetPosition: { x: 350, y: 500 }
  })
  await expect(page.getByTestId('work-map-create-dialog')).toContainText(
    'Name the Bot directory being placed on the Board.'
  )
})

test('creates a dormant Todo from an inline attachment-ready composer', async ({ page }) => {
  await mockAgentShell(page)
  await page.route(/\/agent-router\/v1\/pi\/work-map\/todo-chats$/, (route) =>
    route.fulfill({
      body: JSON.stringify({
        placements: [],
        projects: [
          {
            createdAt: '2026-08-25T12:00:00.000Z',
            id: 'project:dental-chart',
            name: 'Dental Chart',
            updatedAt: '2026-08-25T12:00:00.000Z'
          }
        ],
        revision: 2,
        thread: { id: 'todo-chat:inline' },
        todo: {
          id: 'todo:inline',
          projectId: 'project:dental-chart',
          status: 'todo',
          threadId: 'todo-chat:inline',
          title: 'Investigate image attachments'
        },
        todos: [
          {
            createdAt: '2026-08-25T12:00:00.000Z',
            id: 'todo:inline',
            projectId: 'project:dental-chart',
            status: 'todo',
            threadId: 'todo-chat:inline',
            title: 'Investigate image attachments',
            updatedAt: '2026-08-25T12:00:00.000Z'
          }
        ]
      }),
      contentType: 'application/json',
      status: 201
    })
  )
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  await page.getByTestId('work-map-add-todo-project:dental-chart').click()
  await expect(page.getByTestId('work-map-create-dialog')).toHaveCount(0)
  const composer = page.getByTestId('work-map-todo-composer-project:dental-chart')
  await expect(composer).toBeVisible()
  await expect(
    composer.getByRole('button', { name: 'Add files, folders, or sessions' })
  ).toBeVisible()

  const input = composer.getByRole('textbox', { name: 'New todo' })
  await input.fill('Investigate image attachments')
  await input.press('Shift+Enter')
  await input.type('without interrupting the current work')
  const requestPromise = page.waitForRequest(/\/agent-router\/v1\/pi\/work-map\/todo-chats$/)
  await input.press('Enter')
  const request = await requestPromise
  const body = request.postDataJSON() as {
    brief: { goal: string }
    projectId: string
    title?: string
  }

  expect(body.projectId).toBe('project:dental-chart')
  expect(body.brief.goal).toBe(
    'Investigate image attachments\nwithout interrupting the current work'
  )
  expect(body.title).toBeUndefined()
  await expect(composer).toHaveCount(0)
  await expect(page.getByTestId('work-map-todo-todo:inline')).toBeVisible()
})

test('adds breathing room above the sidebar utilities without shrinking them', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const utilityTabs = page.getByRole('tablist', { name: 'Sidebar utilities' })
  await expect(utilityTabs).toHaveCSS('margin-top', '12px')
  await expect(utilityTabs).toHaveCSS('height', '40px')
})

test('balances the Work map title optical top and side spacing', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const spacing = await page.getByTestId('work-map-title').evaluate((element) => {
    const header = element.parentElement?.parentElement?.parentElement
    const actions = header?.querySelectorAll('button')
    const lastAction = actions?.[actions.length - 1]
    if (!header || !lastAction) throw new Error('Work Map header structure unavailable')
    const headerBounds = header.getBoundingClientRect()
    const lastActionBounds = lastAction.getBoundingClientRect()
    const titleRange = document.createRange()
    titleRange.selectNodeContents(element)
    const titleBounds = titleRange.getBoundingClientRect()
    return {
      left: titleBounds.left - headerBounds.left,
      right: headerBounds.right - lastActionBounds.right,
      top: titleBounds.top - headerBounds.top
    }
  })

  expect(Math.abs(spacing.top - spacing.left)).toBeLessThan(1)
  expect(spacing.right).toBe(spacing.left)
})

test('closes Work map search when clicking outside it', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const searchToggle = page.getByTestId('work-map-search-toggle')
  const searchInput = page.getByTestId('work-map-search-field').locator('input')
  await searchToggle.click()
  await searchInput.fill('Dental')
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(searchInput).toHaveValue('Dental')

  await page.getByText('Pinned', { exact: true }).click()
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(searchInput).toHaveValue('')
  await expect(searchToggle).not.toBeFocused()
})

test('uses a pointer for categorized work and Chats', async ({ page }) => {
  const placedThread = paginationThread(0)
  const miscThread = paginationThread(1)
  await mockAgentShell(page, {
    threads: [placedThread, miscThread],
    workMap: {
      placements: [
        {
          manual: true,
          projectId: 'project:cursor',
          threadId: placedThread.id,
          updatedAt: placedThread.updatedAt
        }
      ],
      projects: [
        {
          createdAt: placedThread.createdAt,
          id: 'project:cursor',
          name: 'Cursor states',
          updatedAt: placedThread.updatedAt
        }
      ],
      revision: 1,
      todos: [
        {
          createdAt: placedThread.createdAt,
          id: 'todo:placed-chat',
          projectId: 'project:cursor',
          status: 'in_motion',
          threadId: placedThread.id,
          title: 'Placed chat',
          updatedAt: placedThread.updatedAt
        }
      ]
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const placedChat = page.getByTestId('work-map-todo-todo:placed-chat')
  await expect(placedChat).toHaveCSS('cursor', 'pointer')
  await placedChat.dispatchEvent('pointerdown', { button: 0, pointerId: 1 })
  await expect(placedChat).toHaveCSS('cursor', 'grabbing')
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })))
  await expect(placedChat).toHaveCSS('cursor', 'pointer')
  await page.getByRole('button', { name: 'Expand Chats' }).first().click()
  const miscChat = page.getByTestId('agent-chat-thread-agent:pagination-1')
  await expect(miscChat).toHaveCSS('cursor', 'pointer')
  await miscChat.dispatchEvent('pointerdown', { button: 0, pointerId: 2 })
  await expect(miscChat).toHaveCSS('cursor', 'grabbing')
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 })))
  await expect(miscChat).toHaveCSS('cursor', 'pointer')
})

test('collapses Todo and In motion independently while preserving active work', async ({
  page
}) => {
  const updatedAt = '2026-08-25T12:00:00.000Z'
  const running = {
    ...paginationThread(0),
    id: 'toggle-working',
    state: 'running',
    task: 'Toggle working'
  }
  await mockAgentShell(page, {
    threads: [running],
    workMap: {
      placements: [
        {
          manual: true,
          projectId: 'project:toggle',
          threadId: running.id,
          updatedAt
        }
      ],
      projects: [
        {
          createdAt: updatedAt,
          id: 'project:toggle',
          name: 'Toggle states',
          updatedAt
        }
      ],
      revision: 1,
      todos: []
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const inMotionToggle = page.getByTestId('work-map-status-toggle-project:toggle-in_motion')
  const inMotionContent = page.getByTestId('work-map-status-content-project:toggle-in_motion')
  const inMotionWorking = inMotionToggle.getByRole('status', { name: 'Working' })
  await expect(inMotionToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(inMotionWorking.locator('.t3-thread-status-spinner')).toHaveCSS(
    'animation-name',
    't3-thread-status-spin'
  )
  await inMotionToggle.click()
  await expect(inMotionToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(inMotionContent).toBeHidden()
  await expect(inMotionWorking).toBeVisible()
  await inMotionToggle.click()
  await expect(inMotionToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(inMotionContent).toBeVisible()

  const todoToggle = page.getByTestId('work-map-status-toggle-project:toggle-todo')
  const todoContent = page.getByTestId('work-map-status-content-project:toggle-todo')
  await todoToggle.click()
  await expect(todoToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(todoContent).toBeHidden()
  await todoToggle.click()
  await expect(todoToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(todoContent).toBeVisible()
})

test('uses dots for actionable chat states and spinners while chats work', async ({ page }) => {
  const updatedAt = '2026-08-25T12:00:00.000Z'
  const settled = { ...paginationThread(4), id: 'misc-settled', task: 'Misc settled' }
  const threads = [
    { ...paginationThread(0), id: 'placed-working', state: 'running', task: 'Placed working' },
    {
      ...paginationThread(1),
      id: 'placed-failed',
      recentUpdate: 'Failed',
      state: 'needs_attention',
      task: 'Placed failed'
    },
    { ...paginationThread(2), id: 'misc-working', state: 'running', task: 'Misc working' },
    {
      ...paginationThread(3),
      id: 'misc-failed',
      recentUpdate: 'Failed',
      state: 'needs_attention',
      task: 'Misc failed'
    },
    settled
  ]
  await mockAgentShell(page, {
    threads,
    workMap: {
      placements: threads.slice(0, 2).map((thread) => ({
        manual: true,
        projectId: 'project:status',
        threadId: thread.id,
        updatedAt
      })),
      projects: [
        {
          createdAt: updatedAt,
          id: 'project:status',
          name: 'Status states',
          updatedAt
        }
      ],
      revision: 1,
      todos: [
        {
          createdAt: updatedAt,
          id: 'todo:placed-working',
          projectId: 'project:status',
          status: 'in_motion',
          threadId: 'placed-working',
          title: 'Placed working',
          updatedAt: '2026-08-25T12:00:02.000Z'
        },
        {
          createdAt: updatedAt,
          id: 'todo:placed-failed',
          projectId: 'project:status',
          status: 'in_motion',
          threadId: 'placed-failed',
          title: 'Placed failed',
          updatedAt: '2026-08-25T12:00:01.000Z'
        }
      ]
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  const placedWorking = page
    .getByTestId('work-map-todo-todo:placed-working')
    .getByRole('status', { name: 'Working' })
  const placedFailed = page
    .getByTestId('work-map-todo-todo:placed-failed')
    .getByRole('status', { name: 'Failed' })
  const miscSummary = page.getByTestId('work-map-misc-row').getByRole('status', { name: 'Working' })
  await expect(miscSummary.locator('.t3-thread-status-spinner')).toHaveCSS(
    'animation-name',
    't3-thread-status-spin'
  )
  await page.getByRole('button', { name: 'Expand Chats' }).first().click()
  const miscWorking = page
    .getByTestId('agent-chat-thread-agent:misc-working')
    .getByRole('status', { name: 'Working' })
  const miscFailed = page
    .getByTestId('agent-chat-thread-agent:misc-failed')
    .getByRole('status', { name: 'Failed' })
  for (const working of [placedWorking, miscWorking]) {
    await expect(working).toHaveText('')
    await expect(working.locator('.t3-thread-status-dot')).toHaveCount(0)
    await expect(working.locator('.t3-thread-status-spinner')).toHaveCSS(
      'animation-name',
      't3-thread-status-spin'
    )
  }
  for (const failed of [placedFailed, miscFailed]) {
    await expect(failed).toHaveText('')
    await expect(failed).toHaveAttribute('data-tone', 'red')
    await expect(failed.locator('.t3-thread-status-dot')).toHaveCount(1)
    await expect(failed.locator('.t3-thread-status-spinner')).toHaveCount(0)
  }
  await expect(
    page.getByTestId('agent-chat-thread-agent:misc-settled').getByRole('status')
  ).toHaveCount(0)
})

test('summarizes working, failed, and finished chats on the collapsed Chats row', async ({
  page
}) => {
  const working = { ...paginationThread(0), id: 'misc-working', state: 'running' }
  const failed = {
    ...paginationThread(1),
    id: 'misc-failed',
    recentUpdate: 'Failed',
    state: 'needs_attention'
  }
  const finished = { ...paginationThread(2), id: 'misc-finished' }
  const threads = [working, failed, finished]
  await setLocalStorageItem(
    page,
    'open-pencil:agent-thread-preferences-v1',
    JSON.stringify({ 'misc-finished': { unread: true } })
  )
  await mockAgentShell(page, { threads })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const miscRow = page.getByTestId('work-map-misc-row')
  await expect(miscRow.getByRole('status', { name: 'Working' })).toHaveAttribute(
    'data-pulse',
    'true'
  )

  working.state = 'completed'
  await page.reload()
  await new CanvasHelper(page).waitForInit()
  await expect(miscRow.getByRole('status', { name: 'Failed' })).toHaveAttribute('data-tone', 'red')

  failed.state = 'completed'
  await page.reload()
  await new CanvasHelper(page).waitForInit()
  await expect(miscRow.getByRole('status', { name: 'Completed' })).toHaveAttribute(
    'data-tone',
    'emerald'
  )
})

test('reveals Work map search smoothly without animating layout', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const searchField = page.getByTestId('work-map-search-field')
  const searchToggle = page.getByTestId('work-map-search-toggle')
  const createChat = page.getByTestId('agent-thread-new')
  const createBot = page.getByTestId('work-map-new-project')
  const searchInput = page.getByRole('textbox', { name: 'Search work map' })
  const title = page.getByTestId('work-map-title')
  const [searchToggleBounds, createChatBounds, createBotBounds] = await Promise.all([
    searchToggle.boundingBox(),
    createChat.boundingBox(),
    createBot.boundingBox()
  ])
  expect(searchToggleBounds).not.toBeNull()
  expect(createChatBounds).not.toBeNull()
  expect(createBotBounds).not.toBeNull()
  if (!searchToggleBounds || !createChatBounds || !createBotBounds) {
    throw new Error('Work Map header action bounds missing')
  }
  expect(searchToggleBounds.x).toBeLessThan(createChatBounds.x)
  expect(createChatBounds.x).toBeLessThan(createBotBounds.x)
  const closedBounds = await searchField.boundingBox()
  expect(closedBounds).not.toBeNull()
  if (!closedBounds) throw new Error('Closed Work Map search bounds missing')
  expect(closedBounds.width).toBeGreaterThan(100)
  await expect(searchField).toHaveCSS('opacity', '0')
  await expect(searchField).toHaveCSS('transition-property', 'opacity, translate')

  await searchToggle.click()
  await page.evaluate(() => new Promise<void>(requestAnimationFrame))
  const promptExpandedBounds = await searchField.boundingBox()
  expect(promptExpandedBounds).not.toBeNull()
  if (!promptExpandedBounds) throw new Error('Prompt Work Map search bounds missing')
  expect(Math.abs(promptExpandedBounds.width - closedBounds.width)).toBeLessThan(1)
  await expect(searchInput).toBeFocused()
  await expect(searchField).toHaveCSS('opacity', '1')
  const expandedBounds = await searchField.boundingBox()
  expect(expandedBounds).not.toBeNull()
  if (!expandedBounds) throw new Error('Expanded Work Map search bounds missing')
  expect(expandedBounds.width).toBeGreaterThan(100)
  await expect(title).toHaveCSS('opacity', '0')

  await searchInput.press('Escape')
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false')
  const reclosedBounds = await searchField.boundingBox()
  expect(reclosedBounds).not.toBeNull()
  if (!reclosedBounds) throw new Error('Reclosed Work Map search bounds missing')
  expect(Math.abs(reclosedBounds.width - closedBounds.width)).toBeLessThan(1)
  await expect(title).toHaveCSS('opacity', '1')
})
