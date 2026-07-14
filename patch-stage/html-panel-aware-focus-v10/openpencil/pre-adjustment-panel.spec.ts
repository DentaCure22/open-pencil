import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup()

function codeTab() {
  return editor.page.getByTestId('properties-tab-code')
}

function designTab() {
  return editor.page.getByTestId('properties-tab-design')
}

function traceTab() {
  return editor.page.getByTestId('properties-tab-trace')
}

function codePanel() {
  return editor.page.getByTestId('code-panel')
}

function codePanelEmpty() {
  return editor.page.getByTestId('code-panel-empty')
}

function formatToggle() {
  return editor.page.getByTestId('code-panel-format-toggle')
}

function copyButton() {
  return editor.page.getByTestId('code-panel-copy')
}

test('right inspector exposes only Design, HTML, and Trace', async () => {
  await expect(designTab()).toContainText('Design')
  await expect(codeTab()).toContainText('HTML')
  await expect(traceTab()).toContainText('Trace')
  await expect(editor.page.getByTestId('properties-tab-ai')).toHaveCount(0)
})

test('HTML is the default inspector and exposes live creation', async () => {
  await expect(codeTab()).toHaveAttribute('data-state', 'active')
  await expect(codePanelEmpty()).toBeVisible()
  await expect(codePanelEmpty()).toContainText('Create a live HTML board')
  await expect(editor.page.getByTestId('html-first-canvas-welcome')).toBeVisible()
  await expect(editor.page.getByTestId('code-panel-create-starter')).toBeVisible()
  await expect(editor.page.getByTestId('code-panel-import-toggle')).toContainText(
    'Paste or write code'
  )
})

test('one-click starter creates a canonical live HTML board', async () => {
  await editor.page.getByTestId('html-first-canvas-start').click()
  await expect(editor.page.getByTestId('html-board-frame')).toBeVisible()
  await expect(editor.page.getByTestId('html-first-canvas-welcome')).toBeHidden()
  await expect(editor.page.getByTestId('html-board-code-panel')).toBeVisible()
  await expect(codeTab()).toHaveAttribute('data-state', 'active')
})

test('Focus keeps an HTML board visible between both side panels', async () => {
  await editor.page.getByTestId('html-first-canvas-start').click()
  await editor.page.keyboard.press('Shift+2')
  await editor.canvas.waitForRender()

  const framing = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const board = [...store.state.selectedIds]
      .map((id) => store.graph.getNode(id))
      .find((node) => node?.type === 'FRAME')
    if (!board) throw new Error('HTML board not selected')
    const absolute = store.graph.getAbsolutePosition(board.id)
    return {
      left: store.state.panX + absolute.x * store.state.zoom,
      right: store.state.panX + (absolute.x + board.width) * store.state.zoom,
      viewportWidth: globalThis.innerWidth
    }
  })
  const expectedLeft = framing.viewportWidth >= 1100 ? 280 : 232
  const expectedRight = framing.viewportWidth >= 1100 ? 300 : 232
  expect(framing.left).toBeGreaterThan(expectedLeft)
  expect(framing.right).toBeLessThan(framing.viewportWidth - expectedRight)
})

test('a controlled slot inserts a reusable HTML component into a draft revision', async () => {
  const startButton = editor.page.getByTestId('html-first-canvas-start')
  if (await startButton.isVisible()) await startButton.click()
  await editor.page.getByTestId('html-board-create-branch').click()

  const inspectButtons = editor.page.getByTestId('html-board-mode-inspect')
  await expect(inspectButtons).toHaveCount(2)
  await inspectButtons.nth(1).click()

  const draftFrame = editor.page.frameLocator('iframe[data-html-board-id]').nth(1)
  await draftFrame.locator('[data-openpencil-slot="hero-actions"]').dispatchEvent('click')

  await expect(editor.page.getByTestId('html-board-slot-controls')).toContainText('Hero controls')
  await editor.page.getByTestId('html-board-slot-component-select').selectOption('text-link')
  await editor.page.getByTestId('html-board-slot-add-selected').click()

  await expect(draftFrame.getByText('Learn more')).toBeVisible()
  await expect(editor.page.getByTestId('html-board-code-panel')).toContainText('r2 · v6')

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.undo.undo()
    store.undo.undo()
    store.requestRender()
  })
  await expect(inspectButtons).toHaveCount(1)
})

