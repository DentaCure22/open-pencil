import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('HTML Board header matches live-frame chrome and exposes mode state', async () => {
  await editor.page.getByTestId('html-first-canvas-start').click()

  const header = editor.page.getByTestId('html-board-frame-header')
  await expect(header).toBeVisible()
  await expect(header).toHaveClass(/smylr-live-frame-header/)
  await expect(header.getByText('HTML', { exact: true })).toBeVisible()
  await expect(header).toContainText('HTML Board')
  await expect(header).not.toContainText('Production')
  expect(await header.locator('[aria-label^="Revision "]').count()).toBe(0)
  await expect(header.getByRole('group', { name: 'HTML board mode' })).toBeVisible()

  const metrics = await header.evaluate((element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return {
      borderRadius: style.borderRadius,
      gap: style.gap,
      height: rect.height,
      padding: style.padding
    }
  })
  expect(metrics).toMatchObject({ borderRadius: '6px', gap: '2px', padding: '2px 4px' })
  expect(metrics.height).toBeGreaterThanOrEqual(24)

  const design = editor.page.getByTestId('html-board-mode-design')
  const inspect = editor.page.getByTestId('html-board-mode-inspect')
  const interact = editor.page.getByTestId('html-board-mode-interact')
  await expect(design).toHaveAttribute('aria-pressed', 'true')

  await inspect.click()
  await expect(design).toHaveAttribute('aria-pressed', 'false')
  await expect(inspect).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.page.getByTestId('html-board-frame')).toHaveAttribute(
    'name',
    'openpencil-inspect'
  )

  await interact.click()
  await expect(interact).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.page.getByTestId('html-board-frame')).toHaveAttribute(
    'name',
    'openpencil-interact'
  )

  const frame = editor.page.frameLocator('[data-test-id="html-board-frame"]')
  const action = frame.getByRole('button', { name: 'Reserve a seat' })
  await expect(action).toBeVisible()
  await action.click()
  await expect(frame.getByRole('button', { name: 'Seat reserved' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('pinch-style wheel zooms the board while the pointer is over interactive HTML', async () => {
  await editor.page.getByTestId('html-first-canvas-start').click()
  await editor.page.getByTestId('html-board-mode-interact').click()

  const frame = editor.page.frameLocator('[data-test-id="html-board-frame"]')
  await frame.locator('body').hover()
  const before = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.zoom
  })

  await editor.page.keyboard.down('Control')
  await editor.page.mouse.wheel(0, 100)
  await editor.page.keyboard.up('Control')

  await expect
    .poll(async () => {
      return editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return store.state.zoom
      })
    })
    .toBeLessThan(before)
})
