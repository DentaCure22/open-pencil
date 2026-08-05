import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

test('keeps one selected Code Object header through direct interaction and deselection', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')
  const smylr = editor.page.frameLocator(
    `[data-code-object-id="${frameId}"] [data-test-id="smylr-trusted-web-app-frame"]`
  )
  await expect(smylr.locator('[data-smylr-program-shell="browser"]')).toBeVisible({
    timeout: 20_000
  })
  const designTarget = editor.page
    .getByTestId(`code-object-overlay-${frameId}`)
    .getByTestId('code-object-design-hit-target')

  await expect(editor.page.getByTestId('smylr-live-app-loading')).toHaveCount(0)
  await editor.page.evaluate(() => window.openPencil?.getStore?.().clearSelection())
  await expect(surface).toHaveAttribute('data-code-object-mode', 'design')
  await expect(designTarget).toBeVisible()

  const targetBounds = await designTarget.boundingBox()
  if (!targetBounds) throw new Error('Smylr Code Object design target unavailable')
  await editor.page.mouse.move(
    targetBounds.x + targetBounds.width / 2,
    targetBounds.y + targetBounds.height / 2
  )
  await editor.page.mouse.down()
  await expect(editor.page.getByTestId(`code-object-controls-${frameId}`)).toHaveCount(0)
  await editor.page.mouse.up()
  await expect(editor.page.getByTestId(`code-object-controls-${frameId}`)).toHaveCount(0)

  await expect(surface).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(editor.page.getByTestId('code-object-header')).toHaveCount(1)
  await expect(editor.page.getByTestId('code-object-header')).toHaveAttribute(
    'data-code-object-header-mode',
    'interact'
  )
  await expect(editor.page.getByTestId(`code-object-controls-${frameId}`)).toHaveCount(0)

  await editor.page.keyboard.press('Escape')
  await expect(surface).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.getByTestId('code-object-header')).toHaveAttribute(
    'data-code-object-header-mode',
    'design'
  )
  await expect(editor.page.getByTestId(`code-object-controls-${frameId}`)).toBeVisible()

  await editor.page.evaluate(() => window.openPencil?.getStore?.().clearSelection())
  await expect(editor.page.getByTestId('code-object-header')).toHaveCount(0)
})
