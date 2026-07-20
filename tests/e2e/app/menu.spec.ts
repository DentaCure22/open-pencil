import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test')

function assertNoMermaidErrors(): void {
  expect(
    editor.canvas.errors.some((message) =>
      /DataCloneError|Mermaid returned no editable diagram pieces|This Mermaid diagram/u.test(
        message
      )
    )
  ).toBe(false)
  editor.canvas.errors.length = 0
}

test.beforeEach(async () => {
  const menubar = editor.page.locator('[role="menubar"]')
  if (!(await menubar.isVisible())) {
    await editor.page.getByTestId('app-menu-toggle').click()
  }
  await expect(menubar).toBeVisible()
})

test('workspace title is static and the app icon owns browser menus', async () => {
  const title = editor.page.getByTestId('workspace-title')
  const appMenuToggle = editor.page.getByTestId('app-menu-toggle')

  await expect(title).toHaveText('OpenPencil')
  await expect(title).not.toHaveAttribute('aria-expanded')
  await expect(appMenuToggle).toHaveAttribute('aria-expanded', 'true')

  await editor.page.mouse.move(500, 500)
  const restingShadow = await appMenuToggle.evaluate(
    (element) => getComputedStyle(element).boxShadow
  )
  await appMenuToggle.hover()
  await expect
    .poll(() => appMenuToggle.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe(restingShadow)
})

test('menu bar has all top-level menus', async () => {
  const triggers = editor.page.locator('[role="menubar"] [role="menuitem"]')
  const labels = await triggers.allTextContents()
  expect(labels).toEqual([
    'File',
    'Settings',
    'Edit',
    'Insert',
    'View',
    'Object',
    'Text',
    'Arrange'
  ])
})

test('Settings menu keeps app preferences together', async () => {
  await editor.page.getByTestId('menubar-settings').click()
  const menu = editor.page.locator('[role="menu"]')
  await expect(menu).toBeVisible()

  const items = await menu.locator('[role="menuitem"]').allTextContents()
  expect(items.some((text) => text.includes('Theme'))).toBe(true)
  expect(items.some((text) => text.includes('Language'))).toBe(true)
  await expect(menu.getByRole('menuitemcheckbox', { name: /profiler/i })).toBeVisible()

  await editor.page.keyboard.press('Escape')
})

test('File menu opens and shows items', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' }).click()
  const menu = editor.page.locator('[role="menu"]')
  await expect(menu).toBeVisible()

  const items = await menu.locator('[role="menuitem"]').allTextContents()
  expect(items.some((t) => t.includes('Open'))).toBe(true)
  expect(items.some((t) => t.includes('Save'))).toBe(true)
  expect(items.some((t) => t.includes('Save as'))).toBe(true)

  await editor.page.keyboard.press('Escape')
})

test('Edit menu shows Undo/Redo/Delete', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Edit' }).click()
  const menu = editor.page.locator('[role="menu"]')
  await expect(menu).toBeVisible()

  const items = await menu.locator('[role="menuitem"]').allTextContents()
  expect(items.some((t) => t.includes('Undo'))).toBe(true)
  expect(items.some((t) => t.includes('Redo'))).toBe(true)
  expect(items.some((t) => t.includes('Delete'))).toBe(true)
  expect(items.some((t) => t.includes('Select all'))).toBe(true)

  await editor.page.keyboard.press('Escape')
})

