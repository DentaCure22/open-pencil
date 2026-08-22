import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { readTestSelectedIds } from '#tests/helpers/code-object'

const editor = useEditorSetupWithClear('/?test&html-source')

test('treats an authored TSX Code Object like a normal canvas shape', async () => {
  await editor.page.getByTestId('code-object-start').click()

  const runtime = editor.page.locator('[data-code-object-root]')
  const wrapper = editor.page.locator('[data-code-object-mode]')
  await expect(runtime).toHaveCount(1)
  await expect(runtime.getByRole('heading', { name: 'One TSX object' })).toBeVisible()
  await expect(editor.page.locator('iframe')).toHaveCount(0)
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.getByTestId('selection-context-trigger')).toBeVisible()
  await expect(editor.page.getByTestId('selection-context-tools')).toHaveCount(0)
  await editor.page.getByTestId('selection-context-trigger').hover()
  await expect(editor.page.getByTestId('selection-context-tools')).toBeVisible()
  await expect(editor.page.getByTestId('code-object-duplicate')).toBeVisible()

  const designTarget = editor.page.getByTestId('code-object-design-hit-target')
  await editor.page.evaluate(() => window.openPencil?.getStore?.().clearSelection())
  await designTarget.click()
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await editor.page.keyboard.press('Escape')

  await editor.page.evaluate(() => {
    const windowWithRuntime = window as typeof window & { codeObjectRootIdentity?: Element }
    windowWithRuntime.codeObjectRootIdentity =
      document.querySelector('[data-code-object-root]') ?? undefined
  })

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

  await designTarget.click()
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(editor.page.getByTestId('selection-context-trigger')).toBeVisible()
  await expect(editor.page.getByTestId(/^code-object-controls-/)).toHaveCount(0)
  await runtime.getByRole('button', { name: 'Increment' }).click()
  await expect(runtime.getByText('1', { exact: true })).toBeVisible()
  await expect(runtime.getByText('2', { exact: true })).toBeVisible()

  const runtimeBox = await runtime.boundingBox()
  if (!runtimeBox) throw new Error('Code Object runtime bounds unavailable')
  const panBeforeSpace = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return { x: store.state.panX, y: store.state.panY }
  })
  await editor.page.keyboard.down('Space')
  await editor.page.mouse.move(
    runtimeBox.x + runtimeBox.width / 2,
    runtimeBox.y + runtimeBox.height / 2
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(
    runtimeBox.x + runtimeBox.width / 2 + 80,
    runtimeBox.y + runtimeBox.height / 2 + 45,
    { steps: 6 }
  )
  await editor.page.mouse.up()
  await editor.page.keyboard.up('Space')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return { x: store.state.panX, y: store.state.panY }
      })
    )
    .not.toEqual(panBeforeSpace)

  await editor.page.keyboard.press('Escape')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.getByTestId('selection-context-trigger')).toBeVisible()
  await expect(editor.page.getByTestId(/^code-object-controls-/)).toHaveCount(1)
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

  await editor.page.keyboard.press('Enter')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await editor.page.keyboard.press('Escape')

  await editor.page.keyboard.press('Meta+d')
  await expect(editor.page.locator('[data-code-object-root]')).toHaveCount(2)
  await expect(editor.page.locator('iframe')).toHaveCount(0)
})

test('uses Space+Arrow for Board navigation when selected or interacting', async () => {
  await editor.page.getByTestId('code-object-start').click()
  const target = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const [frameId] = store ? [...store.state.selectedIds] : []
    const frame = frameId ? store?.graph.getNode(frameId) : null
    if (!store || !frameId || !frame) throw new Error('Selected Code Object unavailable')
    const neighbor = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 120,
      name: 'Right neighbor',
      width: 160,
      x: frame.x + frame.width + 320,
      y: frame.y + frame.height / 2 - 60
    })
    const farNeighbor = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 120,
      name: 'Far right neighbor',
      width: 160,
      x: neighbor.x + neighbor.width + 320,
      y: neighbor.y
    })
    store.requestRender()
    return {
      farNeighborId: farNeighbor.id,
      frameId,
      neighborId: neighbor.id,
      zoom: store.state.zoom
    }
  })

  const wrapper = editor.page.locator(`[data-code-object-id="${target.frameId}"]`)
  await editor.page.keyboard.down('Space')
  await editor.page.keyboard.down('ArrowRight')
  await editor.page.keyboard.down('ArrowRight')
  await editor.page.keyboard.up('ArrowRight')
  await editor.page.keyboard.up('Space')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.neighborId])
  await expect.poll(() => readTestSelectedIds(editor.page)).not.toEqual([target.farNeighborId])

  await editor.page.keyboard.down('Space')
  await editor.page.keyboard.press('ArrowLeft')
  await editor.page.keyboard.up('Space')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.frameId])

  await editor.page.getByTestId('code-object-design-hit-target').click()
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')

  await editor.page.keyboard.press('ArrowRight')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.frameId])

  const focusedTextBox = editor.page.getByRole('textbox', { name: 'Filter layers' })
  await focusedTextBox.fill('Draft name')
  await editor.page.keyboard.down('Space')
  await editor.page.keyboard.press('ArrowRight')
  await editor.page.keyboard.up('Space')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.neighborId])
  await expect
    .poll(() => focusedTextBox.evaluate((element) => (element as HTMLInputElement).value))
    .toBe('Draft name')
  await focusedTextBox.press('Space')
  await expect
    .poll(() => focusedTextBox.evaluate((element) => (element as HTMLInputElement).value))
    .toBe('Draft name ')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect
    .poll(() => editor.page.evaluate(() => window.openPencil?.getStore?.().state.zoom))
    .toBe(target.zoom)
})
