import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('connects two Code Objects and applies one board-owned undoable action', async () => {
  await editor.page.getByTestId('code-object-start').click()

  const runtimes = editor.page.locator('[data-code-object-root]')
  await expect(runtimes).toHaveCount(1)
  const controllerId = await runtimes.first().getAttribute('data-code-object-root')
  if (!controllerId) throw new Error('Controller Code Object ID unavailable')

  await editor.page.getByRole('tab', { name: 'Code' }).click()
  await editor.page.getByTestId('code-object-name').fill('Controller')
  await editor.page.getByTestId('code-object-apply').click()

  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.locator('[data-asset-group="interactive"]').click()
  await editor.page.getByTestId('code-object-asset-user-code').click()
  await expect(runtimes).toHaveCount(2)

  const targetId = await editor.page.evaluate((sourceId) => {
    const roots = [...document.querySelectorAll<HTMLElement>('[data-code-object-root]')]
    return roots.find((root) => root.dataset.codeObjectRoot !== sourceId)?.dataset.codeObjectRoot
  }, controllerId)
  if (!targetId) throw new Error('Target Code Object ID unavailable')

  await editor.page.getByRole('tab', { name: 'Code' }).click()
  await editor.page.getByTestId('code-object-name').fill('Target')
  await editor.page.getByTestId('code-object-apply').click()

  await editor.page.locator(`[data-node-id="${controllerId}"]`).getByTestId('layers-item').click()
  await editor.page.getByRole('tab', { name: 'Code' }).click()

  await editor.page.getByTestId('code-object-connection-target').click()
  await editor.page.getByRole('option', { name: 'Target' }).click()
  await editor.page.getByTestId('code-object-connect').click()
  await expect(editor.page.getByTestId('code-object-connections')).toContainText('Target')

  const controllerRuntime = editor.page.locator(`[data-code-object-root="${controllerId}"]`)
  const targetRuntime = editor.page.locator(`[data-code-object-root="${targetId}"]`)
  const controllerWrapper = editor.page
    .locator('[data-code-object-mode]')
    .filter({ has: controllerRuntime })

  await editor.page.keyboard.press('Enter')
  await expect(controllerWrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await controllerRuntime.getByRole('button', { name: 'Advance both with Target' }).click()

  await expect(controllerRuntime.getByText('1', { exact: true }).first()).toBeVisible()
  await expect(targetRuntime.getByText('1', { exact: true }).first()).toBeVisible()

  await editor.page.keyboard.press('Escape')
  await editor.page.keyboard.press('Meta+z')
  await expect(controllerRuntime.getByText('0', { exact: true }).first()).toBeVisible()
  await expect(targetRuntime.getByText('0', { exact: true }).first()).toBeVisible()

  await editor.page.keyboard.press('Meta+Shift+z')
  await expect(controllerRuntime.getByText('1', { exact: true }).first()).toBeVisible()
  await expect(targetRuntime.getByText('1', { exact: true }).first()).toBeVisible()
})