test('Insert menu creates separate editable Mermaid pieces', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Insert' }).click()
  await editor.page.getByRole('menuitem', { name: 'Mermaid diagram…', exact: true }).click()

  const dialog = editor.page.getByTestId('mermaid-import-dialog')
  await expect(dialog).toBeVisible()
  await editor.page
    .getByTestId('mermaid-source')
    .fill('flowchart LR\n  A[Capture] --> B[Editable layers]')
  await expect(editor.page.getByTestId('mermaid-layer-count')).toContainText('editable layers', {
    timeout: 10_000
  })
  await editor.page.getByTestId('mermaid-insert').click()
  await expect(dialog).toHaveCount(0)
  await editor.canvas.waitForRender()

  const inserted = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    const nodes = (page?.childIds ?? []).flatMap((id) => {
      const node = store.graph.getNode(id)
      return node ? [node] : []
    })
    const owner = nodes.find(
      (node) =>
        node.type === 'FRAME' &&
        node.name === 'Mermaid diagram' &&
        node.pluginData.some((entry) => entry.key === 'mermaid/diagram-id')
    )
    const pieces = (owner?.childIds ?? []).flatMap((id) => {
      const node = store.graph.getNode(id)
      return node ? [node] : []
    })
    const sourceBackedPieces = pieces.filter((node) =>
      node.pluginData.some((entry) => entry.key === 'mermaid/diagram-id')
    )
    const diagramIds = [
      ...new Set(
        sourceBackedPieces.flatMap((node) =>
          node.pluginData
            .filter((entry) => entry.key === 'mermaid/diagram-id')
            .map((entry) => entry.value)
        )
      )
    ]
    return {
      diagramIds,
      hasBackground: nodes.some((node) => node.name === 'Mermaid background'),
      ids: owner ? [owner.id, ...sourceBackedPieces.map((node) => node.id)] : [],
      ownerId: owner?.id,
      ownerType: owner?.type,
      parentIds: sourceBackedPieces.map((node) => node.parentId),
      pieceCount: sourceBackedPieces.length,
      selectedIds: [...store.state.selectedIds],
      source: sourceBackedPieces[0]?.pluginData.find((entry) => entry.key === 'mermaid/source')
        ?.value,
      hasArrowhead: sourceBackedPieces.some((node) => node.name === 'Arrowhead'),
      types: [...new Set(sourceBackedPieces.map((node) => node.type))]
    }
  })

  expect(inserted.hasBackground).toBe(false)
  expect(inserted.diagramIds).toHaveLength(1)
  expect(inserted.ownerType).toBe('FRAME')
  expect(inserted.pieceCount).toBeGreaterThan(4)
  expect(inserted.types).toEqual(expect.arrayContaining(['TEXT', 'VECTOR']))
  expect(inserted.parentIds.every((id) => id === inserted.ownerId)).toBe(true)
  expect(inserted.selectedIds).toEqual([inserted.ownerId])
  expect(inserted.source).toContain('A[Capture]')
  expect(inserted.hasArrowhead).toBe(true)
  await expect(editor.page.getByTestId('design-panel-single')).toBeVisible()
  await expect(editor.page.getByTestId('sidebar-context-code')).toHaveCount(0)

  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Edit' }).click()
  await editor.page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Undo' }).click()
  await editor.canvas.waitForRender()
  expect(
    await editor.page.evaluate(
      (ids) => ids.every((id) => window.openPencil?.getStore?.().graph.getNode(id) === undefined),
      inserted.ids
    )
  ).toBe(true)
  assertNoMermaidErrors()
})

test('Insert menu converts Mermaid Architecture into editable native pieces', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Insert' }).click()
  await editor.page.getByRole('menuitem', { name: 'Mermaid diagram…', exact: true }).click()

  const dialog = editor.page.getByTestId('mermaid-import-dialog')
  await editor.page.getByTestId('mermaid-source').fill(`architecture-beta
  group api(cloud)[API]
  service db(database)[Database] in api
  service server(server)[Server] in api
  db:L -- R:server`)
  await expect(editor.page.getByTestId('mermaid-layer-count')).toContainText('editable layers', {
    timeout: 10_000
  })
  await editor.page.getByTestId('mermaid-insert').click()
  await expect(dialog).toHaveCount(0)
  await editor.canvas.waitForRender()

  const inserted = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    const owner = (page?.childIds ?? [])
      .map((id) => store.graph.getNode(id))
      .find((candidate) => {
        const source = candidate?.pluginData.find((entry) => entry.key === 'mermaid/source')?.value
        return source?.includes('architecture-beta')
      })
    const pieces = (owner?.childIds ?? []).map((id) => store.graph.getNode(id))
    return {
      ownerType: owner?.type,
      hasImageFill: pieces.some((node) => node?.fills.some((fill) => fill.type === 'IMAGE')),
      pieceCount: pieces.length,
      source: pieces[0]?.pluginData.find((entry) => entry.key === 'mermaid/source')?.value,
      types: [...new Set(pieces.flatMap((node) => (node ? [node.type] : [])))]
    }
  })

  expect(inserted.ownerType).toBe('FRAME')
  expect(inserted.hasImageFill).toBe(false)
  expect(inserted.pieceCount).toBeGreaterThan(10)
  expect(inserted.source).toContain('architecture-beta')
  expect(inserted.types).toEqual(expect.arrayContaining(['TEXT', 'VECTOR']))
  assertNoMermaidErrors()
})

