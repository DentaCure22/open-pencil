import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test')

async function openProjectBrowser() {
  const panel = editor.page.getByTestId('pages-panel')
  if (await panel.isVisible()) return
  const browser = editor.page.getByTestId('board-project-browser')
  if ((await browser.isVisible()) && (await browser.getAttribute('data-state')) === 'closed') {
    await expect(browser).not.toBeVisible()
  }
  if (!(await browser.isVisible()))
    await editor.page.getByTestId('workspace-toolbar-button').dispatchEvent('click')
  await expect(browser).toBeVisible()
  const back = editor.page.getByTestId('board-switcher-back')
  if (await back.isVisible()) {
    await expect(panel).toBeVisible()
    return
  }
  const manage = editor.page.getByTestId('board-switcher-manage')
  await expect(manage).toBeVisible()
  await manage.dispatchEvent('click')
  await expect(panel).toBeVisible()
}

async function switchBoardFromSwitcher(name: string) {
  const browser = editor.page.getByTestId('board-project-browser')
  if (!(await browser.isVisible()))
    await editor.page.getByTestId('workspace-toolbar-button').dispatchEvent('click')
  const back = editor.page.getByTestId('board-switcher-back')
  if (await back.isVisible()) await back.dispatchEvent('click')
  const search = editor.page.getByTestId('board-switcher-search')
  await expect(search).toBeVisible()
  await search.fill(name)
  await browser.getByTestId('board-switcher-board-row').filter({ hasText: name }).first().click()
}

test.beforeEach(async () => {
  await openProjectBrowser()
})

function getScenePages() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.getPages().map((page) => ({ id: page.id, name: page.name }))
  })
}

function getCurrentPageChildCount() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.getChildren(store.state.currentPageId).length
  })
}

function getSidebarHierarchy() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const root = store.graph.getNode(store.graph.rootId)
    const entry = root?.pluginData.find(
      (candidate) =>
        candidate.pluginId === 'openpencil-sidebar-workspace' && candidate.key === 'tree-v1'
    )
    if (!entry) throw new Error('Sidebar hierarchy is not persisted')
    return JSON.parse(entry.value) as {
      boards: Array<{ icon?: string; label?: string; pageId: string; parentPageId: string }>
      pages: Array<{ id: string; name: string; parentId: string | null }>
    }
  })
}

async function getBoardParentName(label: string) {
  const hierarchy = await getSidebarHierarchy()
  const board = hierarchy.boards.find((candidate) => candidate.label === label)
  return hierarchy.pages.find((page) => page.id === board?.parentPageId)?.name ?? null
}

async function getPageParentName(name: string) {
  const hierarchy = await getSidebarHierarchy()
  const page = hierarchy.pages.find((candidate) => candidate.name === name)
  return hierarchy.pages.find((candidate) => candidate.id === page?.parentId)?.name ?? null
}

function pageItem(name: string) {
  return editor.page.getByTestId('pages-item').filter({ hasText: name })
}

function pageRow(name: string) {
  return editor.page.getByTestId('pages-row').filter({ hasText: name })
}

function boardItem(name: string) {
  return editor.page.getByTestId('pages-board-item').filter({ hasText: name })
}

function boardRow(name: string) {
  return editor.page.getByTestId('pages-board-row').filter({ hasText: name })
}

async function commitInlineRename(name: string) {
  const input = editor.page.getByTestId('pages-item-input')
  await expect(input).toBeVisible()
  await input.fill(name)
  await input.press('Enter')
  await expect(input).not.toBeVisible()
}

async function createRootPage(name: string) {
  await editor.page.getByTestId('pages-new-page').click()
  await commitInlineRename(name)
}

async function openPageAddMenu(name: string) {
  await editor.page.getByRole('button', { name: `Add to ${name}`, exact: true }).click()
}

test('starts with one logical Page, one Board, and Layers ready', async () => {
  await expect(editor.page.getByTestId('layers-shell')).toBeVisible()
  await expect(pageItem('Page 1')).toHaveCount(1)
  await expect(boardItem('Main board')).toHaveCount(1)
  await expect(editor.page.getByTestId('layers-scroll')).toBeVisible()
  await expect(editor.page.getByTestId('assets-panel')).toHaveCount(0)
  expect(await getScenePages()).toHaveLength(1)
})

test('creates and renames a logical Page without inventing a canvas Board', async () => {
  await createRootPage('Projects')

  await expect(pageItem('Projects')).toHaveCount(1)
  expect(await getScenePages()).toHaveLength(1)
  editor.canvas.assertNoErrors()
})

