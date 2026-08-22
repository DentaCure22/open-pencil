import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { createTestCodeObject } from '#tests/helpers/code-object'

const editor = useEditorSetupWithClear('/?test&no-rulers')

test('reveals selected Code Object actions from one centered rail icon', async () => {
  const frameId = await createTestCodeObject(editor.page, 'Context tools', 420, 320)
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), frameId)

  const trigger = editor.page.getByTestId('selection-context-trigger')
  await expect(trigger).toBeVisible()
  await expect(editor.page.getByTestId('selection-context-tools')).toHaveCount(0)

  await trigger.hover()
  await expect(editor.page.getByTestId('selection-context-tools')).toBeVisible()
  for (const preset of ['desktop', 'laptop', 'tablet', 'phone']) {
    await expect(editor.page.getByTestId(`code-object-viewport-${preset}`)).toBeVisible()
  }
  await expect(editor.page.getByTestId('code-object-duplicate')).toBeVisible()

  await editor.page.getByTestId('code-object-viewport-phone').click()
  await expect
    .poll(() =>
      editor.page.evaluate((id) => {
        const frame = window.openPencil?.getStore?.().graph.getNode(id)
        return frame ? { height: frame.height, width: frame.width } : null
      }, frameId)
    )
    .toEqual({ height: 844, width: 390 })
  await expect(editor.page.getByTestId('selection-context-tools')).toHaveCount(0)

  await editor.page.evaluate(() => window.openPencil?.getStore?.().clearSelection())
  await expect(trigger).toHaveCount(0)
})
