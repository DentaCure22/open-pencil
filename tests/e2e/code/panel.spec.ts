import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

function codeTab() {
  return editor.page.getByTestId('sidebar-context-code')
}

function designTab() {
  return editor.page.getByTestId('sidebar-context-design')
}

function traceTab() {
  return editor.page.getByTestId('left-panel-trace-tab')
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

test('empty canvas exposes only the themed live-board start state', async () => {
  await expect(editor.page.getByTestId('html-first-canvas-welcome')).toBeVisible()
  await expect(editor.page.getByTestId('animated-dither-background')).toBeVisible()
  await expect(editor.page.getByTestId('layers-shell')).toHaveCount(0)
  await expect(editor.page.getByTestId('toolbar')).toHaveCount(0)
  await expect(editor.page.getByTestId('board-dock')).toHaveCount(0)
})

test('one-click starter creates a canonical live HTML board', async () => {
  await editor.page.getByTestId('html-first-canvas-start').click()
  await expect(editor.page.getByTestId('html-board-frame')).toBeVisible()
  await expect(editor.page.getByTestId('html-first-canvas-welcome')).toBeHidden()
  await expect(editor.page.getByTestId('html-board-code-panel')).toBeVisible()
  await expect(codeTab()).toHaveAttribute('data-state', 'active')
  await expect(editor.page.getByTestId('layers-shell')).toBeVisible()
  await expect(editor.page.getByTestId('toolbar')).toBeVisible()
  await expect(editor.page.getByTestId('board-dock')).toBeVisible()
})

test('created board exposes contextual Design and HTML plus Trace', async () => {
  await expect(editor.page.getByTestId('html-board-frame')).toBeVisible()
  await expect(designTab()).toContainText('Design')
  await expect(codeTab()).toContainText('HTML')
  await expect(traceTab()).toContainText('TRACE')
  await expect(editor.page.getByTestId('properties-tab-ai')).toHaveCount(0)
})

test('Focus keeps an HTML board visible beside the contextual sidebar', async () => {
  const startButton = editor.page.getByTestId('html-first-canvas-start')
  if (await startButton.isVisible()) await startButton.click()
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
    const leftPanel = document
      .querySelector<HTMLElement>('[data-test-id="layers-panel"]')
      ?.getBoundingClientRect()
    return {
      left: store.state.panX + absolute.x * store.state.zoom,
      leftInset: leftPanel?.width ? Math.ceil(leftPanel.right) + 14 : 440,
      right: store.state.panX + (absolute.x + board.width) * store.state.zoom,
      rightInset: 14,
      viewportWidth: globalThis.innerWidth
    }
  })
  expect(framing.left).toBeGreaterThan(framing.leftInset)
  expect(framing.right).toBeLessThan(framing.viewportWidth - framing.rightInset)
})

