import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test')

type ChromePositions = {
  canvas: number
  dock: number
  toolbarRight: number
}

function centerX(bounds: { width: number; x: number } | null) {
  expect(bounds).not.toBeNull()
  if (!bounds) throw new Error('Expected visible floating chrome bounds')
  return bounds.x + bounds.width / 2
}

async function chromePositions(): Promise<ChromePositions> {
  const [canvas, dock, toolbar] = await Promise.all([
    editor.page.getByTestId('canvas-chrome-area').boundingBox(),
    editor.page.getByTestId('board-dock').boundingBox(),
    editor.page.getByTestId('toolbar-motion').boundingBox()
  ])
  if (!canvas || !toolbar) throw new Error('Expected canvas and toolbar bounds')
  return {
    canvas: centerX(canvas),
    dock: centerX(dock),
    toolbarRight: canvas.x + canvas.width - toolbar.x - toolbar.width
  }
}

function expectDockCenteredWithRightAlignedTools(positions: ChromePositions) {
  expect(positions.dock).toBeCloseTo(positions.canvas, 0)
  expect(positions.toolbarRight).toBeCloseTo(12, 0)
}

test('top tools stay right aligned while the bottom dock follows the canvas center', async () => {
  const toolbar = editor.page.getByTestId('toolbar-motion')
  const dock = editor.page.getByTestId('board-dock')

  await expect(toolbar).toHaveAttribute('data-sidebar-open', 'true')
  await expect(dock).toHaveAttribute('data-sidebar-open', 'true')

  const open = await chromePositions()
  expectDockCenteredWithRightAlignedTools(open)

  await editor.page.getByTestId('close-layers-panel').dispatchEvent('click')
  await expect(toolbar).toHaveAttribute('data-sidebar-open', 'false')
  await expect(dock).toHaveAttribute('data-sidebar-open', 'false')
  await editor.page.waitForTimeout(70)

  const closing = await chromePositions()
  expectDockCenteredWithRightAlignedTools(closing)
  expect(closing.dock).toBeLessThan(open.dock - 1)

  await expect.poll(async () => (await chromePositions()).dock).toBeLessThan(closing.dock - 1)
  const closed = await chromePositions()
  expectDockCenteredWithRightAlignedTools(closed)

  const openButton = editor.page.getByTestId('open-layers-panel')
  await expect(openButton).toBeVisible()
  await openButton.dispatchEvent('click')
  await expect(toolbar).toHaveAttribute('data-sidebar-open', 'true')
  await expect(dock).toHaveAttribute('data-sidebar-open', 'true')
  await editor.page.waitForTimeout(70)

  const opening = await chromePositions()
  expectDockCenteredWithRightAlignedTools(opening)
  expect(opening.dock).toBeGreaterThan(closed.dock + 1)
  expect(opening.dock).toBeLessThan(open.dock - 1)

  await expect.poll(async () => (await chromePositions()).dock).toBeGreaterThan(opening.dock + 1)
  const reopened = await chromePositions()
  expectDockCenteredWithRightAlignedTools(reopened)
  expect(reopened.dock).toBeCloseTo(open.dock, 0)
  editor.canvas.assertNoErrors()
})
