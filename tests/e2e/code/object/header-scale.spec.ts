import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { createTestCodeObject } from '#tests/helpers/object-graph'

const editor = useEditorSetupWithClear('/?test&no-rulers')

async function headerBounds() {
  const bounds = await editor.page.getByTestId('code-object-header').boundingBox()
  if (!bounds) throw new Error('Code Object header is unavailable')
  return bounds
}

async function frameBounds(frameId: string) {
  const bounds = await editor.page.getByTestId(`code-object-${frameId}`).boundingBox()
  if (!bounds) throw new Error('Code Object frame is unavailable')
  return bounds
}

test('scales shared Code Object chrome from its container dimensions through camera zoom', async () => {
  const frameId = await createTestCodeObject(editor.page, 'Scaled header', 420, 320)
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), frameId)

  const header = editor.page.getByTestId('code-object-header')
  const headerScaleOwner = editor.page
    .getByTestId(`code-object-header-owner-${frameId}`)
    .locator('[data-object-scale]')
  const initialBounds = await headerBounds()
  const initialFrameBounds = await frameBounds(frameId)
  const initialWidthRatio = initialBounds.width / initialFrameBounds.width
  const initialScale = Number(await headerScaleOwner.getAttribute('data-object-scale'))
  expect(initialWidthRatio).toBeCloseTo(0.78, 1)
  expect(initialScale).toBeCloseTo(1.07, 2)

  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.updateNode(id, { height: 900, width: 1440 })
  }, frameId)
  await expect
    .poll(async () => Number(await headerScaleOwner.getAttribute('data-object-scale')))
    .toBeCloseTo(2.61, 2)

  const wideHeaderBounds = await headerBounds()
  expect(wideHeaderBounds.width).toBeGreaterThan(initialBounds.width * 2.35)
  expect(wideHeaderBounds.width / 2.61).toBeCloseTo(initialBounds.width / initialScale, 0)
  expect(await header.screenshot()).toMatchSnapshot('code-object-header-size-scaled.png')
  const wideFrameBounds = await frameBounds(frameId)
  const wideWidthRatio = wideHeaderBounds.width / wideFrameBounds.width

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 40, panY: 60, zoom: 0.5 })
  })
  await expect
    .poll(async () => {
      const [headerBox, frameBox] = await Promise.all([headerBounds(), frameBounds(frameId)])
      return headerBox.width / frameBox.width
    })
    .toBeCloseTo(wideWidthRatio, 2)
  expect(await editor.page.getByTestId('canvas-area').screenshot()).toMatchSnapshot(
    'code-object-header-relative-to-large-container.png'
  )

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 40, panY: 60, zoom: 1.5 })
  })
  await expect
    .poll(async () => {
      const [headerBox, frameBox] = await Promise.all([headerBounds(), frameBounds(frameId)])
      return headerBox.width / frameBox.width
    })
    .toBeCloseTo(wideWidthRatio, 2)
})
