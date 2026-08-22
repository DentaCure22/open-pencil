import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

test('keeps the selected patient iframe resident while the document is hidden', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), frameId)
  const iframe = surface.getByTestId('smylr-trusted-web-app-frame')
  const smylr = editor.page.frameLocator('[data-test-id="smylr-trusted-web-app-frame"]')
  await expect(smylr.locator('[data-smylr-program-shell="browser"]')).toBeVisible({
    timeout: 20_000
  })
  await editor.page
    .getByTestId(`code-object-overlay-${frameId}`)
    .getByTestId('code-object-design-hit-target')
    .click()
  await expect(surface).toHaveAttribute('data-code-object-mode', 'interact')
  const runtimeInstanceId = await iframe.getAttribute('data-runtime-instance-id')
  if (!runtimeInstanceId) throw new Error('Smylr runtime identity unavailable')

  await smylr.locator('html').evaluate((element) => {
    element.dataset.openPencilPatientSession = 'patient-42'
  })

  const currentTheme = await editor.page.locator('html').getAttribute('data-theme')
  await editor.page.getByTestId('app-menu-toggle').click()
  await editor.page
    .getByTestId(currentTheme === 'dark' ? 'settings-theme-light' : 'settings-theme-dark')
    .click()
  await expect(iframe).toHaveAttribute('data-runtime-instance-id', runtimeInstanceId)
  await expect(smylr.locator('html')).toHaveAttribute(
    'data-open-pencil-patient-session',
    'patient-42'
  )

  await editor.page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(iframe).toHaveCount(1)
  await expect(iframe).toHaveAttribute('data-runtime-instance-id', runtimeInstanceId)
  await expect(smylr.locator('html')).toHaveAttribute(
    'data-open-pencil-patient-session',
    'patient-42'
  )

  await editor.page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(iframe).toHaveAttribute('data-runtime-instance-id', runtimeInstanceId)
  await expect(smylr.locator('html')).toHaveAttribute(
    'data-open-pencil-patient-session',
    'patient-42'
  )
})
