import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { toolbarToolTestId } from '#tests/helpers/test-ids'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

async function letAppReceivePointerEvents() {
  await editor.page.addStyleTag({
    content: 'html body [data-testid="react-grab-overlay"] { pointer-events: none !important; }'
  })
  await editor.page.locator('[data-testid="react-grab-overlay"]').evaluateAll((overlays) => {
    for (const overlay of overlays) {
      if (overlay instanceof HTMLElement) {
        overlay.style.setProperty('pointer-events', 'none', 'important')
      }
    }
  })
}

test('Smylr uses a stable working-canvas background', async () => {
  await expect(editor.page.locator('[data-code-object-id]').first()).toBeVisible()
  await expect(editor.page.getByTestId('animated-dither-background')).toHaveCount(0)
})

test('Design-mode wheel zoom works over a Code Object', async () => {
  const surface = editor.page.getByTestId('code-object-design-hit-target').first()
  await expect(surface).toBeVisible()
  const bounds = await surface.boundingBox()
  if (!bounds) throw new Error('Expected Code Object surface bounds')
  const before = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.zoom
  })

  await editor.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await editor.page.keyboard.down('Control')
  await editor.page.mouse.wheel(0, 100)
  await editor.page.keyboard.up('Control')

  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return store.state.zoom
      })
    )
    .toBeLessThan(before)
})

test('floating editor chrome follows themes with a more opaque sidebar', async () => {
  const sidebar = editor.page.getByTestId('layers-shell-motion')
  const toolbar = editor.page.getByTestId('toolbar-motion')
  const readChrome = () =>
    Promise.all(
      [sidebar, toolbar].map((element) =>
        element.evaluate((node) => getComputedStyle(node).backgroundColor)
      )
    )
  const utilityTabs = editor.page.getByRole('tablist', { name: 'Sidebar utilities' })

  await editor.page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  const lightChrome = await readChrome()
  const lightUtilityTabs = await utilityTabs.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  )

  await editor.page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  const darkChrome = await readChrome()
  const darkUtilityTabs = await utilityTabs.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  )

  expect(lightChrome).toEqual(['rgba(255, 255, 255, 0.95)', 'rgba(255, 255, 255, 0.9)'])
  expect(darkChrome).toEqual(['rgba(21, 22, 26, 0.98)', 'rgba(21, 22, 26, 0.96)'])
  expect(lightUtilityTabs).not.toBe(darkUtilityTabs)
  expect(darkUtilityTabs).toBe('rgba(0, 0, 0, 0.3)')
})

test('Code Objects stay ordinary frames without native scene effects', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()

  const codeObjectPaint = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = [...store.graph.getAllNodes()].find((node) =>
      node.pluginData.some(
        (entry) =>
          entry.pluginId === 'smylr-production' &&
          entry.key === 'kind' &&
          entry.value === 'smylr-code-object-frame'
      )
    )
    if (!frame) throw new Error('Smylr Code Object not initialized')
    return {
      effects: frame.effects.length,
      fills: frame.fills.length,
      strokes: frame.strokes.length
    }
  })
  expect(codeObjectPaint).toEqual({ effects: 0, fills: 0, strokes: 0 })
})

test('Smylr switches sidebar utilities without competing panel animations', async () => {
  const layersTrigger = editor.page.getByTestId('left-panel-layers-tab')
  const layersContent = editor.page.getByTestId('left-panel-layers-content')
  const assetsTrigger = editor.page.getByTestId('left-panel-assets-tab')
  const assetsContent = editor.page.getByTestId('left-panel-assets-content')

  await expect(layersTrigger).toHaveAttribute('data-state', 'active')
  await expect(layersContent).toBeVisible()

  await assetsTrigger.click()
  await expect(layersTrigger).toHaveAttribute('data-state', 'inactive')
  await expect(assetsTrigger).toHaveAttribute('data-state', 'active')
  await expect(layersContent).toBeHidden()
  await expect(assetsContent).toBeVisible()
  expect(await assetsContent.evaluate((element) => getComputedStyle(element).animationName)).toBe(
    'none'
  )

  await assetsTrigger.click()
  await expect(layersTrigger).toHaveAttribute('data-state', 'inactive')
  await expect(assetsTrigger).toHaveAttribute('data-state', 'active')
  await expect(assetsContent).toBeVisible()
})