test('creates a Board with a chosen dock identity under its intended Page', async () => {
  await openPageAddMenu('Projects')
  await editor.page.getByRole('menuitem', { name: 'New board', exact: true }).click()
  const dialog = editor.page.getByTestId('board-identity-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Board name' }).fill('Overview')
  await dialog.getByRole('radio', { name: 'Flow', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create board', exact: true }).click()
  await editor.canvas.waitForRender()

  await expect(boardItem('Overview')).toHaveCount(1)
  await expect(pageItem('Untitled board')).toHaveCount(0)
  expect(await getScenePages()).toHaveLength(2)
  await expect(boardRow('Overview')).toHaveClass(/bg-white/)
  await expect(boardRow('Overview').locator('[data-board-icon="flow"]')).toBeVisible()
  const hierarchy = await getSidebarHierarchy()
  const overviewBoard = hierarchy.boards.find((board) => board.label === 'Overview')
  expect(overviewBoard?.icon).toBe('flow')
  editor.canvas.assertNoErrors()
})

test('closes the board switcher after each board selection', async () => {
  const projectBrowser = editor.page.getByTestId('board-project-browser')

  await switchBoardFromSwitcher('Main board')
  await expect(projectBrowser).not.toBeVisible()

  await switchBoardFromSwitcher('Overview')
  await expect(projectBrowser).not.toBeVisible()
})

test('changes an existing Board icon from the inline rename dropdown', async () => {
  await boardRow('Overview').getByRole('button', { name: 'Overview actions', exact: true }).click()
  await editor.page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  const renameInput = editor.page.getByRole('textbox', { name: 'Rename Overview' })
  await expect(renameInput).toBeVisible()
  await editor.page.getByTestId('board-rename-icon-trigger').click()
  await expect(editor.page.getByTestId('board-rename-icon-menu')).toBeVisible()
  await editor.page.getByTestId('board-rename-icon-option-chart').click()
  await expect(renameInput).toBeFocused()
  await renameInput.press('Enter')

  await expect(boardItem('Overview')).toHaveCount(1)
  await expect(boardRow('Overview').locator('[data-board-icon="chart"]')).toBeVisible()
  const hierarchy = await getSidebarHierarchy()
  const overviewBoard = hierarchy.boards.find((board) => board.label === 'Overview')
  expect(overviewBoard?.icon).toBe('chart')
})

test('creates a nested Page with visible hierarchy indentation', async () => {
  await openPageAddMenu('Projects')
  await editor.page.getByRole('menuitem', { name: 'New subproject', exact: true }).click()
  await commitInlineRename('Research')

  const parentPadding = Number.parseFloat(
    await pageRow('Projects').evaluate((row) => getComputedStyle(row).paddingLeft)
  )
  const childPadding = Number.parseFloat(
    await pageRow('Research').evaluate((row) => getComputedStyle(row).paddingLeft)
  )
  expect(childPadding).toBeGreaterThan(parentPadding)
  editor.canvas.assertNoErrors()
})

test('searches across Page and Board names without exposing unrelated rows', async () => {
  const search = editor.page.getByTestId('pages-search')
  await search.fill('Overview')

  await expect(pageItem('Projects')).toHaveCount(1)
  await expect(boardItem('Overview')).toHaveCount(1)
  await expect(pageItem('Page 1')).toHaveCount(0)

  await editor.page.getByRole('button', { name: 'Clear page search', exact: true }).click()
  await expect(pageItem('Page 1')).toHaveCount(1)
})

test('keeps canvas content isolated when switching Boards', async () => {
  await switchBoardFromSwitcher('Main board')
  await editor.canvas.waitForRender()
  const mainBoardChildCount = await getCurrentPageChildCount()

  await switchBoardFromSwitcher('Overview')
  await editor.canvas.waitForRender()
  const overviewChildCount = await getCurrentPageChildCount()
  // Draw in the unobstructed canvas center; the shell intentionally floats
  // over the left edge of the full-bleed canvas.
  await editor.canvas.drawRect(420, 100, 80, 60)
  await editor.canvas.waitForRender()
  expect(await getCurrentPageChildCount()).toBe(overviewChildCount + 1)

  await switchBoardFromSwitcher('Main board')
  await editor.canvas.waitForRender()
  expect(await getCurrentPageChildCount()).toBe(mainBoardChildCount)

  await switchBoardFromSwitcher('Overview')
  await editor.canvas.waitForRender()
  expect(await getCurrentPageChildCount()).toBe(overviewChildCount + 1)
  editor.canvas.assertNoErrors()
})

test('renames Pages and Boards inline', async () => {
  await pageItem('Projects').dispatchEvent('dblclick')
  await commitInlineRename('Care plan')

  await boardItem('Overview').dispatchEvent('dblclick')
  await commitInlineRename('Patient overview')

  await expect(pageItem('Care plan')).toHaveCount(1)
  await expect(boardItem('Patient overview')).toHaveCount(1)
  editor.canvas.assertNoErrors()
})

test('drags a Board into another Page', async () => {
  await createRootPage('Archive')
  const source = boardRow('Patient overview').getByRole('button', {
    name: 'Drag board',
    exact: true
  })
  await source.dragTo(pageRow('Archive'), { targetPosition: { x: 110, y: 16 } })
  await editor.canvas.waitForRender()

  expect(await getBoardParentName('Patient overview')).toBe('Archive')
  const archivePadding = Number.parseFloat(
    await pageRow('Archive').evaluate((row) => getComputedStyle(row).paddingLeft)
  )
  const boardPadding = Number.parseFloat(
    await boardRow('Patient overview').evaluate((row) => getComputedStyle(row).paddingLeft)
  )
  expect(boardPadding).toBeGreaterThan(archivePadding)
  editor.canvas.assertNoErrors()
})

test('drags a nested Page back to the root', async () => {
  const source = pageRow('Research').getByRole('button', { name: 'Drag page', exact: true })
  await source.dragTo(editor.page.getByTestId('pages-header'), {
    targetPosition: { x: 100, y: 16 }
  })

  expect(await getPageParentName('Research')).toBeNull()
  const rootPadding = Number.parseFloat(
    await pageRow('Care plan').evaluate((row) => getComputedStyle(row).paddingLeft)
  )
  const movedPadding = Number.parseFloat(
    await pageRow('Research').evaluate((row) => getComputedStyle(row).paddingLeft)
  )
  expect(movedPadding).toBe(rootPadding)
  editor.canvas.assertNoErrors()
})

test('protects non-empty Pages and confirms Board deletion explicitly', async () => {
  await editor.page.getByRole('button', { name: 'Archive actions', exact: true }).click()
  const deletePage = editor.page.getByRole('menuitem', { name: 'Delete project', exact: true })
  await expect(deletePage).toHaveAttribute('data-disabled', '')
  await editor.page.mouse.click(700, 100)
  await expect(deletePage).toHaveCount(0)
  await openProjectBrowser()

  await editor.page.getByRole('button', { name: 'Patient overview actions', exact: true }).click()
  await editor.page.getByRole('menuitem', { name: 'Delete board', exact: true }).click()
  const dialog = editor.page.getByTestId('board-delete-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Delete “Patient overview”?', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(boardItem('Patient overview')).toHaveCount(1)
  expect(await getScenePages()).toHaveLength(2)

  await editor.page.getByRole('button', { name: 'Patient overview actions', exact: true }).click()
  await editor.page.getByRole('menuitem', { name: 'Delete board', exact: true }).click()
  await editor.page.getByTestId('board-delete-confirm').click()
  await editor.canvas.waitForRender()

  await expect(boardItem('Patient overview')).toHaveCount(0)
  expect(await getScenePages()).toHaveLength(1)
  editor.canvas.assertNoErrors()
})

test('deletes empty logical Pages while preserving the last real Board', async () => {
  for (const name of ['Archive', 'Research', 'Care plan']) {
    await editor.page.getByRole('button', { name: `${name} actions`, exact: true }).click()
    const deletePage = editor.page.getByRole('menuitem', { name: 'Delete project', exact: true })
    await expect(deletePage).not.toHaveAttribute('data-disabled', '')
    await deletePage.click()
    await expect(pageItem(name)).toHaveCount(0)
  }

  await expect(pageItem('Page 1')).toHaveCount(1)
  await expect(boardItem('Main board')).toHaveCount(1)
  expect(await getScenePages()).toHaveLength(1)
  editor.canvas.assertNoErrors()
})

test('switches Layers and Assets as one low-load utility area', async () => {
  await editor.page.keyboard.press('Escape')
  await editor.page.getByTestId('left-panel-layers-tab').click()
  await expect(editor.page.getByTestId('layers-scroll')).toBeVisible()
  await expect(editor.page.getByTestId('assets-panel')).toHaveCount(0)

  await editor.page.getByTestId('left-panel-assets-tab').click()
  await expect(editor.page.getByTestId('layers-scroll')).toHaveCount(0)
  await expect(editor.page.getByTestId('assets-panel')).toBeVisible()
  editor.canvas.assertNoErrors()
})
