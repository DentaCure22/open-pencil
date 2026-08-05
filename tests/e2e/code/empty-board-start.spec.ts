import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?blank')

test('shows a stable start canvas on a normal empty OpenPencil board', async () => {
  await expect(editor.page.getByTestId('empty-board-start')).toBeVisible()
  await expect(editor.page.getByTestId('canvas-area')).toBeVisible()
  await expect(editor.page.getByTestId('animated-dither-background')).toHaveCount(0)
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
