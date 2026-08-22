import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { toolbarToolTestId } from '#tests/helpers/test-ids'

const editor = useEditorSetup('/?blank')

test('shows a stable start canvas on a normal empty OpenPencil board', async () => {
  await expect(editor.page.getByTestId('empty-board-start')).toBeVisible()
  const canvasArea = editor.page.getByTestId('canvas-area')
  await expect(canvasArea).toBeVisible()
  await expect(canvasArea).toHaveCSS('background-image', /radial-gradient/)
  await expect(canvasArea).toHaveCSS('background-size', /px/)
  await expect(editor.page.getByTestId('animated-dither-background')).toHaveCount(0)
  await expect(editor.page.getByTestId('layers-shell')).toHaveCount(0)
  await expect(editor.page.getByTestId('toolbar')).toHaveCount(0)
})

test('reveals native tools without creating a placeholder object', async () => {
  await editor.page.getByTestId('native-board-start').click()

  await expect(editor.page.getByTestId('empty-board-start')).toBeHidden()
  await expect(editor.page.getByTestId('layers-shell')).toBeVisible()
  await expect(editor.page.getByTestId('toolbar')).toBeVisible()
  await expect(editor.page.getByTestId(toolbarToolTestId('RECTANGLE'))).toBeVisible()
  await expect(editor.page.getByTestId('layers-item')).toHaveCount(0)
})

test('restores the editor chrome after creating the first Code Object', async () => {
  await editor.page.getByTestId('code-object-start').click()

  await expect(editor.page.locator('[data-code-object-root]')).toBeVisible()
  await expect(editor.page.getByTestId('empty-board-start')).toBeHidden()
  await expect(editor.page.getByTestId('layers-shell')).toBeVisible()
  await expect(editor.page.getByTestId('toolbar')).toBeVisible()
  await expect(editor.page.getByTestId('workspace-toolbar-button')).toBeVisible()
})
