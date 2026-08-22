import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { createTestCodeObject } from '#tests/helpers/code-object'

const editor = useEditorSetup('/?test&html-source')

test('defaults to native design tools without HTML onboarding', async () => {
  await editor.canvas.drawRect(420, 120, 200, 150)
  await editor.canvas.waitForRender()

  await expect(editor.page.getByTestId('html-first-canvas-welcome')).toHaveCount(0)
  await expect(editor.page.getByTestId('code-panel-empty')).toHaveCount(0)
  await expect(editor.page.getByTestId('left-panel-trace-tab')).toContainText('ACTIVITY')
})

test('keeps the archived Design inspector closed for a native canvas object', async () => {
  await editor.canvas.drawRect(420, 120, 200, 150)
  await editor.canvas.waitForRender()

  await expect(editor.page.getByTestId('design-panel-single')).toHaveCount(0)
})

test('keeps the full sidebar on utilities for a Code Object selection', async () => {
  const frameId = await createTestCodeObject(editor.page, 'Sidebar context test', 500, 100)
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), frameId)

  await expect(editor.page.getByTestId('left-panel-utility-area')).toBeVisible()
})
