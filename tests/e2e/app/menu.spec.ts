import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

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
  const appMenuToggle = editor.page.getByTestId('app-menu-toggle')
  if (await menubar.isVisible()) {
    await appMenuToggle.click()
    await expect(menubar).toBeHidden()
  }
  await appMenuToggle.click()
  await expect(menubar).toBeVisible()
})

test('the sidebar header is removed and Settings owns the application menu', async () => {
  const appMenuToggle = editor.page.getByTestId('app-menu-toggle')

  await expect(editor.page.getByTestId('workspace-title')).toHaveCount(0)
  await expect(appMenuToggle).toHaveAccessibleName('Settings')
  await expect(appMenuToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(editor.page.getByTestId('toolbar').getByTestId('app-menu-toggle')).toBeVisible()
  const settingsMenu = editor.page.getByTestId('app-settings-menu')
  await expect(settingsMenu).toBeVisible()

  const [menuBounds, toolbarBounds] = await Promise.all([
    settingsMenu.boundingBox(),
    editor.page.getByTestId('toolbar').boundingBox()
  ])
  if (!menuBounds || !toolbarBounds) throw new Error('Expected Settings and toolbar bounds')
  expect(menuBounds.width).toBeCloseTo(280, 0)
  expect(toolbarBounds.y - (menuBounds.y + menuBounds.height)).toBeCloseTo(10, 0)
})

test('Settings keeps only application-level menu groups', async () => {
  const triggers = editor.page.locator('[role="menubar"] [role="menuitem"]')
  const labels = (await triggers.allTextContents()).map((label) => label.trim())
  expect(labels).toEqual(['File', 'Settings'])
})

test('Settings menu keeps app preferences together', async () => {
  await editor.page.getByTestId('menubar-settings').click()
  const menu = editor.page.locator('[role="menu"]')
  await expect(menu).toBeVisible()

  const items = await menu.locator('[role="menuitem"]').allTextContents()
  expect(items.some((text) => text.includes('Theme'))).toBe(true)
  expect(items.some((text) => text.includes('Language'))).toBe(true)
  await expect(menu.getByRole('menuitem', { name: 'Cache', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitemcheckbox', { name: /profiler/i })).toBeVisible()

  await editor.page.keyboard.press('Escape')
})

test('Cache opens from Settings without occupying a sidebar tab', async () => {
  await expect(editor.page.getByTestId('left-panel-cache-tab')).toHaveCount(0)

  await editor.page.getByTestId('menubar-settings').click()
  await editor.page.getByRole('menuitem', { name: 'Cache', exact: true }).click()

  await expect(editor.page.getByTestId('model-meter-panel')).toBeVisible()
})

test('appearance exposes clean Light, Dark, and System choices', async () => {
  const light = editor.page.getByTestId('settings-theme-light')
  const dark = editor.page.getByTestId('settings-theme-dark')
  const system = editor.page.getByTestId('settings-theme-auto')

  await expect(light).toHaveAccessibleName('Light')
  await expect(dark).toHaveAccessibleName('Dark')
  await expect(system).toHaveAccessibleName('System')

  await dark.click()
  await expect(editor.page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(dark).toHaveAttribute('aria-checked', 'true')

  await light.click()
  await expect(editor.page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(light).toHaveAttribute('aria-checked', 'true')
})

test('File menu opens and shows items', async () => {
  await editor.page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' }).click()
  const menu = editor.page.locator('[role="menu"]')
  await expect(menu).toBeVisible()

  const items = await menu.locator('[role="menuitem"]').allTextContents()
  expect(items.some((t) => t.includes('Open'))).toBe(true)
  expect(items.some((t) => t.includes('Save'))).toBe(true)
  expect(items.some((t) => t.includes('Save as'))).toBe(true)
  expect(items.some((t) => t.includes('Media'))).toBe(true)
  expect(items.some((t) => t.includes('Mermaid diagram'))).toBe(true)

  await editor.page.keyboard.press('Escape')
})

test('File menu creates separate editable Mermaid pieces', async () => {
  await editor.page.getByTestId('menubar-file').click()
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
        node.type === 'GROUP' &&
        node.name === 'Mermaid · Flowchart' &&
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
  expect(inserted.ownerType).toBe('GROUP')
  expect(inserted.pieceCount).toBeGreaterThan(4)
  expect(inserted.types).toEqual(expect.arrayContaining(['TEXT', 'VECTOR']))
  expect(inserted.parentIds.every((id) => id === inserted.ownerId)).toBe(true)
  expect(inserted.selectedIds).toEqual([inserted.ownerId])
  expect(inserted.source).toContain('A[Capture]')
  expect(inserted.hasArrowhead).toBe(true)
  await expect(editor.page.getByTestId('design-panel-single')).toBeVisible()

  await editor.page.keyboard.press('Meta+z')
  await editor.canvas.waitForRender()
  expect(
    await editor.page.evaluate(
      (ids) => ids.every((id) => window.openPencil?.getStore?.().graph.getNode(id) === undefined),
      inserted.ids
    )
  ).toBe(true)
  assertNoMermaidErrors()
})

test('File menu converts Mermaid Architecture into editable native pieces', async () => {
  await editor.page.getByTestId('menubar-file').click()
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

  expect(inserted.ownerType).toBe('GROUP')
  expect(inserted.hasImageFill).toBe(false)
  expect(inserted.pieceCount).toBeGreaterThan(10)
  expect(inserted.source).toContain('architecture-beta')
  expect(inserted.types).toEqual(expect.arrayContaining(['TEXT', 'VECTOR']))
  assertNoMermaidErrors()
})

test('File menu keeps native Mermaid Sankey gradients readable on transparent boards', async () => {
  await editor.page.getByTestId('menubar-file').click()
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

  expect(inserted.ownerType).toBe('GROUP')
  expect(inserted.pieceCount).toBeGreaterThan(8)
  expect(inserted.gradientLinkCount).toBe(4)
  expect(inserted.gradientStopCounts).toEqual([2, 2, 2, 2])
  expect(inserted.linkBlendModes).toEqual(['NORMAL', 'NORMAL', 'NORMAL', 'NORMAL'])
  expect(inserted.linkOpacities).toEqual([0.5, 0.5, 0.5, 0.5])
  expect(inserted.hasImageFill).toBe(false)

  const diagramTransform = () =>
    editor.page.evaluate(() => {
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
      if (!owner) throw new Error('Sankey owner unavailable')
      const absolute = store.graph.getAbsolutePosition(owner.id)
      return {
        height: owner.height,
        screenCenterX: (absolute.x + owner.width / 2) * store.state.zoom + store.state.panX,
        screenCenterY: (absolute.y + owner.height / 2) * store.state.zoom + store.state.panY,
        screenHandleX: (absolute.x + owner.width) * store.state.zoom + store.state.panX,
        screenHandleY: (absolute.y + owner.height) * store.state.zoom + store.state.panY,
        width: owner.width,
        x: owner.x,
        y: owner.y
      }
    })

  const canvasBounds = await editor.page.getByTestId('canvas-element').boundingBox()
  if (!canvasBounds) throw new Error('Canvas bounds unavailable')
  const beforeMove = await diagramTransform()
  await editor.page.mouse.move(
    canvasBounds.x + beforeMove.screenCenterX,
    canvasBounds.y + beforeMove.screenCenterY
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(
    canvasBounds.x + beforeMove.screenCenterX + 60,
    canvasBounds.y + beforeMove.screenCenterY + 30,
    { steps: 8 }
  )
  await editor.page.mouse.up()
  await editor.canvas.waitForRender()

  const afterMove = await diagramTransform()
  expect(afterMove.x).toBeGreaterThan(beforeMove.x)
  expect(afterMove.y).toBeGreaterThan(beforeMove.y)

  await editor.page.mouse.move(
    canvasBounds.x + afterMove.screenHandleX,
    canvasBounds.y + afterMove.screenHandleY
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(
    canvasBounds.x + afterMove.screenHandleX + 80,
    canvasBounds.y + afterMove.screenHandleY + 10,
    { steps: 10 }
  )
  await editor.page.mouse.up()
  await editor.canvas.waitForRender()

  const afterResize = await diagramTransform()
  expect(afterResize.width).toBeGreaterThan(afterMove.width)
  expect(afterResize.height).toBeGreaterThan(afterMove.height)
  expect(afterResize.width / afterResize.height).toBeCloseTo(afterMove.width / afterMove.height, 2)
  assertNoMermaidErrors()
})
