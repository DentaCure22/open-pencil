import { expect, test, type Locator } from '@playwright/test'

import type { AiMessage } from '@/app/agent-chat/types'

import { CanvasHelper } from '#tests/helpers/canvas'
import { setLocalStorageItem } from '#tests/helpers/storage'

const FIRST_UPDATED_AT = '2026-08-19T10:00:06.000Z'
const NEXT_UPDATED_AT = '2026-08-19T10:00:07.000Z'
const TOOL_UPDATED_AT = '2026-08-19T10:00:09.000Z'

function messages(count: number): AiMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    createdAt: `2026-08-19T10:00:${String(index).padStart(2, '0')}.000Z`,
    id: `message-${String(index)}`,
    role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
    text:
      index === 0
        ? 'Oldest retained transcript message'
        : `Conversation message ${String(index + 1)} with enough content to keep the transcript scrollable.`
  }))
}

function conversation(messageCount: number, updatedAt: string, toolAdded = false) {
  const transcript = messages(messageCount)
  if (toolAdded) {
    const createdAt = new Date(Date.now() + 1_000).toISOString()
    for (let index = 0; index < 8; index += 1) {
      transcript.push(
        {
          createdAt,
          id: `message-tool-update-${String(index)}`,
          parts: [
            {
              input: `{"cmd":"bun test --filter ${String(index)}"}`,
              name: 'exec_command',
              output:
                'Focused transcript stability checks completed without replacing the mounted chat.',
              state: 'success',
              type: 'tool'
            }
          ],
          role: 'assistant',
          text: ''
        },
        {
          createdAt,
          id: `message-reasoning-update-${String(index)}`,
          parts: [
            { state: 'complete', text: 'Checked the next focused result.', type: 'reasoning' }
          ],
          role: 'assistant',
          text: ''
        }
      )
    }
  }
  return {
    canFollowUp: true,
    createdAt: '2026-08-19T10:00:00.000Z',
    effort: 'medium',
    id: 'task-1',
    messages: transcript,
    model: 'gpt-5.5',
    recentUpdate: 'Agent conversation update',
    state: 'running' as const,
    task: 'Keep the mounted Board conversation stable',
    updatedAt
  }
}

async function settledScrollTop(viewport: Locator): Promise<number> {
  let previous = -1
  let stableSamples = 0
  await expect
    .poll(async () => {
      const current = await viewport.evaluate((element) => element.scrollTop)
      stableSamples = current === previous ? stableSamples + 1 : 0
      previous = current
      return stableSamples
    })
    .toBeGreaterThanOrEqual(2)
  return previous
}

