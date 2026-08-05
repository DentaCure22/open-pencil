import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?blank')

test('shows the animated start canvas on a normal empty OpenPencil board', async () => {
  const dither = editor.page.getByTestId('animated-dither-background')
  const scene = editor.page.getByTestId('scene-canvas-element')
  await expect(editor.page.getByTestId('empty-board-start')).toBeVisible()
  await expect(dither).toBeVisible()
  await expect(dither).toHaveAttribute('data-animation', 'continuous')
  await expect(dither).toHaveAttribute('data-max-fps', '15')
  await expect(dither).toHaveAttribute('data-presentation', 'surface')
  expect(
    await dither.evaluate((node) => Number.parseInt(getComputedStyle(node).zIndex, 10))
  ).toBeGreaterThan(
    await scene.evaluate((node) => Number.parseInt(getComputedStyle(node).zIndex, 10))
  )
  const ditherCanvas = dither.locator('canvas')
  await expect(ditherCanvas).toHaveCount(1)
  const resolution = await ditherCanvas.evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error('Dither canvas was not rendered')
    return {
      displayHeight: node.clientHeight,
      displayWidth: node.clientWidth,
      internalHeight: node.height,
      internalWidth: node.width
    }
  })
  expect(resolution.internalWidth).toBeLessThan(resolution.displayWidth)
  expect(resolution.internalHeight).toBeLessThan(resolution.displayHeight)
  const drawCount = await ditherCanvas.evaluate(async (node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error('Dither canvas was not rendered')
    const context = node.getContext('webgl2')
    if (!context) throw new Error('Dither WebGL context was not created')

    let count = 0
    const drawArrays = context.drawArrays.bind(context)
    context.drawArrays = (...args) => {
      count += 1
      drawArrays(...args)
    }
    await new Promise((resolve) => {
      window.setTimeout(resolve, 550)
    })
    context.drawArrays = drawArrays
    return count
  })
  expect(drawCount).toBeGreaterThan(3)
  expect(drawCount).toBeLessThanOrEqual(10)
  const firstFrame = await ditherCanvas.screenshot()
  await editor.page.waitForTimeout(200)
  const nextFrame = await ditherCanvas.screenshot()
  expect(nextFrame.equals(firstFrame)).toBe(false)
  await expect(editor.page.getByTestId('layers-shell')).toHaveCount(0)
  await expect(editor.page.getByTestId('toolbar')).toHaveCount(0)
  await expect(editor.page.getByTestId('board-dock')).toHaveCount(0)
})

test('restores the editor chrome after creating the first Code Object', async () => {
  await editor.page.getByTestId('code-object-start').click()

  await expect(editor.page.locator('[data-code-object-root]')).toBeVisible()
  await expect(editor.page.getByTestId('empty-board-start')).toBeHidden()
  await expect(editor.page.getByTestId('layers-shell')).toBeVisible()
  await expect(editor.page.getByTestId('toolbar')).toBeVisible()
  await expect(editor.page.getByTestId('board-dock')).toBeVisible()
  await expect(editor.page.getByRole('tab', { name: 'Code' })).toBeVisible()
})
