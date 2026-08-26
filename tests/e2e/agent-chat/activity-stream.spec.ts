import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

function mockThread(page: Page, thread: object | (() => object)) {
  const current = () => (typeof thread === 'function' ? thread() : thread)
  return Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
      route.fulfill({
        body: JSON.stringify({ threads: [current()] }),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/conversations\/[^/?]+(?:\/messages)?(?:\?.*)?$/, (route) =>
      route.fulfill({
        body: JSON.stringify(current()),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
      route.fulfill({ body: '{"models":[]}', contentType: 'application/json' })
    )
  ])
}

async function openThread(page: Page, title: string) {
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
  await page.getByTestId('left-panel-chats-tab').click()
  const panel = page.getByTestId('agent-chats-panel')
  await panel.getByTestId('agent-thread-selector').getByText(title).click()
  return panel
}

function activeThread(state: 'completed' | 'running') {
  const completed = state === 'completed'
  return {
    canFollowUp: true,
    createdAt: '2026-08-25T14:00:00.000Z',
    effort: 'high',
    id: `t3-workflow-${state}`,
    messages: [
      {
        createdAt: '2026-08-25T14:00:00.000Z',
        id: 'prompt',
        role: 'user',
        text: 'Use the T3 message workflow.'
      },
      {
        createdAt: '2026-08-25T14:00:01.000Z',
        id: 'commentary-1',
        parts: [
          {
            state: 'complete',
            text: 'I found the stream owner.',
            type: 'commentary'
          }
        ],
        role: 'assistant',
        text: ''
      },
      {
        createdAt: '2026-08-25T14:00:02.000Z',
        id: 'tools-1',
        parts: [
          {
            input: '{"path":"one.ts"}',
            name: 'read_file',
            state: 'success',
            type: 'tool'
          },
          {
            input: '{"path":"two.ts"}',
            name: 'read_file',
            state: 'success',
            type: 'tool'
          },
          {
            input: '{"query":"timeline"}',
            name: 'search',
            state: 'success',
            type: 'tool'
          }
        ],
        role: 'assistant',
        text: ''
      },
      {
        createdAt: '2026-08-25T14:00:03.000Z',
        id: 'commentary-2',
        parts: [
          {
            state: 'complete',
            text: 'The row workflow is the bug.',
            type: 'commentary'
          }
        ],
        role: 'assistant',
        text: ''
      },
      {
        createdAt: '2026-08-25T14:00:04.000Z',
        id: 'tools-2',
        parts: [
          { name: 'web_search', state: 'success', type: 'tool' },
          { name: 'web_search', state: 'success', type: 'tool' },
          { name: 'web_search', state: 'success', type: 'tool' },
          { name: 'web_search', state: 'success', type: 'tool' },
          { name: 'web_search', state: 'success', type: 'tool' },
          {
            name: 'web_fetch',
            state: completed ? 'success' : 'running',
            type: 'tool'
          }
        ],
        role: 'assistant',
        text: ''
      },
      ...(completed
        ? [
            {
              createdAt: '2026-08-25T14:00:14.000Z',
              id: 'answer',
              role: 'assistant',
              text: 'The T3 workflow is installed.'
            }
          ]
        : [])
    ],
    model: 'openai/gpt-5.5',
    recentUpdate: completed ? 'The T3 workflow is installed.' : 'Checking the release…',
    state,
    task: `T3 workflow ${state}`,
    updatedAt: '2026-08-25T14:00:14.000Z',
    workerId: 'worker-t3-workflow'
  }
}

test('uses T3 chronological rows with one latest tool and previous-call overflow', async ({
  page
}) => {
  await mockThread(page, activeThread('running'))
  const panel = await openThread(page, 'T3 workflow running')
  const activity = panel.getByTestId('ai-activity-disclosure').last()
  await expect(activity).toHaveAttribute(
    'data-t3-source-revision',
    '5d7665396083d285132d67038813862a93337ca5'
  )
  const timeline = activity.getByTestId('ai-activity-timeline')
  await expect
    .poll(() =>
      timeline.evaluate((element) =>
        [...element.children].map((child) => child.getAttribute('data-timeline-row-kind'))
      )
    )
    .toEqual(['message', 'work-toggle', 'message', 'work-live', 'working'])
  await expect(
    activity.getByText('Read 2 files and searched code 1 time', { exact: true })
  ).toBeVisible()
  await expect(activity.getByText('Searching the web', { exact: true })).toBeVisible()
  await expect(activity.getByTestId('ai-turn-duration')).toContainText('Working for')

  await activity.getByText('Read 2 files and searched code 1 time', { exact: true }).click()
  await expect(
    activity.locator('[data-timeline-row-id^="tools-1:"][data-timeline-row-kind="work"]')
  ).toHaveCount(3)
})

test('folds settled work behind Worked for and restores the same chronological rows', async ({
  page
}) => {
  await mockThread(page, activeThread('completed'))
  const panel = await openThread(page, 'T3 workflow completed')
  const activity = panel.getByTestId('ai-activity-disclosure').last()
  const timeline = activity.getByTestId('ai-activity-timeline')
  await expect
    .poll(() =>
      timeline.evaluate((element) =>
        [...element.children].map((child) => child.getAttribute('data-timeline-row-kind'))
      )
    )
    .toEqual(['turn-fold'])
  await expect(activity.getByTestId('ai-turn-duration')).toContainText('Worked for 14s')

  await activity.getByTestId('ai-turn-duration').click()
  await expect
    .poll(() =>
      timeline.evaluate((element) =>
        [...element.children].map((child) => child.getAttribute('data-timeline-row-kind'))
      )
    )
    .toEqual(['turn-fold', 'message', 'work', 'work-toggle', 'message', 'work', 'work-toggle'])
  await expect(panel.getByText('The T3 workflow is installed.', { exact: true })).toBeVisible()
})
