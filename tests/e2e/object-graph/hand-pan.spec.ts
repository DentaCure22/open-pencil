import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import {
  connectTestObjectGraphNodes,
  createTestCodeObject,
  createTestRectangle
} from '#tests/helpers/object-graph'

const editor = useEditorSetupWithClear('/?test&no-rulers')

test('lets the Hand tool pan the Board when a drag starts over a Code Object', async () => {
  const codeObjectId = await createTestCodeObject(editor.page, 'Hand pan endpoint', 260, 240)
  const nativeId = await createTestRectangle(editor.page, 'Hand pan target', 820, 300, {
    b: 0.48,
    g: 0.72,
    r: 0.12
  })
  await connectTestObjectGraphNodes(editor.page, codeObjectId, nativeId)
  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([id])
    store.setTool('HAND')
  }, codeObjectId)

  const surface = editor.page.getByTestId(`code-object-${codeObjectId}`)
  const sourceHandle = editor.page
    .getByTestId(`react-flow-node-${codeObjectId}`)
    .locator('[data-handleid="port:right"]')
  const surfaceBox = await surface.boundingBox()
  const sourceHandleBox = await sourceHandle.boundingBox()
  if (!surfaceBox || !sourceHandleBox) {
    throw new Error('Code Object or connector handle is unavailable for Hand pan')
  }
  expect(
    Math.abs(sourceHandleBox.x + sourceHandleBox.width / 2 - (surfaceBox.x + surfaceBox.width))
  ).toBeLessThan(7)
  expect(
    Math.abs(
      sourceHandleBox.y + sourceHandleBox.height / 2 - (surfaceBox.y + surfaceBox.height / 2)
    )
  ).toBeLessThan(1)
  const before = await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    if (!store || !node) throw new Error('OpenPencil Code Object is unavailable')
    return {
      node: { x: node.x, y: node.y },
      viewport: { panX: store.state.panX, panY: store.state.panY }
    }
  }, codeObjectId)

  const start = {
    x: surfaceBox.x + surfaceBox.width / 2,
    y: surfaceBox.y + surfaceBox.height / 2
  }
  await editor.page.mouse.move(start.x, start.y)
  await editor.page.mouse.down()
  await editor.page.mouse.move(start.x + 96, start.y + 64, { steps: 8 })
  await editor.page.mouse.up()

  const [surfaceAfterPan, sourceHandleAfterPan] = await Promise.all([
    surface.boundingBox(),
    sourceHandle.boundingBox()
  ])
  if (!surfaceAfterPan || !sourceHandleAfterPan) {
    throw new Error('Code Object or connector handle disappeared after Hand pan')
  }

  const after = await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    if (!store || !node) throw new Error('OpenPencil Code Object is unavailable')
    store.setTool('SELECT')
    return {
      node: { x: node.x, y: node.y },
      viewport: { panX: store.state.panX, panY: store.state.panY }
    }
  }, codeObjectId)

  expect(after.node).toEqual(before.node)
  expect(Math.abs(after.viewport.panX - before.viewport.panX)).toBeGreaterThan(80)
  expect(Math.abs(after.viewport.panY - before.viewport.panY)).toBeGreaterThan(48)
  expect(
    Math.abs(
      sourceHandleAfterPan.x +
        sourceHandleAfterPan.width / 2 -
        (surfaceAfterPan.x + surfaceAfterPan.width)
    )
  ).toBeLessThan(7)
  expect(
    Math.abs(
      sourceHandleAfterPan.y +
        sourceHandleAfterPan.height / 2 -
        (surfaceAfterPan.y + surfaceAfterPan.height / 2)
    )
  ).toBeLessThan(1)
})