test('Insert menu preserves native Mermaid Sankey gradients and blending', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Insert' }).click()
  await editor.page.getByRole('menuitem', { name: 'Mermaid diagram…', exact: true }).click()

  const dialog = editor.page.getByTestId('mermaid-import-dialog')
  await editor.page.getByTestId('mermaid-source').fill(`sankey-beta
Source,Processing,12
Source,Losses,3
Processing,Output,9
Processing,Losses,3`)
  await expect(editor.page.getByTestId('mermaid-layer-count')).toContainText('editable layers', {
    timeout: 10_000
  })
  await editor.page.getByTestId('mermaid-insert').click()
  await expect(dialog).toHaveCount(0)
  await editor.canvas.waitForRender()

  const inserted = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    const owner = (page?.childIds ?? [])
      .map((id) => store.graph.getNode(id))
      .find((candidate) =>
        candidate?.pluginData
          .find((entry) => entry.key === 'mermaid/source')
          ?.value.includes('sankey-beta')
      )
    const pieces = (owner?.childIds ?? []).flatMap((id) => {
      const node = store.graph.getNode(id)
      return node ? [node] : []
    })
    const gradientLinks = pieces.filter((node) =>
      node.strokes.some((stroke) => stroke.paint?.type === 'GRADIENT_LINEAR')
    )
    return {
      gradientLinkCount: gradientLinks.length,
      gradientStopCounts: gradientLinks.map(
        (node) => node.strokes[0]?.paint?.gradientStops?.length ?? 0
      ),
      hasImageFill: pieces.some((node) => node.fills.some((fill) => fill.type === 'IMAGE')),
      linkBlendModes: gradientLinks.map((node) => node.blendMode),
      linkOpacities: gradientLinks.map((node) => node.strokes[0]?.opacity),
      ownerType: owner?.type,
      pieceCount: pieces.length
    }
  })

  expect(inserted.ownerType).toBe('FRAME')
  expect(inserted.pieceCount).toBeGreaterThan(8)
  expect(inserted.gradientLinkCount).toBe(4)
  expect(inserted.gradientStopCounts).toEqual([2, 2, 2, 2])
  expect(inserted.linkBlendModes).toEqual(['MULTIPLY', 'MULTIPLY', 'MULTIPLY', 'MULTIPLY'])
  expect(inserted.linkOpacities).toEqual([0.5, 0.5, 0.5, 0.5])
  expect(inserted.hasImageFill).toBe(false)
  assertNoMermaidErrors()
})

test('View menu shows zoom options', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'View' }).click()
  const menu = editor.page.locator('[role="menu"]')
  await expect(menu).toBeVisible()

  const items = await menu.locator('[role="menuitem"]').allTextContents()
  expect(items.some((t) => t.includes('Zoom to fit'))).toBe(true)
  expect(items.some((t) => t.includes('Zoom in'))).toBe(true)
  expect(items.some((t) => t.includes('Zoom out'))).toBe(true)

  await editor.page.keyboard.press('Escape')
})

test('Object menu shows Group/Ungroup/Component', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Object' }).click()
  const menu = editor.page.locator('[role="menu"]')
  await expect(menu).toBeVisible()

  const items = await menu.locator('[role="menuitem"]').allTextContents()
  expect(items.some((t) => t.includes('Group'))).toBe(true)
  expect(items.some((t) => t.includes('Ungroup'))).toBe(true)
  expect(items.some((t) => t.includes('Create component'))).toBe(true)
  expect(items.some((t) => t.includes('Bring to front'))).toBe(true)
  expect(items.some((t) => t.includes('Send to back'))).toBe(true)

  await editor.page.keyboard.press('Escape')
})

function getStoreStateNumber(key: 'selectedIds' | 'zoom') {
  return editor.page.evaluate((stateKey) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    if (stateKey === 'selectedIds') return store.state.selectedIds.size
    return store.state.zoom
  }, key)
}

test('Undo via Edit menu works', async () => {
  await editor.canvas.drawRect(200, 200, 100, 100)
  const beforeUndo = await getStoreStateNumber('selectedIds')
  expect(beforeUndo).toBe(1)

  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Edit' }).click()
  await editor.page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Undo' }).click()
  await editor.canvas.waitForRender()

  const afterUndo = await getStoreStateNumber('selectedIds')
  expect(afterUndo).toBe(0)
})

test('Duplicate via Edit menu works', async () => {
  await editor.canvas.drawRect(300, 300, 80, 80)

  const countBefore = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.getChildren(store.state.currentPageId).length
  })

  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Edit' }).click()
  await editor.page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Duplicate' }).click()
  await editor.canvas.waitForRender()

  const countAfter = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.getChildren(store.state.currentPageId).length
  })

  expect(countAfter).toBe(countBefore + 1)
})

test('Zoom to fit via View menu works', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'View' }).click()
  await editor.page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Zoom in' }).click()
  await editor.canvas.waitForRender()

  const zoomBefore = await getStoreStateNumber('zoom')
  expect(zoomBefore).toBeGreaterThan(1)

  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'View' }).click()
  await editor.page.locator('[role="menu"] [role="menuitem"]', { hasText: 'Zoom to fit' }).click()
  await editor.canvas.waitForRender()

  const zoomAfter = await getStoreStateNumber('zoom')
  expect(zoomAfter).not.toBe(zoomBefore)
})
