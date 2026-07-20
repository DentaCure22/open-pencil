import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test')

type ChromeCenters = {
  canvas: number
  dock: number
  toolbar: number
}

function centerX(bounds: { width: number; x: number } | null) {
  expect(bounds).not.toBeNull()
  if (!bounds) throw new Error('Expected visible floating chrome bounds')
  return bounds.x + bounds.width / 2
}

async function chromeCenters(): Promise<ChromeCenters> {
  const [canvas, dock, toolbar] = await Promise.all([
    editor.page.getByTestId('canvas-chrome-area').boundingBox(),
    editor.page.getByTestId('board-dock').boundingBox(),
    editor.page.getByTestId('toolbar-motion').boundingBox()
  ])
  return { canvas: centerX(canvas), dock: centerX(dock), toolbar: centerX(toolbar) }
}

function expectSharedCenter(centers: ChromeCenters) {
  expect(centers.toolbar).toBeCloseTo(centers.canvas, 0)
  expect(centers.dock).toBeCloseTo(centers.canvas, 0)
}

test('top tools and bottom dock shift with the sidebar on one motion curve', async () => {
  const toolbar = editor.page.getByTestId('toolbar-motion')
  const dock = editor.page.getByTestId('board-dock')

  await expect(toolbar).toHaveAttribute('data-sidebar-open', 'true')
  await expect(dock).toHaveAttribute('data-sidebar-open', 'true')

  const motionStyles = await Promise.all(
    [toolbar, dock].map((element) =>
      element.evaluate((node) => {
        const style = getComputedStyle(node)
        return {
          duration: style.transitionDuration,
          easing: style.transitionTimingFunction,
          property: style.transitionProperty
        }
      })
    )
  )
  for (const style of motionStyles) {
    expect(style.duration).toBe('0.2s')
    expect(style.easing).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)')
    expect(style.property).toContain('transform')
  }

  const open = await chromeCenters()
  expectSharedCenter(open)

  await editor.page.getByTestId('close-layers-panel').dispatchEvent('click')
  await expect(toolbar).toHaveAttribute('data-sidebar-open', 'false')
  await expect(dock).toHaveAttribute('data-sidebar-open', 'false')
  await editor.page.waitForTimeout(70)

  const closing = await chromeCenters()
  expectSharedCenter(closing)
  expect(closing.toolbar).toBeLessThan(open.toolbar - 1)

  await expect.poll(async () => (await chromeCenters()).toolbar).toBeLessThan(closing.toolbar - 1)
  const closed = await chromeCenters()
  expectSharedCenter(closed)

  const openButton = editor.page.getByTestId('open-layers-panel')
  await expect(openButton).toBeVisible()
  await openButton.dispatchEvent('click')
  await expect(toolbar).toHaveAttribute('data-sidebar-open', 'true')
  await expect(dock).toHaveAttribute('data-sidebar-open', 'true')
  await editor.page.waitForTimeout(70)

  const opening = await chromeCenters()
  expectSharedCenter(opening)
  expect(opening.toolbar).toBeGreaterThan(closed.toolbar + 1)
  expect(opening.toolbar).toBeLessThan(open.toolbar - 1)

  await expect
    .poll(async () => (await chromeCenters()).toolbar)
    .toBeGreaterThan(opening.toolbar + 1)
  const reopened = await chromeCenters()
  expectSharedCenter(reopened)
  expect(reopened.toolbar).toBeCloseTo(open.toolbar, 0)
  editor.canvas.assertNoErrors()
})
