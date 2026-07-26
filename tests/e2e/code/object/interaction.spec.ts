import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('treats an authored TSX Code Object like a normal canvas shape', async () => {
  await editor.page.getByTestId('code-object-start').click()

  const runtime = editor.page.locator('[data-code-object-root]')
  const wrapper = editor.page.locator('[data-code-object-mode]')
  await expect(runtime).toHaveCount(1)
  await expect(runtime.getByRole('heading', { name: 'One TSX object' })).toBeVisible()
  await expect(editor.page.locator('iframe')).toHaveCount(0)
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.getByTestId('code-object-header')).toHaveCount(1)
  await expect(editor.page.getByTestId('code-object-header-title')).toHaveText('Code Object')
  await expect(editor.page.getByTestId('code-object-mode-design')).toHaveCount(0)
  await expect(editor.page.getByTestId('code-object-mode-interact')).toHaveCount(0)
  await expect(editor.page.getByTestId('code-object-copy')).toHaveCount(0)
  await expect(editor.page.getByTestId('code-object-duplicate')).toBeVisible()

  await editor.page.evaluate(() => {
    const windowWithRuntime = window as typeof window & { codeObjectRootIdentity?: Element }
    windowWithRuntime.codeObjectRootIdentity =
      document.querySelector('[data-code-object-root]') ?? undefined
  })

  const designTarget = editor.page.getByTestId('code-object-design-hit-target')
  const beforeMove = await wrapper.boundingBox()
  if (!beforeMove) throw new Error('Code Object bounds unavailable')
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const [frameId] = store ? [...store.state.selectedIds] : []
    const frame = frameId ? store?.graph.getNode(frameId) : null
    if (!store || !frame) throw new Error('Selected Code Object unavailable')
    store.updateNodeWithUndo(
      frame.id,
      { x: frame.x - 72 / store.state.zoom, y: frame.y - 36 / store.state.zoom },
      'Move Code Object in browser proof'
    )
  })

  const afterMove = await wrapper.boundingBox()
  expect(afterMove?.x).toBeCloseTo(beforeMove.x - 72, 0)
  expect(afterMove?.y).toBeCloseTo(beforeMove.y - 36, 0)

  const beforeResize = await wrapper.boundingBox()
  if (!beforeResize) throw new Error('Code Object resize bounds unavailable')
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const [frameId] = store ? [...store.state.selectedIds] : []
    const frame = frameId ? store?.graph.getNode(frameId) : null
    if (!store || !frame) throw new Error('Selected Code Object unavailable')
    store.updateNodeWithUndo(
      frame.id,
      {
        height: frame.height + 36 / store.state.zoom,
        width: frame.width + 64 / store.state.zoom
      },
      'Resize Code Object in browser proof'
    )
  })
  const afterResize = await wrapper.boundingBox()
  expect(afterResize?.width).toBeGreaterThan(beforeResize.width + 55)
  expect(afterResize?.height).toBeGreaterThan(beforeResize.height + 27)

  await designTarget.dblclick()
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await runtime.getByRole('button', { name: 'Increment' }).click()
  await expect(runtime.getByText('1', { exact: true })).toBeVisible()
  await expect(runtime.getByText('2', { exact: true })).toBeVisible()

  await editor.page.keyboard.press('Escape')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
  await editor.page.keyboard.press('Meta+z')
  await expect(runtime.getByText('0', { exact: true })).toHaveCount(2)
  await editor.page.keyboard.press('Meta+Shift+z')
  await expect(runtime.getByText('1', { exact: true })).toBeVisible()
  expect(
    await editor.page.evaluate(() => {
      const windowWithRuntime = window as typeof window & { codeObjectRootIdentity?: Element }
      return (
        windowWithRuntime.codeObjectRootIdentity ===
        document.querySelector('[data-code-object-root]')
      )
    })
  ).toBe(true)

  await editor.page.getByRole('treeitem', { name: 'Code Object' }).click()
  await editor.page.getByRole('tab', { name: 'Code' }).click()
  await editor.page
    .getByRole('textbox', { name: 'Properties' })
    .fill('{"title":"Edited on the board"}')
  await editor.page.getByRole('textbox', { name: 'Name' }).fill('Edited Code Object')
  await editor.page.getByRole('button', { name: 'Apply' }).click()
  await expect(runtime.getByRole('heading', { name: 'Edited on the board' })).toBeVisible()
  await expect(editor.page.getByRole('treeitem', { name: 'Edited Code Object' })).toBeVisible()

  await editor.page.keyboard.press('Enter')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await editor.page.keyboard.press('Escape')

  await editor.page.keyboard.press('Meta+d')
  await expect(editor.page.locator('[data-code-object-root]')).toHaveCount(2)
  await expect(editor.page.locator('iframe')).toHaveCount(0)
})