test('a live Smylr slot component keeps verified repository identity', async () => {
  const startButton = editor.page.getByTestId('html-first-canvas-start')
  if (await startButton.isVisible()) await startButton.click()
  await editor.page.getByTestId('html-board-create-branch').click()

  const inspectButtons = editor.page.getByTestId('html-board-mode-inspect')
  await inspectButtons.nth(1).click()
  const draftFrame = editor.page.frameLocator('iframe[data-html-board-id]').nth(1)
  await draftFrame.locator('[data-openpencil-slot="hero-actions"]').dispatchEvent('click')
  await editor.page
    .getByTestId('html-board-slot-component-select')
    .selectOption('smylr-button-live')
  await editor.page.getByTestId('html-board-slot-add-selected').click()

  const placeholderFrame = draftFrame.locator('iframe[data-openpencil-live-component="true"]')
  await expect(placeholderFrame).not.toHaveAttribute('src', /./)
  const liveFrame = editor.page.locator(
    'iframe[data-html-board-live-component-id="smylr-button-live-1"]'
  )
  await expect(liveFrame).toHaveAttribute(
    'src',
    'http://localhost:3000/open-pencil-renderer?component=button&embed=1'
  )
  await expect(
    draftFrame.locator('[data-openpencil-registry-id="smylr-button-live"]')
  ).toHaveAttribute('data-openpencil-source-file', 'src/components/ui/button.tsx')

  const interactButtons = editor.page.getByTestId('html-board-mode-interact')
  await expect(interactButtons).toHaveCount(2)
  await interactButtons.nth(1).click()
  await expect(liveFrame).toHaveClass(/pointer-events-auto/)

  await editor.page.getByTestId('html-board-workflow-more').click()
  await editor.page.getByTestId('html-board-request-review').click()
  await editor.page.getByTestId('html-board-mark-preferred').click()
  await expect(editor.page.getByTestId('html-board-source-verified')).toContainText('Verified')
  await expect(editor.page.getByTestId('html-board-code-panel')).toContainText(
    'Smylr-Elite/src/components/ui/button.tsx'
  )

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    for (let index = 0; index < 4; index += 1) store.undo.undo()
    store.requestRender()
  })
  await expect(inspectButtons).toHaveCount(1)
})

test('the expanded Smylr catalog mounts a non-action fixture with exact source identity', async () => {
  const startButton = editor.page.getByTestId('html-first-canvas-start')
  if (await startButton.isVisible()) await startButton.click()
  await editor.page.getByTestId('html-board-create-branch').click()

  const inspectButtons = editor.page.getByTestId('html-board-mode-inspect')
  await inspectButtons.nth(1).click()
  const draftFrame = editor.page.frameLocator('iframe[data-html-board-id]').nth(1)
  await draftFrame.locator('#content').dispatchEvent('click')
  await expect(editor.page.getByTestId('html-board-slot-controls')).toContainText('Hero content')
  await editor.page
    .getByTestId('html-board-slot-component-select')
    .selectOption('smylr-card-live')
  await editor.page.getByTestId('html-board-slot-add-selected').click()

  const liveFrame = editor.page.locator(
    'iframe[data-html-board-live-component-id="smylr-card-live-1"]'
  )
  await expect(liveFrame).toHaveAttribute(
    'src',
    'http://localhost:3000/open-pencil-renderer?component=card&embed=1'
  )
  await expect(
    draftFrame.locator('[data-openpencil-registry-id="smylr-card-live"]')
  ).toHaveAttribute('data-openpencil-source-file', 'src/components/ui/card.tsx')

  await editor.page.getByTestId('html-board-workflow-more').click()
  await editor.page.getByTestId('html-board-request-review').click()
  await editor.page.getByTestId('html-board-mark-preferred').click()
  await expect(editor.page.getByTestId('html-board-source-verified')).toContainText('Verified')
  await expect(editor.page.getByTestId('html-board-code-panel')).toContainText(
    'Smylr-Elite/src/components/ui/card.tsx'
  )

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    for (let index = 0; index < 4; index += 1) store.undo.undo()
    store.requestRender()
  })
  await expect(inspectButtons).toHaveCount(1)
})

