import { expect, test, type Locator, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const AGENT_CONVERSATION_DRAG_TYPE = 'application/x-openpencil-agent-conversation'

async function startChatDrag(page: Page, source: Locator) {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await source.dispatchEvent('dragstart', { dataTransfer })
  await expect(page.getByTestId('agent-conversation-drag-preview')).toBeVisible()
  return { dataTransfer }
}

async function dropChatOnBoard(page: Page, source: Locator) {
  const { dataTransfer } = await startChatDrag(page, source)
  const payload = await dataTransfer.evaluate(
    (value, type) => value.getData(type),
    AGENT_CONVERSATION_DRAG_TYPE
  )
  expect(payload.length).toBeGreaterThan(0)
  await page.getByTestId('canvas-area').dispatchEvent('drop', { dataTransfer })
  await source.dispatchEvent('dragend', { dataTransfer })
}

test('dragging New task from CHATS places an agent card on the Board', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test&no-rulers')
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await page.getByTestId('left-panel-chats-tab').click()
  await dropChatOnBoard(page, page.getByTestId('agent-thread-new'))
  await expect(page.locator('[data-code-object-id]')).toHaveCount(1)
  await expect(page.getByTestId('agent-chat-board-surface')).toBeVisible()
})

test('a live New task mouse drag is accepted by the Board overlay', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test&no-rulers')
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await page.getByTestId('left-panel-chats-tab').click()
  const source = page.getByTestId('agent-thread-new')
  const canvasArea = page.getByTestId('canvas-area')
  const sourceBox = await source.boundingBox()
  const canvasBox = await canvasArea.boundingBox()
  if (!sourceBox || !canvasBox) throw new Error('Drag bounds unavailable')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + 540, canvasBox.y + 360, { steps: 20 })
  await expect(page.getByTestId('agent-conversation-drag-preview')).toBeVisible()
  await page.mouse.up()
  await expect(page.getByTestId('agent-conversation-drag-preview')).toHaveCount(0)
  await expect(page.locator('[data-code-object-id]')).toHaveCount(1)
  await expect(page.getByTestId('agent-chat-board-surface')).toBeVisible()
})
