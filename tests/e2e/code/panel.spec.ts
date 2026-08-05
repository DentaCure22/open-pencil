import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test')

test('keeps generated JSX out of the inspector for ordinary objects', async () => {
  await editor.canvas.drawRect(420, 120, 200, 150)
  await editor.canvas.waitForRender()

  await expect(editor.page.getByTestId('design-panel-single')).toBeVisible()
  await expect(editor.page.getByTestId('properties-tab-code')).toHaveCount(0)
  await expect(editor.page.getByTestId('sidebar-context-code')).toHaveCount(0)
  await expect(editor.page.getByText('Selection code')).toHaveCount(0)
  await expect(editor.page.getByTestId('code-panel')).toHaveCount(0)
})
