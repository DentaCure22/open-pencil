import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { getPageChildren } from '#tests/helpers/store'
import {
  toolbarFlyoutItemTestId,
  toolbarFlyoutTestId,
  toolbarToolTestId
} from '#tests/helpers/test-ids'

const editor = useEditorSetup()

test('toolbar tools expose their names to assistive technology', async () => {
  await expect(editor.page.getByTestId(toolbarToolTestId('SELECT'))).toHaveAccessibleName('Move')
  await expect(editor.page.getByTestId(toolbarToolTestId('PEN'))).toHaveAccessibleName('Pen')
  await expect(editor.page.getByTestId(toolbarToolTestId('TEXT'))).toHaveAccessibleName('Text')
  await expect(editor.page.getByTestId(toolbarToolTestId('HAND'))).toHaveAccessibleName('Hand')
  editor.canvas.assertNoErrors()
})

test('collaboration controls live in the top toolbar', async () => {
  const toolbar = editor.page.getByTestId('toolbar')
  await expect(toolbar.getByTestId('narrated-trace-mic-toggle')).toHaveAccessibleName(
    /^Pin microphone on/
  )
  await expect(toolbar.getByTestId('toolbar-collaboration')).toBeVisible()
  await expect(toolbar.getByTestId('collab-local-avatar')).toBeVisible()
  await expect(toolbar.getByTestId('collab-share-button')).toHaveAccessibleName('Share')
  const bounds = await toolbar.boundingBox()
  expect(bounds?.y).toBeLessThan(80)
  await expect(editor.page.getByTestId('properties-panel')).toHaveCount(0)
})

test('bottom toolbar stays between side chrome and scrolls when space is tight', async () => {
  await editor.page.setViewportSize({ height: 821, width: 1280 })

  const toolbarMotion = editor.page.getByTestId('toolbar-motion')
  const toolbar = editor.page.getByRole('toolbar', { name: 'Editor tools' })
  const scrollViewport = editor.page.getByTestId('toolbar-scroll-viewport')
  const leftSidebar = editor.page.locator(
    '[data-test-id="layers-shell-motion"][data-sidebar-open="true"]'
  )
  const zoomControls = editor.page.getByTestId('canvas-zoom-controls')

  await expect(toolbar).toBeVisible()
  await expect(scrollViewport).toBeVisible()
  await expect
    .poll(async () => Number(await toolbarMotion.getAttribute('data-toolbar-left-inset')))
    .toBeGreaterThan(12)

  const [leftBounds, toolbarBounds, zoomBounds] = await Promise.all([
    leftSidebar.boundingBox(),
    toolbar.boundingBox(),
    zoomControls.boundingBox()
  ])
  if (!leftBounds || !toolbarBounds || !zoomBounds) {
    throw new Error('Expected sidebar-aware toolbar bounds')
  }
  expect(toolbarBounds.x).toBeGreaterThanOrEqual(leftBounds.x + leftBounds.width + 11)
  expect(toolbarBounds.x + toolbarBounds.width).toBeLessThanOrEqual(zoomBounds.x - 11)

  await editor.page.getByTestId('app-menu-toggle').click()
  await editor.page.getByTestId('settings-activity-toggle').click()
  const rightPanel = editor.page.getByTestId('t3-right-panel')
  await expect(rightPanel).toHaveAttribute('data-state', 'open')

  await expect
    .poll(async () => {
      const [currentToolbar, currentPanel] = await Promise.all([
        toolbar.boundingBox(),
        rightPanel.boundingBox()
      ])
      if (!currentToolbar || !currentPanel) return false
      return currentToolbar.x + currentToolbar.width <= currentPanel.x - 11
    })
    .toBe(true)

  const overflowWithPanel = await scrollViewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollLeft: element.scrollLeft,
    scrollWidth: element.scrollWidth
  }))
  expect(overflowWithPanel.scrollWidth).toBeGreaterThan(overflowWithPanel.clientWidth)

  await scrollViewport.hover()
  await editor.page.mouse.wheel(0, 180)
  await expect
    .poll(() => scrollViewport.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(overflowWithPanel.scrollLeft)
})

