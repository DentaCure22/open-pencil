import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('keeps only relevant Code Object runtimes resident', async () => {
  await editor.page.getByTestId('code-object-start').click()
  await editor.page.getByTestId('left-panel-assets-tab').click()
  const interactiveFolder = editor.page.locator('[data-asset-group="interactive"]')
  await interactiveFolder.click()
  await editor.page.getByTestId('code-object-asset-orbit-lab').click()

  const frameIds = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const [visibleFrameId] = [...store.state.selectedIds]
    if (!visibleFrameId) throw new Error('Orbit lab was not selected')
    store.duplicateSelected()
    const [offscreenFrameId] = [...store.state.selectedIds]
    if (!offscreenFrameId || offscreenFrameId === visibleFrameId) {
      throw new Error('Orbit lab was not duplicated')
    }
    store.updateNode(offscreenFrameId, { x: 10_000, y: 10_000 })
    store.select([])
    store.requestRender()
    return { offscreenFrameId, visibleFrameId }
  })

  const visibleFrame = editor.page.getByTestId(`code-object-${frameIds.visibleFrameId}`)
  const offscreenFrame = editor.page.getByTestId(`code-object-${frameIds.offscreenFrameId}`)
  await expect(visibleFrame).toHaveAttribute('data-code-object-runtime-active', 'true')
  await expect(offscreenFrame).toHaveAttribute('data-code-object-runtime-active', 'false')
  await expect(visibleFrame.locator('[data-code-object-root]')).toHaveCount(1)
  await expect(offscreenFrame.locator('[data-code-object-root]')).toHaveCount(1)

  const idleRenderGenerations = await editor.page.evaluate(async (visibleFrameId) => {
    const { currentCodeObjectRuntimeRenderGeneration } =
      await import('/src/app/code-object/compiler.tsx')
    const before = currentCodeObjectRuntimeRenderGeneration(visibleFrameId)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 400)
    })
    return {
      after: currentCodeObjectRuntimeRenderGeneration(visibleFrameId),
      before
    }
  }, frameIds.visibleFrameId)
  expect(idleRenderGenerations.before).not.toBeNull()
  expect(idleRenderGenerations.after).toBe(idleRenderGenerations.before)

  await editor.page.evaluate((offscreenFrameId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.zoomToNode(offscreenFrameId)
  }, frameIds.offscreenFrameId)
  await expect(offscreenFrame).toHaveAttribute('data-code-object-runtime-active', 'true')
  await expect(visibleFrame).toHaveAttribute('data-code-object-runtime-active', 'false')
  await expect(offscreenFrame.locator('[data-code-object-root]')).toHaveCount(1)
  await expect(visibleFrame.locator('[data-code-object-root]')).toHaveCount(1)

  await editor.page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(editor.page.locator('[data-code-object-root]')).toHaveCount(2)

  await editor.page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(offscreenFrame).toHaveAttribute('data-code-object-runtime-active', 'true')
  await expect(offscreenFrame.locator('[data-code-object-root]')).toHaveCount(1)
})
