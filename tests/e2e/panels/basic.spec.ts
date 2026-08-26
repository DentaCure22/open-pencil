import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { expectDefined } from '#tests/helpers/assert'

const editor = useEditorSetup()

test('layers panel resize increases width', async () => {
  const panel = editor.page.getByTestId('layers-panel')
  const before = await panel.boundingBox()
  expect(before).not.toBeNull()

  const handle = editor.page.getByTestId('left-splitter-handle')
  const handleBox = await handle.boundingBox()
  expect(handleBox).not.toBeNull()

  const handleBounds = expectDefined(handleBox, 'splitter handle bounds')
  const beforeBounds = expectDefined(before, 'layers panel bounds')
  expect(handleBounds.width).toBeGreaterThanOrEqual(40)
  expect(
    await handle.evaluate((element) => {
      let ancestor = element.parentElement
      while (ancestor) {
        if (getComputedStyle(ancestor).pointerEvents === 'none') return false
        ancestor = ancestor.parentElement
      }
      return true
    })
  ).toBe(true)

  const edgeHits = await editor.page.evaluate(
    ({ left, right, y }) =>
      [left + 2, right - 2].map((x) =>
        document.elementFromPoint(x, y)?.getAttribute('data-test-id')
      ),
    {
      left: handleBounds.x,
      right: handleBounds.x + handleBounds.width,
      y: handleBounds.y + handleBounds.height / 2
    }
  )
  expect(edgeHits).toEqual(['left-splitter-handle', 'left-splitter-handle'])

  const cx = handleBounds.x + 2
  const cy = handleBounds.y + handleBounds.height / 2

  await editor.page.mouse.move(cx, cy)
  await editor.page.mouse.down()
  await expect(editor.page.locator('html')).toHaveAttribute('data-horizontal-resizing', '')
  await expect(editor.page.getByTestId('layers-splitter-panel')).toHaveAttribute(
    'data-resizing',
    'true'
  )
  await expect(editor.page.getByTestId('layers-shell-motion')).toHaveCSS(
    'transition-property',
    'none'
  )
  await editor.page.mouse.move(cx + 80, cy, { steps: 10 })
  await editor.page.mouse.up()
  await expect(editor.page.locator('html')).not.toHaveAttribute('data-horizontal-resizing')
  await expect(editor.page.getByTestId('layers-splitter-panel')).toHaveAttribute(
    'data-resizing',
    'false'
  )
  await editor.canvas.waitForRender()

  const after = expectDefined(await panel.boundingBox(), 'resized layers panel bounds')
  expect(after.width).toBeGreaterThan(beforeBounds.width + 40)
  editor.canvas.assertNoErrors()
})

test('panel width persists after page reload', async () => {
  // Allow Reka's auto-save debounce to flush before recording the width
  await editor.page.waitForTimeout(300)
  const recordedWidth = expectDefined(
    await editor.page.getByTestId('layers-panel').boundingBox(),
    'persisted layers panel bounds'
  ).width

  await editor.page.reload()
  await editor.canvas.waitForInit()

  const after = expectDefined(
    await editor.page.getByTestId('layers-panel').boundingBox(),
    'reloaded layers panel bounds'
  )
  expect(Math.abs(after.width - recordedWidth)).toBeLessThanOrEqual(2)
  editor.canvas.assertNoErrors()
})

test('Cmd+Backslash hides panels', async () => {
  await editor.page.keyboard.press('Meta+\\')
  await editor.canvas.waitForRender()

  await expect(editor.page.getByTestId('layers-panel')).not.toBeVisible()
  editor.canvas.assertNoErrors()
})

test('Cmd+Backslash shows panels again', async () => {
  await editor.page.keyboard.press('Meta+\\')
  await editor.canvas.waitForRender()

  await expect(editor.page.getByTestId('layers-panel')).toBeVisible()
  editor.canvas.assertNoErrors()
})

test('the single contextual sidebar closes and reopens', async () => {
  const splitter = editor.page.getByTestId('layers-splitter-panel')
  const shellMotion = editor.page.getByTestId('layers-shell-motion')
  const sidebar = editor.page.getByTestId('layers-panel')
  const initialBounds = expectDefined(await splitter.boundingBox(), 'initial sidebar bounds')

  await expect(editor.page.getByTestId('properties-panel')).toHaveCount(0)
  expect(
    await splitter.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        duration: style.transitionDuration,
        easing: style.transitionTimingFunction,
        property: style.transitionProperty
      }
    })
  ).toEqual({
    duration: '0.2s',
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    property: 'flex-grow'
  })
  expect(
    await shellMotion.evaluate((element) => getComputedStyle(element).transitionProperty)
  ).toBe('width, height, border-radius')

  const closingShellWidthsPromise = shellMotion.evaluate(
    (element) =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = []
        const startedAt = performance.now()
        const sample = () => {
          samples.push(element.getBoundingClientRect().width)
          if (performance.now() - startedAt < 220) requestAnimationFrame(sample)
          else resolve(samples)
        }
        requestAnimationFrame(sample)
      })
  )
  await editor.page.getByTestId('close-layers-panel').click()
  const closingShellWidths = await closingShellWidthsPromise
  expect(Math.min(...closingShellWidths)).toBeGreaterThanOrEqual(43)
  expect(Math.max(...closingShellWidths)).toBeGreaterThan(80)
  expect(
    closingShellWidths.slice(1).some((width, index) => width > closingShellWidths[index] + 1)
  ).toBe(false)
  await expect(splitter).toHaveAttribute('data-state', 'collapsed')
  await expect(sidebar).not.toBeVisible()
  await expect(editor.page.getByTestId('open-layers-panel')).toBeVisible()
  await expect.poll(async () => (await splitter.boundingBox())?.width ?? 999).toBeLessThanOrEqual(1)

  await editor.page.getByTestId('open-layers-panel').click()
  await expect(splitter).toHaveAttribute('data-state', 'expanded')
  await expect(sidebar).toBeVisible()
  await expect(editor.page.getByTestId('open-layers-panel')).toHaveCount(0)
  await expect
    .poll(async () => (await splitter.boundingBox())?.width ?? 0)
    .toBeGreaterThan(initialBounds.width - 2)
  editor.canvas.assertNoErrors()
})

test('Chats moves from the canvas into the editor tool rail', async () => {
  await expect(editor.page.getByTestId('agent-terminals-toggle')).toHaveCount(0)

  await editor.page.getByTestId('close-layers-panel').click()
  await expect(editor.page.getByTestId('layers-splitter-panel')).toHaveAttribute(
    'data-state',
    'collapsed'
  )

  await editor.page.getByTestId('toolbar-chats').click()
  await expect(editor.page.getByTestId('layers-splitter-panel')).toHaveAttribute(
    'data-state',
    'expanded'
  )
  await expect(editor.page.getByTestId('left-panel-chats-tab')).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(editor.page.getByTestId('left-panel-chats-content')).toBeVisible()
  editor.canvas.assertNoErrors()
})
