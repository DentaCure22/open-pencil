import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('disposes a deleted Code Object runtime and restores its frame cleanly through Undo', async () => {
  await editor.page.getByTestId('code-object-start').click()

  const runtime = editor.page.locator('[data-code-object-root]')
  const wrapper = editor.page.locator('[data-code-object-mode]')
  await expect(runtime).toHaveCount(1)
  const frameId = await runtime.getAttribute('data-code-object-root')
  expect(frameId).toBeTruthy()

  await editor.page.keyboard.press('Delete')
  await expect(runtime).toHaveCount(0)
  await expect(wrapper).toHaveCount(0)

  await editor.page.keyboard.press('Meta+z')
  await expect(runtime).toHaveCount(1)
  await expect(runtime).toHaveAttribute('data-code-object-root', frameId ?? '')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.locator('iframe')).toHaveCount(0)

  await editor.page.keyboard.press('Enter')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await editor.page.keyboard.press('Escape')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
})