test('shapes flyout opens', async () => {
  await editor.page.getByTestId(toolbarFlyoutTestId('FRAME')).click()
  await expect(editor.page.getByTestId(toolbarFlyoutItemTestId('RECTANGLE'))).toBeVisible()
  await expect(editor.page.getByTestId(toolbarFlyoutItemTestId('POLYGON'))).toBeVisible()
  editor.canvas.assertNoErrors()
})

test('Polygon tool creates POLYGON node', async () => {
  await editor.page.getByTestId(toolbarFlyoutItemTestId('POLYGON')).click()
  await editor.canvas.drag(300, 200, 400, 300)
  await editor.canvas.waitForRender()

  const children = await getPageChildren(editor.page)
  expect(children.some((n) => n.type === 'POLYGON')).toBe(true)
  editor.canvas.assertNoErrors()
})

test('Star tool creates STAR node', async () => {
  await editor.page.getByTestId(toolbarFlyoutTestId('FRAME')).click()
  await editor.page.getByTestId(toolbarFlyoutItemTestId('STAR')).click()
  await editor.canvas.drag(150, 150, 250, 250)
  await editor.canvas.waitForRender()

  const children = await getPageChildren(editor.page)
  expect(children.some((n) => n.type === 'STAR')).toBe(true)
  editor.canvas.assertNoErrors()
})

test('Pen creates VECTOR node with 3 vertices on Enter', async () => {
  await editor.canvas.pressKey('Escape')
  await editor.canvas.pressKey('p')
  await editor.canvas.click(100, 400)
  await editor.canvas.waitForRender()
  await editor.canvas.click(200, 400)
  await editor.canvas.waitForRender()
  await editor.canvas.click(200, 480)
  await editor.canvas.waitForRender()
  await editor.canvas.pressKey('Enter')
  await editor.canvas.waitForRender()

  const children = await getPageChildren(editor.page)
  const vectors = children.filter((n) => n.type === 'VECTOR')
  expect(vectors.length).toBeGreaterThan(0)
  const last = vectors[vectors.length - 1]
  expect(last.vectorNetwork.vertices.length).toBe(3)
  editor.canvas.assertNoErrors()
})

test('Pen Escape with 2 vertices cancels path without creating node', async () => {
  const before = (await getPageChildren(editor.page)).filter((n) => n.type === 'VECTOR').length

  await editor.canvas.pressKey('p')
  await editor.canvas.click(350, 400)
  await editor.canvas.waitForRender()
  await editor.canvas.click(440, 400)
  await editor.canvas.waitForRender()
  await editor.canvas.pressKey('Escape')
  await editor.canvas.waitForRender()

  const after = (await getPageChildren(editor.page)).filter((n) => n.type === 'VECTOR').length
  expect(after).toBe(before)
  editor.canvas.assertNoErrors()
})

test('Pen close path creates VECTOR with closed region', async () => {
  const before = (await getPageChildren(editor.page)).filter((n) => n.type === 'VECTOR').length

  await editor.canvas.pressKey('p')
  await editor.canvas.click(500, 200)
  await editor.canvas.waitForRender()
  await editor.canvas.click(580, 200)
  await editor.canvas.waitForRender()
  await editor.canvas.click(540, 270)
  await editor.canvas.waitForRender()
  await editor.canvas.click(500, 200)
  await editor.canvas.waitForRender()

  const after = (await getPageChildren(editor.page)).filter((n) => n.type === 'VECTOR').length
  expect(after).toBeGreaterThan(before)

  const vectors = (await getPageChildren(editor.page)).filter((n) => n.type === 'VECTOR')
  const last = vectors[vectors.length - 1]
  expect(last.vectorNetwork.regions?.length).toBeGreaterThan(0)
  editor.canvas.assertNoErrors()
})

test('creation flyout combines frames, sections, and shapes', async () => {
  await editor.page.getByTestId(toolbarFlyoutTestId('FRAME')).click()
  await expect(editor.page.getByTestId(toolbarFlyoutItemTestId('FRAME'))).toBeVisible()
  await expect(editor.page.getByTestId(toolbarFlyoutItemTestId('SECTION'))).toBeVisible()
  await editor.page.getByTestId(toolbarFlyoutItemTestId('RECTANGLE')).click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => window.openPencil?.getStore?.().state.activeTool ?? null)
    )
    .toBe('RECTANGLE')
  editor.canvas.assertNoErrors()
})
