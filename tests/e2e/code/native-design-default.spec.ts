import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test')

test('defaults to native design tools without HTML onboarding', async () => {
  await expect(editor.page.getByTestId('html-first-canvas-welcome')).toHaveCount(0)
  await expect(editor.page.getByTestId('sidebar-context-code')).toHaveCount(0)
  await expect(editor.page.getByTestId('code-panel-empty')).toHaveCount(0)
  await expect(editor.page.getByTestId('left-panel-trace-tab')).toContainText('TRACE')
})

test('opens the native design inspector for a selected canvas object', async () => {
  await editor.canvas.drawRect(420, 120, 200, 150)
  await editor.canvas.waitForRender()

  await expect(editor.page.getByTestId('design-panel-single')).toBeVisible()
  await expect(editor.page.getByTestId('design-node-type')).toContainText('RECTANGLE')
  await expect(editor.page.getByTestId('sidebar-context-code')).toHaveCount(0)
})
