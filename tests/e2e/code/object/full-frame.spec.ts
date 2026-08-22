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
  await expect(toolbar).toHaveAttribute('data-sidebar-integrated', 'true')
  await editor.page.getByTestId('close-layers-panel').click()
  await expect(shell).toHaveAttribute('data-sidebar-open', 'false')
  await expect(shell).toHaveAttribute('data-full-frame', 'true')
  await expect(toolbar).toHaveAttribute('data-sidebar-tab-only', 'true')
  await expect(editor.page.getByRole('button', { name: 'Move', exact: true })).toHaveCount(0)
  await expect(editor.page.getByTestId('open-layers-panel')).toBeVisible()
  await expect
    .poll(async () => {
      const bounds = await shell.boundingBox()
      return bounds ? { height: Math.round(bounds.height), width: Math.round(bounds.width) } : null
    })
    .toEqual({ height: 44, width: 44 })

  const dragHandle = editor.page.getByTestId('sidebar-compact-tab-drag-handle')
  const [tabBeforeDrag, handleBounds] = await Promise.all([
    shell.boundingBox(),
    dragHandle.boundingBox()
  ])
  if (!tabBeforeDrag || !handleBounds) throw new Error('Compact sidebar tab bounds unavailable')
  const canvasBounds = await editor.page.getByTestId('canvas-area').boundingBox()
  if (!canvasBounds) throw new Error('Canvas bounds unavailable')
  const dragDelta = tabBeforeDrag.y > canvasBounds.y + canvasBounds.height / 2 ? -90 : 90
  await editor.page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2
  )
  await editor.page.mouse.down()
  await expect(shell).toHaveAttribute('data-compact-tab-dragging', 'true')
  await editor.page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2 + dragDelta,
    { steps: 6 }
  )
  await editor.page.mouse.up()
  await expect(shell).toHaveAttribute('data-compact-tab-dragging', 'false')
  await expect
    .poll(async () => {
      const moved = await shell.boundingBox()
      if (!moved) return null
      const deltaX = Math.round(moved.x - tabBeforeDrag.x)
      const deltaY = Math.round(moved.y - tabBeforeDrag.y)
      return {
        movedInRequestedDirection:
          Math.sign(deltaY) === Math.sign(dragDelta) && Math.abs(deltaY) >= 60,
        x: deltaX
      }
    })
    .toEqual({ movedInRequestedDirection: true, x: 0 })

  await editor.page.getByTestId('open-layers-panel').click()
  await expect(shell).toHaveAttribute('data-sidebar-open', 'true')
  await expect(toolbar).toHaveAttribute('data-sidebar-tab-only', 'false')
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
