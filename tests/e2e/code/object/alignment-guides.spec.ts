import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { createTestCodeObject } from '#tests/helpers/object-graph'

const editor = useEditorSetupWithClear('/?test&no-rulers')

function framePosition(frameId: string) {
  return editor.page.evaluate((id) => {
    const frame = window.openPencil?.getStore?.().graph.getNode(id)
    return frame ? { x: frame.x, y: frame.y } : null
  }, frameId)
}

function snapGuides() {
  return editor.page.evaluate(() => window.openPencil?.getStore?.().state.snapGuides ?? [])
}

test('shows native alignment guides and snaps while moving a Code Object', async () => {
  const targetId = await createTestCodeObject(editor.page, 'Alignment target', 100, 100)
  const movingId = await createTestCodeObject(editor.page, 'Moving Code Object', 600, 100)
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), movingId)

  const targetSurface = editor.page.getByTestId(`code-object-${targetId}`)
  const movingSurface = editor.page.getByTestId(`code-object-${movingId}`)
  const moveTarget = editor.page
    .getByTestId(`code-object-overlay-${movingId}`)
    .getByTestId('code-object-design-hit-target')
  await expect(moveTarget).toBeVisible()

  const [targetBounds, movingBounds, moveTargetBounds, zoom] = await Promise.all([
    targetSurface.boundingBox(),
    movingSurface.boundingBox(),
    moveTarget.boundingBox(),
    editor.page.evaluate(() => window.openPencil?.getStore?.().state.zoom ?? 1)
  ])
  if (!targetBounds || !movingBounds || !moveTargetBounds) {
    throw new Error('Code Object alignment fixture is unavailable')
  }

  const start = {
    x: moveTargetBounds.x + moveTargetBounds.width / 2,
    y: moveTargetBounds.y + moveTargetBounds.height / 2
  }
  const nearAlignedLeft = targetBounds.x + targetBounds.width + 2 * zoom
  const moveX = start.x + nearAlignedLeft - movingBounds.x

  await editor.page.mouse.move(start.x, start.y)
  await editor.page.mouse.down()
  await editor.page.mouse.move(moveX, start.y, { steps: 8 })

  await expect.poll(async () => (await snapGuides()).some((guide) => guide.axis === 'x')).toBe(true)
  await expect.poll(() => framePosition(movingId)).toEqual({ x: 460, y: 100 })
  expect(await editor.page.getByTestId('canvas-element').screenshot()).toMatchSnapshot(
    'code-object-edge-alignment-guide.png'
  )

  await editor.page.mouse.up()
  await expect.poll(snapGuides).toEqual([])
  await expect.poll(() => framePosition(movingId)).toEqual({ x: 460, y: 100 })

  await editor.page.keyboard.press('Meta+z')
  await expect.poll(() => framePosition(movingId)).toEqual({ x: 600, y: 100 })
})