test('a generated Input fixture stays interactive without mutating its design revision', async () => {
  const startButton = editor.page.getByTestId('html-first-canvas-start')
  if (await startButton.isVisible()) await startButton.click()
  await editor.page.getByTestId('html-board-create-branch').click()

  const inspectButtons = editor.page.getByTestId('html-board-mode-inspect')
  await inspectButtons.nth(1).click()
  const draftFrame = editor.page.frameLocator('iframe[data-html-board-id]').nth(1)
  await draftFrame.locator('[data-openpencil-slot="hero-actions"]').dispatchEvent('click')
  await editor.page
    .getByTestId('html-board-slot-component-select')
    .selectOption('smylr-input-live')
  await editor.page.getByTestId('html-board-slot-add-selected').click()

  const interactButtons = editor.page.getByTestId('html-board-mode-interact')
  await interactButtons.nth(1).click()
  const liveInputFrame = editor.page.frameLocator(
    'iframe[data-html-board-live-component-id="smylr-input-live-1"]'
  )
  await liveInputFrame.getByLabel('Patient search').fill('Maya')
  await expect(liveInputFrame.getByLabel('Patient search')).toHaveValue('Maya')
  await expect(editor.page.getByTestId('html-board-code-panel')).toContainText('r2 · v6')

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.undo.undo()
    store.undo.undo()
    store.requestRender()
  })
  await expect(inspectButtons).toHaveCount(1)
})

test('selecting a rectangle shows JSX code', async () => {
  await editor.canvas.drawRect(420, 120, 200, 150)
  await editor.canvas.waitForRender()

  await expect(codePanel()).toBeVisible()

  const code = await codePanel().textContent()
  expect(code).toContain('Rectangle')
})

test('format toggle switches between OpenPencil and Tailwind', async () => {
  await expect(formatToggle()).toBeVisible()

  const initialFormat = await formatToggle().textContent()
  expect(initialFormat).toContain('OpenPencil')

  await formatToggle().click()
  await expect(formatToggle()).toContainText('Tailwind')

  const code = await codePanel().textContent()
  expect(code).toContain('div')

  await formatToggle().click()
  await expect(formatToggle()).toContainText('OpenPencil')
})

test('copy button works and shows confirmation', async () => {
  await copyButton().click()

  await expect(copyButton()).toContainText('Copied')

  await editor.page.waitForTimeout(2500)
  await expect(copyButton()).toContainText('Copy')
})

test('deselecting shows empty state again', async () => {
  await editor.page.keyboard.press('Escape')
  await editor.canvas.waitForRender()

  await expect(codePanelEmpty()).toBeVisible()
})

test('selecting a frame shows Frame in JSX', async () => {
  // Create a frame via store to avoid click-targeting issues
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('FRAME', 300, 100, 200, 200)
    store.select([id])
  })
  await editor.canvas.waitForRender()

  const code = await codePanel().textContent()
  expect(code).toContain('Frame')
})

test('switching back to Design tab works', async () => {
  await designTab().click()

  await expect(
    editor.page
      .getByTestId('design-panel-single')
      .or(editor.page.getByTestId('design-panel-empty'))
      .first()
  ).toBeVisible()
})

test('shows import errors in the Code panel', async () => {
  await codeTab().click()
  await editor.page.getByTestId('code-panel-import-toggle').click()
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const importDOMText = store.importDOMText
    store.importDOMText = async () => {
      store.importDOMText = importDOMText
      throw new Error('CSS import failed')
    }
  })

  await editor.page.getByTestId('code-panel-import-html').fill('<div class="card">Broken DOM</div>')
  await editor.page.getByTestId('code-panel-import').click()

  await expect(editor.page.getByTestId('code-panel-import-error')).toBeVisible()
  await expect(editor.page.getByTestId('code-panel-import-error')).toContainText(
    'CSS import failed'
  )

  await editor.page.getByTestId('code-panel-import-html').fill('<div class="card">Recovered</div>')
  await expect(editor.page.getByTestId('code-panel-import-error')).toBeHidden()
  await editor.page.getByTestId('code-panel-import-toggle').click()
})

test('imports HTML and CSS into the canvas', async () => {
  await codeTab().click()
  await editor.page.getByTestId('code-panel-import-toggle').click()
  await editor.page.getByTestId('code-panel-import-html').fill('<div class="card">Hello DOM</div>')
  await editor.page
    .getByTestId('code-panel-import-css')
    .fill('.card { width: 240px; height: 120px; padding: 16px; background: #ffffff; }')
  await editor.page.getByTestId('code-panel-import').click()
  await editor.page.waitForFunction(() => {
    const store = window.openPencil?.getStore?.()
    return store?.graph.getAllNodes().some((node) => node.name.includes('Hello DOM'))
  })
  await editor.canvas.waitForRender()

  const imported = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.getAllNodes().some((node) => node.name.includes('Hello DOM'))
  })
  expect(imported).toBe(true)
})