test('Fit flow frames horizontal states and vertical edit branches beside the sidebar', async () => {
  const startButton = editor.page.getByTestId('html-first-canvas-start')
  if (await startButton.isVisible()) await startButton.click()
  const productionId = await editor.page
    .locator('iframe[data-html-board-id]')
    .first()
    .getAttribute('data-html-board-id')
  if (!productionId) throw new Error('Production HTML board not found')

  await editor.page.getByTestId('html-board-create-branch').click()
  await editor.page.evaluate((boardId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([boardId])
    store.requestRender()
  }, productionId)
  await editor.page.getByTestId('html-board-create-flow-state').click()
  await editor.page.getByTestId('html-board-fit-workflow').click()
  await editor.canvas.waitForRender()

  const framing = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const boardIds = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-html-board-id]')]
      .map((frame) => frame.dataset.htmlBoardId ?? '')
      .filter(Boolean)
    const boards = boardIds
      .map((id) => store.graph.getNode(id))
      .filter((node) => node?.type === 'FRAME')
    const production = boards.find((board) => board?.name === 'HTML Board')
    const branch = boards.find((board) => board?.name.includes('Edit draft'))
    const nextState = boards.find((board) => board?.name.includes('Next state'))
    if (!production || !branch || !nextState)
      throw new Error('Expected three connected HTML boards')
    const screenBounds = boards.map((board) => {
      const absolute = store.graph.getAbsolutePosition(board.id)
      return {
        bottom: store.state.panY + (absolute.y + board.height) * store.state.zoom,
        left: store.state.panX + absolute.x * store.state.zoom,
        right: store.state.panX + (absolute.x + board.width) * store.state.zoom,
        top: store.state.panY + absolute.y * store.state.zoom
      }
    })
    const leftPanel = document
      .querySelector<HTMLElement>('[data-test-id="layers-panel"]')
      ?.getBoundingClientRect()
    return {
      boardCount: boards.length,
      branch: { x: branch.x, y: branch.y },
      bounds: {
        bottom: Math.max(...screenBounds.map((bounds) => bounds.bottom)),
        left: Math.min(...screenBounds.map((bounds) => bounds.left)),
        right: Math.max(...screenBounds.map((bounds) => bounds.right)),
        top: Math.min(...screenBounds.map((bounds) => bounds.top))
      },
      nextState: { x: nextState.x, y: nextState.y },
      production: { x: production.x, y: production.y },
      viewport: {
        height: globalThis.innerHeight,
        leftInset: leftPanel?.width ? Math.ceil(leftPanel.right) + 14 : 440,
        rightInset: 14,
        width: globalThis.innerWidth
      }
    }
  })
  expect(framing.boardCount).toBe(3)
  expect(framing.branch.x).toBe(framing.production.x)
  expect(framing.branch.y).toBeGreaterThan(framing.production.y)
  expect(framing.nextState.x).toBeGreaterThan(framing.production.x)
  expect(framing.nextState.y).toBe(framing.production.y)
  expect(framing.bounds.left).toBeGreaterThanOrEqual(framing.viewport.leftInset)
  expect(framing.bounds.right).toBeLessThanOrEqual(
    framing.viewport.width - framing.viewport.rightInset
  )
  expect(framing.bounds.top).toBeGreaterThanOrEqual(32)
  expect(framing.bounds.bottom).toBeLessThanOrEqual(framing.viewport.height - 72)

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.undo.undo()
    store.undo.undo()
    store.requestRender()
  })
  await expect(editor.page.getByTestId('html-board-mode-inspect')).toHaveCount(1)
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
  await editor.page.getByTestId('html-board-slot-component-select').selectOption('smylr-card-live')
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
  await editor.page.getByTestId('html-board-slot-component-select').selectOption('smylr-input-live')
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

test('a generated DropdownMenu fixture opens inside its trusted interaction viewport', async () => {
  const startButton = editor.page.getByTestId('html-first-canvas-start')
  if (await startButton.isVisible()) await startButton.click()
  await editor.page.getByTestId('html-board-create-branch').click()

  const inspectButtons = editor.page.getByTestId('html-board-mode-inspect')
  await inspectButtons.nth(1).click()
  const draftFrame = editor.page.frameLocator('iframe[data-html-board-id]').nth(1)
  await draftFrame.locator('nav').dispatchEvent('click')
  await expect(editor.page.getByTestId('html-board-slot-controls')).toContainText(
    'Navigation status'
  )
  await editor.page.getByTestId('html-board-slot-add-smylr-dropdown-menu-live').click()

  const interactButtons = editor.page.getByTestId('html-board-mode-interact')
  await interactButtons.nth(1).click()
  const liveMenuFrame = editor.page.frameLocator(
    'iframe[data-html-board-live-component-id="smylr-dropdown-menu-live-1"]'
  )
  await liveMenuFrame.getByRole('button', { name: 'Patient actions' }).click()
  await expect(liveMenuFrame.getByRole('menuitem', { name: 'Assign provider' })).toBeVisible()
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