test('Workspace switcher opens from the integrated toolbar', async () => {
  const workspaceButton = editor.page.getByTestId('workspace-toolbar-button')
  await expect(workspaceButton).toBeVisible()

  await workspaceButton.click()
  await expect(editor.page.getByTestId('board-project-browser')).toBeVisible()
  await editor.page.keyboard.press('Escape')
  await expect(editor.page.getByTestId('board-project-browser')).toBeHidden()
})

test('Smylr uses one integrated contextual sidebar', async () => {
  await letAppReceivePointerEvents()
  await expect(editor.page.getByTestId('properties-panel')).toHaveCount(0)
  await expect(editor.page.getByTestId('left-panel-layers-tab')).toHaveText('LAYERS')
  await expect(editor.page.getByTestId('left-panel-chats-tab')).toHaveText('CHATS')
  await expect(editor.page.getByTestId('left-panel-assets-tab')).toHaveText('ASSETS')
  await expect(editor.page.getByTestId('left-panel-trace-tab')).toHaveText('ACTIVITY')
  await expect(editor.page.getByTestId('left-panel-cache-tab')).toHaveText('CACHE')

  const toolbarMotion = editor.page.getByTestId('toolbar-motion')
  await expect(toolbarMotion).toHaveAttribute('data-sidebar-integrated', 'true')
  await expect(toolbarMotion).toHaveAttribute('data-toolbar-orientation', 'vertical')
  await expect(editor.page.getByTestId('workspace-toolbar-button')).toBeVisible()
  await expect(editor.page.getByTestId('toolbar-collaboration')).toBeVisible()

  await editor.page.getByRole('button', { name: 'Close sidebar' }).click()
  await editor.page.getByTestId('open-layers-panel').click()
  await editor.page.getByTestId('left-panel-trace-tab').click()
  await expect(editor.page.getByTestId('narrated-trace-panel')).toBeVisible()
})

test('workspace switcher keeps three recent Boards in stable order', async () => {
  test.setTimeout(30_000)

  const { originalPageId, warmPageIds } = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const originalPageId = store.state.currentPageId
    const warmPageIds: string[] = []
    for (const name of ['Warm Board A', 'Warm Board B', 'Warm Board C']) {
      const pageId = store.addPage(name)
      warmPageIds.push(pageId)
      await store.switchPage(pageId)
    }
    return { originalPageId, warmPageIds }
  })

  await editor.page.getByTestId('workspace-toolbar-button').click()
  const recent = editor.page.getByTestId('board-switcher-recent')
  const rows = recent.getByTestId('board-switcher-board-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Warm Board C')
  await expect(rows.nth(1)).toContainText('Warm Board B')
  await expect(rows.nth(2)).toContainText('Warm Board A')

  await rows.nth(2).click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => window.openPencil?.getStore?.().state.currentPageId ?? null)
    )
    .toBe(warmPageIds[0])

  await editor.page.evaluate(
    async ({ originalPageId, warmPageIds }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      await store.switchPage(originalPageId)
      for (const pageId of warmPageIds) store.deletePage(pageId)
    },
    { originalPageId, warmPageIds }
  )
})

test('board switcher keeps its header and project rows quiet', async () => {
  await letAppReceivePointerEvents()

  await editor.page.getByTestId('workspace-toolbar-button').click()
  const projectBrowser = editor.page.getByTestId('board-project-browser')
  const back = projectBrowser.getByTestId('board-switcher-back')
  if (await back.isVisible()) await back.click()
  const header = projectBrowser.getByTestId('board-switcher-header')
  await expect(header.getByText('Workspace', { exact: true })).toBeVisible()
  await expect(header.getByRole('button')).toHaveCount(0)
  const switcherBox = await projectBrowser.boundingBox()
  expect(switcherBox).not.toBeNull()
  if (switcherBox) {
    expect(switcherBox.height).toBeGreaterThan(400)
    expect(switcherBox.height).toBeLessThanOrEqual(553)
  }
  await expect(projectBrowser.getByTestId('board-switcher-recent')).toBeVisible()

  const projectRows = projectBrowser.getByTestId('board-switcher-project-row')
  expect(await projectRows.count()).toBeGreaterThan(0)
  expect(
    await projectRows.evaluateAll((rows) =>
      rows.every(
        (row) => [...row.children].filter((child) => child.tagName === 'SPAN').length === 1
      )
    )
  ).toBe(true)
  await editor.page.keyboard.press('Escape')
  await expect(projectBrowser).toBeHidden()
})

