import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source&smylr-app=&smylr-page=dental-chart')

test('keeps the archived Design inspector closed for Smylr production frames', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([id])
  }, frameId)

  await expect(editor.page.getByTestId('design-panel-single')).toHaveCount(0)
  await expect(editor.page.getByTestId('left-panel-utility-area')).toBeVisible()
})