test('keeps a retained Board chat mounted while preview polling advances', async ({ page }) => {
  let advanced = false
  let toolAdded = false
  let fullRequests = 0
  const steers: string[] = []
  const currentUpdatedAt = () => {
    if (toolAdded) return TOOL_UPDATED_AT
    return advanced ? NEXT_UPDATED_AT : FIRST_UPDATED_AT
  }
  let releaseUpdatedTranscript = () => {
    throw new Error('Updated transcript release was not initialized')
  }
  const updatedTranscriptBlocked = new Promise<void>((resolve) => {
    releaseUpdatedTranscript = () => resolve()
  })

  await page.route('http://127.0.0.1:7602/agent-router/v1/pi/conversations?preview=1', (route) => {
    const full = conversation(advanced ? 25 : 24, currentUpdatedAt(), toolAdded)
    return route.fulfill({
      body: JSON.stringify({ threads: [{ ...full, messages: full.messages.slice(-3) }] }),
      contentType: 'application/json'
    })
  })
  await page.route(
    'http://127.0.0.1:7602/agent-router/v1/pi/conversations/task-1',
    async (route) => {
      fullRequests += 1
      if (fullRequests > 1) await updatedTranscriptBlocked
      const full = conversation(advanced ? 25 : 24, currentUpdatedAt(), toolAdded)
      await route.fulfill({ body: JSON.stringify(full), contentType: 'application/json' })
    }
  )
  await page.route(
    'http://127.0.0.1:7602/agent-router/v1/pi/conversations/task-1/steer',
    async (route) => {
      steers.push((route.request().postDataJSON() as { message: string }).message)
      await route.fulfill({
        body: '{"dispatchedAt":"2026-08-19T10:00:08.000Z","jobId":"job-steer","state":"running","threadId":"task-1"}',
        contentType: 'application/json',
        status: 202
      })
    }
  )

  await setLocalStorageItem(
    page,
    'op-agent-board-known-conversations-v1',
    JSON.stringify(['task-1'])
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
        document.workerConversationId === 'task-1'
      )
    })
    const card =
      existing ??
      createCodeObject(store, {
        document: createAgentConversationTerminalDocument({
          name: 'Keep the mounted Board conversation stable',
          workerConversationId: 'task-1'
        }),
        height: 560,
        name: 'Keep the mounted Board conversation stable',
        parentId: store.state.currentPageId,
        width: 520,
        x: 160,
        y: 120
      })
    store.zoomToNode(card.id)
    store.requestRender()
  })

  const workerSurface = page
    .getByTestId('agent-chat-board-surface')
    .and(page.locator('[data-conversation-id="task-1"]'))
  const oldestMessage = workerSurface.getByTestId('ai-message').filter({
    hasText: 'Oldest retained transcript message'
  })
  const composer = workerSurface.getByRole('textbox', { name: 'Task conversation input' })
  const workerHost = page.locator('[data-code-object-id]').filter({ has: workerSurface })
  const workerId = await workerHost.getAttribute('data-code-object-id')
  if (!workerId) throw new Error('Worker Board object identity unavailable')
  await page
    .getByTestId(`code-object-overlay-${workerId}`)
    .getByTestId('code-object-design-hit-target')
    .click({ force: true })
  await expect(composer).toBeFocused()
  await expect(oldestMessage).toBeAttached()
  await expect.poll(() => fullRequests).toBe(1)

  await workerSurface.evaluate((element) => element.setAttribute('data-residency-probe', 'surface'))
  await oldestMessage.evaluate((element) => element.setAttribute('data-residency-probe', 'message'))
  await composer.fill('Unsent draft must survive polling')
  const viewport = workerSurface.getByTestId('ai-conversation-viewport')
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeLessThanOrEqual(1)
  await viewport.hover()
  await page.mouse.wheel(0, -600)
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeGreaterThan(100)
  const retainedScrollTop = await settledScrollTop(viewport)

  advanced = true
  await expect.poll(() => fullRequests, { timeout: 5_000 }).toBe(2)

  await expect(workerSurface).toHaveAttribute('data-residency-probe', 'surface')
  await expect(oldestMessage).toHaveAttribute('data-residency-probe', 'message')
  await expect(composer).toHaveValue('Unsent draft must survive polling')
  await expect(workerSurface).toContainText('Conversation message 25')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(retainedScrollTop)

  releaseUpdatedTranscript()
  await expect.poll(() => fullRequests).toBe(2)
  await expect(workerSurface).toHaveAttribute('data-residency-probe', 'surface')
  await expect(oldestMessage).toHaveAttribute('data-residency-probe', 'message')
  await expect(composer).toHaveValue('Unsent draft must survive polling')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(retainedScrollTop)

  await workerSurface.getByRole('button', { name: 'Steer task' }).click()
  await expect.poll(() => steers).toEqual(['Unsent draft must survive polling'])
  await expect
    .poll(() =>
      viewport.evaluate(
        (element) => element.scrollHeight - element.scrollTop - element.clientHeight
      )
    )
    .toBeLessThanOrEqual(1)

  const bottomGapsDuringToolUpdate = viewport.evaluate(
    (element) =>
      new Promise<number[]>((resolve, reject) => {
        const gaps: number[] = []
        let frameCount = 0
        const sample = () => {
          frameCount += 1
          if (element.querySelector('[data-test-id="ai-tool-group"]')) {
            gaps.push(element.scrollHeight - element.scrollTop - element.clientHeight)
            if (gaps.length === 6) {
              resolve(gaps)
              return
            }
          }
          if (frameCount > 600) {
            reject(new Error('Timed out waiting for the tool activity update'))
            return
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
  )
  toolAdded = true
  await expect.poll(() => fullRequests, { timeout: 5_000 }).toBe(3)
  expect(Math.max(...(await bottomGapsDuringToolUpdate))).toBeLessThanOrEqual(1)
  await expect(workerSurface).toHaveAttribute('data-residency-probe', 'surface')
  await expect(oldestMessage).toHaveAttribute('data-residency-probe', 'message')
})
