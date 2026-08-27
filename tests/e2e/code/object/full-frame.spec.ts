import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

test('opens a trusted iframe in Full Frame without replacing its runtime', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), frameId)
  const iframe = surface.getByTestId('smylr-trusted-web-app-frame')
  await expect(iframe).toBeVisible({ timeout: 20_000 })
  const runtimeInstanceId = await iframe.getAttribute('data-runtime-instance-id')
  if (!runtimeInstanceId) throw new Error('Smylr runtime identity unavailable')

  await editor.page.getByTestId('selection-context-trigger').hover()
  await editor.page.getByTestId('code-object-full-frame').click()

  await expect(surface).toHaveAttribute('data-code-object-full-frame', 'true')
  await expect(surface).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(iframe).toHaveAttribute('data-runtime-instance-id', runtimeInstanceId)
  await expect
    .poll(async () => {
      const [canvas, fullFrame] = await Promise.all([
        editor.page.getByTestId('canvas-area').boundingBox(),
        surface.boundingBox()
      ])
      return canvas && fullFrame
        ? {
            height: Math.round(fullFrame.height - canvas.height),
            width: Math.round(fullFrame.width - canvas.width),
            x: Math.round(fullFrame.x - canvas.x),
            y: Math.round(fullFrame.y - canvas.y)
          }
        : null
    })
    .toEqual({ height: 0, width: 0, x: 0, y: 0 })

  const shell = editor.page.getByTestId('layers-shell-motion')
  const toolbar = editor.page.getByTestId('toolbar-motion')
  const sidebarToggle = editor.page.getByTestId('sidebar-toggle-motion')
  const expandedShellBounds = await shell.boundingBox()
  if (!expandedShellBounds) throw new Error('Expanded sidebar shell bounds unavailable')
  await expect(toolbar).toHaveAttribute('data-sidebar-integrated', 'false')
  await expect(sidebarToggle).toHaveAttribute('data-sidebar-integrated', 'true')
  await editor.page.getByTestId('close-layers-panel').click()
  await expect(shell).toHaveAttribute('data-sidebar-open', 'false')
  await expect(shell).toHaveAttribute('data-full-frame', 'true')
  await expect(sidebarToggle).toHaveAttribute('data-sidebar-tab-only', 'true')
  await expect(editor.page.getByRole('button', { name: 'Move', exact: true })).toBeVisible()
  await expect(editor.page.getByTestId('open-layers-panel')).toBeVisible()
  await expect(shell).toHaveCSS('opacity', '0')
  const collapsedShellBounds = await shell.boundingBox()
  if (!collapsedShellBounds) throw new Error('Collapsed sidebar shell bounds unavailable')
  expect(Math.abs(collapsedShellBounds.height - expandedShellBounds.height)).toBeLessThan(2)
  expect(Math.abs(collapsedShellBounds.width - expandedShellBounds.width)).toBeLessThan(2)
  expect(collapsedShellBounds.x + collapsedShellBounds.width).toBeLessThanOrEqual(0)
  await expect(editor.page.getByTestId('sidebar-compact-tab-drag-handle')).toHaveCount(0)
  await expect(editor.page.getByRole('toolbar', { name: 'Sidebar' })).toBeVisible()

  await editor.page.getByTestId('open-layers-panel').click()
  await expect(shell).toHaveAttribute('data-sidebar-open', 'true')
  await expect(sidebarToggle).toHaveAttribute('data-sidebar-tab-only', 'true')
  await editor.page.getByTestId('selection-context-trigger').hover()
  await editor.page.getByTestId('code-object-full-frame').click()

  await expect(surface).toHaveAttribute('data-code-object-full-frame', 'false')
  await expect(surface).toHaveAttribute('data-code-object-mode', 'design')
  await expect(iframe).toHaveAttribute('data-runtime-instance-id', runtimeInstanceId)
  await expect
    .poll(async () => {
      const [canvas, restored] = await Promise.all([
        editor.page.getByTestId('canvas-area').boundingBox(),
        surface.boundingBox()
      ])
      return canvas && restored
        ? restored.width < canvas.width && restored.height < canvas.height
        : false
    })
    .toBe(true)

  await editor.page.getByTestId('selection-context-trigger').hover()
  await editor.page.getByTestId('code-object-full-frame').click()
  await expect(surface).toHaveAttribute('data-code-object-full-frame', 'true')
  await editor.page.keyboard.press('Escape')
  await expect(surface).toHaveAttribute('data-code-object-full-frame', 'false')
  await expect(surface).toHaveAttribute('data-code-object-mode', 'design')
  await expect(iframe).toHaveAttribute('data-runtime-instance-id', runtimeInstanceId)
})
