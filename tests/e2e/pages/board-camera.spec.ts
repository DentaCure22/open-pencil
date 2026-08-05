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
  return editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = store.graph.getNode(id)
    if (!frame) throw new Error('Camera target frame not found')
    const canvas = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
    const layers = document.querySelector<HTMLElement>('[data-test-id="layers-shell"]')
    const toolbar = document.querySelector<HTMLElement>('[data-test-id="toolbar"]')
    const dock = document.querySelector<HTMLElement>('[data-test-id="board-dock"]')
    if (!canvas || !toolbar || !dock) throw new Error('Editor chrome not initialized')

    const canvasRect = canvas.getBoundingClientRect()
    const layersRect = layers?.getBoundingClientRect()
    const toolbarRect = toolbar.getBoundingClientRect()
    const dockRect = dock.getBoundingClientRect()
    const gap = 14
    const left = layersRect ? layersRect.right - canvasRect.left + gap : gap
    const right = gap
    const top = toolbarRect.bottom - canvasRect.top + gap
    const bottom = canvasRect.bottom - dockRect.top + gap
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

test('board switching fits first visits and preserves the camera around the sidebar', async () => {
  const fixture = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const originalPageId = store.state.currentPageId
    const page = store.graph.addPage('Camera target')
    const frame = store.graph.createNode('FRAME', page.id, {
      name: 'Camera target frame',
      x: 180,
      y: 120,
      width: 960,
      height: 600,
      pluginData: [
        { pluginId: 'smylr-production', key: 'kind', value: 'smylr-code-object-frame' },
        { pluginId: 'smylr-production', key: 'state', value: 'current' }
      ]
    })
    store.graph.createNode('FRAME', page.id, {
      name: 'Distant context frame',
      x: 1600,
      y: 120,
      width: 960,
      height: 600
    })
    store.requestRender()
    return { frameId: frame.id, originalPageId, targetPageId: page.id }
  })

  const targetBoard = editor.page.getByTestId(`board-dock-board-${fixture.targetPageId}`)
  await expect(targetBoard).toBeVisible()
  await targetBoard.dispatchEvent('click')
  await editor.canvas.waitForRender()

  const fitted = await boardCameraSnapshot(fixture.frameId)
  expect(fitted.frameCenterX).toBeCloseTo(fitted.usableCenterX, 0)
  expect(fitted.frameCenterY).toBeCloseTo(fitted.usableCenterY, 0)

  const saved = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const canvas = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
    const layers = document.querySelector<HTMLElement>('[data-test-id="layers-shell"]')
    const toolbar = document.querySelector<HTMLElement>('[data-test-id="toolbar"]')
    const dock = document.querySelector<HTMLElement>('[data-test-id="board-dock"]')
    if (!canvas || !layers || !toolbar || !dock) throw new Error('Editor chrome not initialized')
    const canvasRect = canvas.getBoundingClientRect()
    const layersRect = layers.getBoundingClientRect()
    const toolbarRect = toolbar.getBoundingClientRect()
    const dockRect = dock.getBoundingClientRect()
    const gap = 14
    const centerX =
      layersRect.right -
      canvasRect.left +
      gap +
      (canvasRect.width - (layersRect.right - canvasRect.left + gap) - gap) / 2
    const top = toolbarRect.bottom - canvasRect.top + gap
    const bottom = canvasRect.bottom - dockRect.top + gap
    const centerY = top + (canvasRect.height - top - bottom) / 2

    store.setZoomAroundPoint(store.state.zoom * 1.25, centerX, centerY)
    store.pan(47, -31)
    return {
      focusX: (centerX - store.state.panX) / store.state.zoom,
      focusY: (centerY - store.state.panY) / store.state.zoom,
      zoom: store.state.zoom
    }
  })

  await editor.page.getByTestId(`board-dock-board-${fixture.originalPageId}`).dispatchEvent('click')
  await editor.canvas.waitForRender()
  await editor.page.getByRole('button', { name: 'Close sidebar', exact: true }).click()
  await expect
    .poll(async () => (await editor.page.getByTestId('canvas-chrome-area').boundingBox())?.x ?? 999)
    .toBeLessThan(30)

  await targetBoard.dispatchEvent('click')
  await editor.canvas.waitForRender()

  const restored = await boardCameraSnapshot(fixture.frameId)
  expect(restored.zoom).toBeCloseTo(saved.zoom)
  expect(restored.focusX).toBeCloseTo(saved.focusX)
  expect(restored.focusY).toBeCloseTo(saved.focusY)
  editor.canvas.assertNoErrors()
})
