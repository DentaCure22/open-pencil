import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

async function setDocumentHidden(hidden: boolean) {
  await editor.page.evaluate((nextHidden) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: nextHidden })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
}

test('pauses the running Experience when its Board runtimes are inactive', async () => {
  await editor.page.getByTestId('code-object-start').click()
  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.locator('[data-asset-group="board-experiences"]').click()
  await editor.page.getByTestId('board-experience-asset-tower-defense').click()

  const controls = editor.page.getByLabel('Tower defense controls. Double-click to interact.', {
    exact: true
  })
  await controls.dblclick()
  await editor.page.getByRole('button', { name: 'Start wave', exact: true }).click()

  const runtime = editor.page.getByTestId('board-experience-runtime')
  await expect(runtime).toHaveAttribute('data-board-experience-runtime-active', 'true')
  await setDocumentHidden(true)
  await expect(runtime).toHaveAttribute('data-board-experience-runtime-active', 'false')
  await expect(editor.page.locator('[data-code-object-root]')).toHaveCount(0)

  await setDocumentHidden(false)
  await expect(runtime).toHaveAttribute('data-board-experience-runtime-active', 'true')
})