test('board switcher reveals the active Maps & Flows branch and current board', async () => {
  await letAppReceivePointerEvents()

  const targetName = 'Product Map — Dental Chart'
  await editor.page.evaluate(async (pageName) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getPages().find((candidate) => candidate.name === pageName)
    if (!page) throw new Error(`Expected ${pageName} in the Smylr workspace`)
    await store.switchPage(page.id)
  }, targetName)

  const projectBrowser = editor.page.getByTestId('board-project-browser')
  if (!(await projectBrowser.isVisible()))
    await editor.page.getByTestId('workspace-toolbar-button').dispatchEvent('click')
  await expect(projectBrowser).toBeVisible()
  const back = projectBrowser.getByTestId('board-switcher-back')
  if (await back.isVisible()) await back.dispatchEvent('click')

  await expect(projectBrowser.getByRole('button', { name: 'Collapse Smylr' })).toBeVisible()
  await expect(projectBrowser.getByRole('button', { name: 'Collapse Maps & Flows' })).toBeVisible()
  await expect(
    projectBrowser.getByText(`Maps & Flows / ${targetName}`, { exact: true })
  ).toBeVisible()

  for (const boardName of [
    'User Journey — Complete Dental Exam',
    'Task Flow — Record Finding',
    'Screen States — Dental Chart',
    'Recovery Flow — Save Finding',
    'Technical Flow — Save Finding'
  ]) {
    await expect(projectBrowser.getByRole('button', { name: boardName, exact: true })).toBeVisible()
  }

  const currentBoardButtons = projectBrowser.locator('[aria-current="page"]')
  expect(await currentBoardButtons.count()).toBeGreaterThan(0)
  expect(
    await currentBoardButtons.evaluateAll(
      (buttons, expectedName) =>
        buttons.every((button) => button.textContent?.includes(expectedName)),
      targetName
    )
  ).toBe(true)
})

test('board switcher restores recent board history', async () => {
  await letAppReceivePointerEvents()

  const { originalPageId, recentPageId } = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const originalPageId = store.state.currentPageId
    const recentPageId = store.addPage('Switcher history check')
    await store.switchPage(recentPageId)
    return { originalPageId, recentPageId }
  })

  const projectBrowser = editor.page.getByTestId('board-project-browser')
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return store.state.currentPageId
      })
    )
    .toBe(recentPageId)
  if (!(await projectBrowser.isVisible()))
    await editor.page.getByTestId('workspace-toolbar-button').dispatchEvent('click')
  await expect(projectBrowser).toBeVisible()
  const switcherBack = projectBrowser.getByTestId('board-switcher-back')
  if (await switcherBack.isVisible()) await switcherBack.dispatchEvent('click')
  const recentBoards = projectBrowser.getByTestId('board-switcher-recent')
  await expect(recentBoards.getByText('Switcher history check', { exact: true })).toBeVisible()

  await editor.page.evaluate(
    async ({ originalPageId, recentPageId }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      await store.switchPage(originalPageId)
      store.deletePage(recentPageId)
    },
    { originalPageId, recentPageId }
  )
})

test('Trace annotations switch exclusively with editor tools', async () => {
  const toolbar = editor.page.getByTestId('toolbar')
  const move = toolbar.getByTestId(toolbarToolTestId('SELECT'))
  const pen = toolbar.getByTestId(toolbarToolTestId('PEN'))
  const ink = toolbar.getByTestId('narrated-trace-ink-tool')
  const focus = toolbar.getByTestId('narrated-trace-focus-tool')

  await expect(move).toHaveAttribute('aria-pressed', 'true')
  await focus.click()
  await expect(focus).toHaveAttribute('aria-pressed', 'true')
  await expect(move).toHaveAttribute('aria-pressed', 'false')

  await pen.click()
  await expect(pen).toHaveAttribute('aria-pressed', 'true')
  await expect(focus).toHaveAttribute('aria-pressed', 'false')

  await ink.click()
  await expect(ink).toHaveAttribute('aria-pressed', 'true')
  await expect(move).toHaveAttribute('aria-pressed', 'false')
  await expect(pen).toHaveAttribute('aria-pressed', 'false')

  await move.click()
  await expect(move).toHaveAttribute('aria-pressed', 'true')
  await expect(ink).toHaveAttribute('aria-pressed', 'false')
})
