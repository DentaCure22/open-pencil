import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test')

type BoardCameraSnapshot = {
  focusX: number
  focusY: number
  frameCenterX: number
  frameCenterY: number
  usableCenterX: number
  usableCenterY: number
  zoom: number
}

function boardCameraSnapshot(frameId: string): Promise<BoardCameraSnapshot> {
  return editor.page.evaluate(async (id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = store.graph.getNode(id)
    if (!frame) throw new Error('Camera target frame not found')
    const canvas = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
    if (!canvas) throw new Error('Editor canvas not initialized')

    const canvasRect = canvas.getBoundingClientRect()
    const { editorViewportInsets } = await import('/src/app/editor/viewport-insets.ts')
    const { bottom = 0, left = 0, right = 0, top = 0 } = editorViewportInsets()
    const usableCenterX = left + (canvasRect.width - left - right) / 2
    const usableCenterY = top + (canvasRect.height - top - bottom) / 2
    const absolute = store.graph.getAbsolutePosition(frame.id)

    return {
      focusX: (usableCenterX - store.state.panX) / store.state.zoom,
      focusY: (usableCenterY - store.state.panY) / store.state.zoom,
      frameCenterX: store.state.panX + (absolute.x + frame.width / 2) * store.state.zoom,
      frameCenterY: store.state.panY + (absolute.y + frame.height / 2) * store.state.zoom,
      usableCenterX,
      usableCenterY,
      zoom: store.state.zoom
    }
  }, frameId)
}

async function switchBoard(name: string) {
  await editor.page.getByTestId('workspace-toolbar-button').click()
  const browser = editor.page.getByTestId('board-project-browser')
  const search = browser.getByTestId('board-switcher-search')
  await search.fill(name)
  await browser.getByTestId('board-switcher-board-row').filter({ hasText: name }).first().click()
}

test('board switching fits first visits and preserves the camera around the sidebar', async () => {
  const fixture = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { createSmylrProductionAppDocument, setCodeObjectDocument } =
      await import('/src/app/code-object/model.ts')
    const originalPageId = store.state.currentPageId
    const originalPageName = store.graph.getNode(originalPageId)?.name ?? 'Main board'
    const page = store.graph.addPage('Camera target')
    const frame = store.graph.createNode('FRAME', page.id, {
      name: 'Camera target frame',
      x: 180,
      y: 120,
      width: 960,
      height: 600
    })
    setCodeObjectDocument(
      store.graph,
      frame.id,
      createSmylrProductionAppDocument({ label: frame.name, route: '/camera-target' })
    )
    store.graph.createNode('FRAME', page.id, {
      name: 'Distant context frame',
      x: 1600,
      y: 120,
      width: 960,
      height: 600
    })
    store.requestRender()
    return { frameId: frame.id, originalPageId, originalPageName, targetPageId: page.id }
  })

  await switchBoard('Camera target')
  await editor.canvas.waitForRender()

  const fitted = await boardCameraSnapshot(fixture.frameId)
  expect(fitted.frameCenterX).toBeCloseTo(fitted.usableCenterX, 0)
  expect(fitted.frameCenterY).toBeCloseTo(fitted.usableCenterY, 0)

  const saved = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const canvas = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
    if (!canvas) throw new Error('Editor canvas not initialized')
    const canvasRect = canvas.getBoundingClientRect()
    const { editorViewportInsets } = await import('/src/app/editor/viewport-insets.ts')
    const { bottom = 0, left = 0, right = 0, top = 0 } = editorViewportInsets()
    const centerX = left + (canvasRect.width - left - right) / 2
    const centerY = top + (canvasRect.height - top - bottom) / 2

    store.setZoomAroundPoint(store.state.zoom * 1.25, centerX, centerY)
    store.pan(47, -31)
    return {
      focusX: (centerX - store.state.panX) / store.state.zoom,
      focusY: (centerY - store.state.panY) / store.state.zoom,
      zoom: store.state.zoom
    }
  })

  await switchBoard(fixture.originalPageName)
  await editor.canvas.waitForRender()
  await editor.page.getByRole('button', { name: 'Close sidebar', exact: true }).click()
  await expect
    .poll(async () => (await editor.page.getByTestId('canvas-chrome-area').boundingBox())?.x ?? 999)
    .toBeLessThan(30)

  await switchBoard('Camera target')
  await editor.canvas.waitForRender()

  const restored = await boardCameraSnapshot(fixture.frameId)
  expect(restored.zoom).toBeCloseTo(saved.zoom)
  expect(restored.focusX).toBeCloseTo(saved.focusX)
  expect(restored.focusY).toBeCloseTo(saved.focusY)
  editor.canvas.assertNoErrors()
})
