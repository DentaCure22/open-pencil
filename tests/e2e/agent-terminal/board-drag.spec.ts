import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('clicking New task opens the sidebar draft without placing a Board card', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test&no-rulers')
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await page.getByTestId('left-panel-chats-tab').click()
  await page.getByTestId('agent-thread-new').click()
  await expect(page.getByTestId('agent-selected-conversation')).toBeVisible()
  await expect(page.locator('[data-code-object-id]')).toHaveCount(0)
})

test('starting New task inside the sidebar does not place a chat on the Board', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test&no-rulers')
  await canvas.waitForInit()
  await canvas.clearCanvas()
  await page.getByTestId('left-panel-chats-tab').click()
  const source = page.getByTestId('agent-thread-new')
  const sourceBox = await source.boundingBox()
  if (!sourceBox) throw new Error('New task bounds unavailable')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 - 10, sourceBox.y + sourceBox.height / 2, {
    steps: 4
  })
  await page.mouse.up()
  await expect(page.locator('[data-code-object-id]')).toHaveCount(0)
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
