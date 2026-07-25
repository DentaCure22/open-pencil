import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?blank')

test('shows the animated start canvas on a normal empty OpenPencil board', async () => {
  const dither = editor.page.getByTestId('animated-dither-background')
  const scene = editor.page.getByTestId('scene-canvas-element')
  await expect(editor.page.getByTestId('empty-board-start')).toBeVisible()
  await expect(dither).toBeVisible()
  await expect(dither).toHaveAttribute('data-presentation', 'surface')
  expect(
    await dither.evaluate((node) => Number.parseInt(getComputedStyle(node).zIndex, 10))
  ).toBeGreaterThan(
    await scene.evaluate((node) => Number.parseInt(getComputedStyle(node).zIndex, 10))
  )
  await expect(editor.page.getByTestId('layers-shell')).toHaveCount(0)
  await expect(editor.page.getByTestId('toolbar')).toHaveCount(0)
  await expect(editor.page.getByTestId('board-dock')).toHaveCount(0)
})

test('restores the editor chrome after creating the first Code Object', async () => {
  await editor.page.getByTestId('code-object-start').click()

  await expect(editor.page.locator('[data-code-object-root]')).toBeVisible()
  await expect(editor.page.getByTestId('empty-board-start')).toBeHidden()
  await expect(editor.page.getByTestId('layers-shell')).toBeVisible()
  await expect(editor.page.getByTestId('toolbar')).toBeVisible()
  await expect(editor.page.getByTestId('board-dock')).toBeVisible()
  await expect(editor.page.getByRole('tab', { name: 'Code' })).toBeVisible()
})
