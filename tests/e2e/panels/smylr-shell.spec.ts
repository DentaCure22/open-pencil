import type { Rect } from '@open-pencil/core'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { toolbarToolTestId } from '#tests/helpers/test-ids'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

function centerX(bounds: Rect | null) {
  expect(bounds).not.toBeNull()
  if (!bounds) throw new Error('Expected visible element bounds')
  return bounds.x + bounds.width / 2
}

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

let selectedTestNodeId = ''

test('Smylr keeps the animated dither behind working-canvas content', async () => {
  const dither = editor.page.getByTestId('animated-dither-background')
  const scene = editor.page.getByTestId('scene-canvas-element')
  await expect(dither).toBeVisible()
  await expect(dither).toHaveAttribute('data-presentation', 'overlay')
  await expect(editor.page.getByTestId('smylr-live-app-embed')).toBeVisible()
  const [ditherZIndex, sceneZIndex] = await Promise.all(
    [dither, scene].map((element) =>
      element.evaluate((node) => Number.parseInt(getComputedStyle(node).zIndex, 10))
    )
  )
  expect(ditherZIndex).toBeLessThan(sceneZIndex)
})

test('frame-mode wheel zoom works over the live app surface', async () => {
  const surface = editor.page.getByTestId('smylr-live-frame-enter-interact')
  await expect(surface).toBeVisible()
  const bounds = await surface.boundingBox()
  if (!bounds) throw new Error('Expected live app frame surface bounds')
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

test('disconnected live app keeps trackpad pan and pinch on the board', async () => {
  const enterSurface = editor.page.getByTestId('smylr-live-frame-enter-interact')
  await expect(enterSurface).toBeVisible()
  await enterSurface.click()

  const navigationSurface = editor.page.getByTestId('smylr-live-disconnected-navigation-surface')
  await expect(navigationSurface).toBeVisible()
  const bounds = await navigationSurface.boundingBox()
  if (!bounds) throw new Error('Expected disconnected live app navigation surface bounds')

  const beforePan = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return { panX: store.state.panX, panY: store.state.panY }
  })
  await editor.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await editor.page.mouse.wheel(60, 40)
  await expect
    .poll(async () => {
      const afterPan = await editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return { panX: store.state.panX, panY: store.state.panY }
      })
      return afterPan.panX < beforePan.panX && afterPan.panY < beforePan.panY
    })
    .toBe(true)

  const beforeZoom = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.zoom
  })
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
    .toBeLessThan(beforeZoom)
})

test('floating editor chrome follows light and dark themes', async () => {
  const chrome = [
    editor.page.getByTestId('layers-shell'),
    editor.page.getByTestId('toolbar'),
    editor.page.getByTestId('board-dock-shell')
  ]
  const readChrome = () =>
    Promise.all(
      chrome.map((element) => element.evaluate((node) => getComputedStyle(node).backgroundColor))
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

  expect(new Set(lightChrome).size).toBe(1)
  expect(new Set(darkChrome).size).toBe(1)
  expect(lightChrome[0]).not.toBe(darkChrome[0])
  expect(lightUtilityTabs).not.toBe(darkUtilityTabs)
  expect(darkUtilityTabs).toBe('rgba(0, 0, 0, 0.3)')
})

test('live app frames use calm theme-aware separation without native scene effects', async () => {
  const surface = editor.page.getByTestId('smylr-live-frame-surface')
  await expect(surface).toBeVisible()
  await expect(surface).toHaveClass(/shadow-\[var\(--shadow-live-frame\)\]/)
  await expect(surface).not.toHaveClass(/shadow-lg/)

  const shadowForTheme = (theme: 'dark' | 'light') =>
    surface.evaluate((element, nextTheme) => {
      document.documentElement.dataset.theme = nextTheme
      return getComputedStyle(element).boxShadow
    }, theme)

  const darkShadow = await shadowForTheme('dark')
  const lightShadow = await shadowForTheme('light')
  expect(darkShadow).toContain('0px 2px 6px')
  expect(lightShadow).toContain('0px 1px 4px')
  expect(lightShadow).not.toBe(darkShadow)

  const liveFramePaint = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = [...store.graph.getAllNodes()].find((node) =>
      node.pluginData.some(
        (entry) =>
          entry.pluginId === 'smylr-production' &&
          entry.key === 'kind' &&
          entry.value === 'live-app-frame'
      )
    )
    if (!frame) throw new Error('Smylr live frame not initialized')
    return {
      effects: frame.effects.length,
      fills: frame.fills.length,
      strokes: frame.strokes.length
    }
  })
  expect(liveFramePaint).toEqual({ effects: 0, fills: 0, strokes: 0 })
})

async function createSelectedTestNode() {
  selectedTestNodeId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = store.createShape('RECTANGLE', 40, 40, 120, 80)
    store.select([id])
    return id
  })
}

async function selectTestNode() {
  if (!selectedTestNodeId) throw new Error('Expected the sidebar test node to exist')
  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([id])
  }, selectedTestNodeId)
}

test('Smylr keeps the complete Design toolset above the selected utility', async () => {
  await createSelectedTestNode()
  await expect
    .poll(() =>
      editor.page.evaluate(() => window.openPencil?.getStore?.()?.state.selectedIds.size ?? 0)
    )
    .toBe(1)
  await expect(editor.page.getByTestId('sidebar-context-slot')).toHaveAttribute(
    'data-state',
    'open'
  )
  await expect(editor.page.getByTestId('design-panel-single')).toBeVisible()
  await expect(editor.page.getByTestId('sidebar-context-header')).toHaveCount(0)
  await expect(editor.page.getByTestId('close-sidebar-context')).toHaveCount(0)
  await expect(editor.page.getByTestId('design-node-type')).toBeVisible()
  await expect(editor.page.getByTestId('design-node-size')).toBeVisible()
  await expect(editor.page.getByTestId('design-node-name')).toBeVisible()
  await expect(editor.page.getByText('Select a container in Layers or on the canvas.')).toHaveCount(
    0
  )

  const designPanel = editor.page.getByTestId('design-panel-single')
  for (const section of [
    'Position',
    'Layout',
    'Appearance',
    'Fill',
    'Stroke',
    'Effects',
    'Export'
  ]) {
    await expect(designPanel.getByText(section, { exact: true })).toBeVisible()
  }

  const contextInspectorBounds = await editor.page
    .getByTestId('sidebar-context-inspector')
    .boundingBox()
  expect(contextInspectorBounds?.height).toBeGreaterThan(250)
  expect(contextInspectorBounds?.height).toBeLessThan(450)
  await expect(editor.page.getByTestId('layers-tree')).toBeVisible()
})

test('Smylr falls back to Layers when Design has no context', async () => {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.clearSelection()
  })

  await expect(editor.page.getByTestId('sidebar-context-inspector')).toHaveCount(0)
  await expect(editor.page.getByTestId('layers-scroll')).toBeVisible()
  const utilityAreaBounds = await editor.page.getByTestId('left-panel-utility-area').boundingBox()
  const utilityTabs = [
    editor.page.getByTestId('left-panel-layers-tab'),
    editor.page.getByTestId('left-panel-assets-tab'),
    editor.page.getByTestId('left-panel-trace-tab')
  ]
  const utilityTabBounds = await Promise.all(utilityTabs.map((tab) => tab.boundingBox()))
  const layersTabBounds = utilityTabBounds[0]
  expect(layersTabBounds?.y).toBeCloseTo((utilityAreaBounds?.y ?? 0) + 8, 0)
  expect(layersTabBounds?.height).toBeCloseTo(32, 0)

  await editor.page.getByTestId('left-panel-layers-tab').click()
  await expect(editor.page.getByTestId('left-panel-layers-tab')).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(editor.page.getByTestId('layers-scroll')).toBeVisible()

  await selectTestNode()

  await expect(editor.page.getByTestId('sidebar-context-inspector')).toBeVisible()
  await expect(editor.page.getByTestId('sidebar-context-inspector')).toHaveAttribute(
    'data-split',
    'true'
  )
  await expect(editor.page.getByTestId('layers-scroll')).toBeVisible()
  for (const [index, utilityTab] of utilityTabs.entries()) {
    await expect
      .poll(async () => (await utilityTab.boundingBox())?.y ?? 0)
      .toBeGreaterThan((utilityTabBounds[index]?.y ?? 0) + 200)
  }
})

test('Smylr keeps Design above Layers, Assets, and Trace', async () => {
  const contextInspector = editor.page.getByTestId('sidebar-context-inspector')
  const utilityViews = [
    { panel: 'layers-tree', trigger: 'left-panel-layers-tab' },
    { panel: 'assets-panel', trigger: 'left-panel-assets-tab' }
  ]

  for (const utility of utilityViews) {
    const trigger = editor.page.getByTestId(utility.trigger)
    if ((await trigger.getAttribute('data-state')) !== 'active') await trigger.click()
    await expect(contextInspector).toBeVisible()
    await expect(contextInspector).toHaveAttribute('data-split', 'true')
    await expect(editor.page.getByTestId(utility.panel)).toBeVisible()

    await expect
      .poll(async () => (await contextInspector.boundingBox())?.height ?? 0)
      .toBeLessThan(450)
    const contextBounds = await contextInspector.boundingBox()
    expect(contextBounds?.height).toBeGreaterThan(250)
  }

  await editor.page.getByTestId('left-panel-trace-tab').click()
  await expect(contextInspector).toBeVisible()
  await expect(contextInspector).toHaveAttribute('data-split', 'true')
  await expect(editor.page.getByTestId('sidebar-context-slot')).toHaveAttribute(
    'data-state',
    'open'
  )
  await expect(editor.page.getByTestId('narrated-trace-panel')).toBeVisible()
  const contextBounds = await contextInspector.boundingBox()
  const traceTabBounds = await editor.page.getByTestId('left-panel-trace-tab').boundingBox()
  expect(traceTabBounds?.y).toBeGreaterThan(contextBounds?.y ?? 0)

  await editor.page.getByTestId('left-panel-trace-tab').click()
  await expect(editor.page.getByTestId('left-panel-trace-tab')).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(contextInspector).toBeVisible()

  await editor.page.getByTestId('left-panel-layers-tab').click()
  await expect(contextInspector).toHaveAttribute('data-split', 'true')
  await expect(editor.page.getByTestId('design-panel-single')).toBeVisible()
  await expect(editor.page.getByTestId('layers-tree')).toBeVisible()
})

test('Smylr switches utilities without competing panel animations', async () => {
  const contextSlot = editor.page.getByTestId('sidebar-context-slot')
  const layersTrigger = editor.page.getByTestId('left-panel-layers-tab')
  const layersContent = editor.page.getByTestId('left-panel-layers-content')
  const assetsTrigger = editor.page.getByTestId('left-panel-assets-tab')
  const assetsContent = editor.page.getByTestId('left-panel-assets-content')

  await expect(contextSlot).toHaveAttribute('data-state', 'open')
  expect(
    await contextSlot.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        duration: style.transitionDuration,
        properties: style.transitionProperty
      }
    })
  ).toEqual({ duration: '0.2s', properties: 'flex-grow, opacity' })

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

test('Smylr centers both floating controls on the usable canvas', async () => {
  const canvasChromeArea = editor.page.getByTestId('canvas-chrome-area')
  const sidebarSplitter = editor.page.getByTestId('layers-splitter-panel')
  const toolbar = editor.page.getByTestId('toolbar')
  const dock = editor.page.getByTestId('board-dock')

  await expect(dock.getByTestId('board-dock-shell')).toHaveAttribute('data-dock-layout', 'unified')
  await expect(dock.getByTestId('board-dock-trace-center')).toHaveCount(0)
  await expect(dock.getByRole('button', { name: 'Open Trace history' })).toHaveCount(0)

  const sidebarSplitterBounds = await sidebarSplitter.boundingBox()
  const canvasChromeBounds = await canvasChromeArea.boundingBox()
  const toolbarBounds = await toolbar.boundingBox()
  const dockBounds = await dock.boundingBox()
  const canvasChromeCenter = centerX(canvasChromeBounds)
  const toolbarCenter = centerX(toolbarBounds)
  const dockCenter = centerX(dockBounds)

  expect(sidebarSplitterBounds).not.toBeNull()
  expect(toolbarCenter).toBeCloseTo(canvasChromeCenter, 0)
  expect(dockCenter).toBeCloseTo(canvasChromeCenter, 0)
  expect(dockCenter).toBeCloseTo(toolbarCenter, 0)

  await editor.page.getByRole('button', { name: 'Close sidebar' }).click()
  await expect
    .poll(
      async () =>
        (await editor.page.getByTestId('layers-splitter-panel').boundingBox())?.width ?? 999
    )
    .toBeLessThanOrEqual(1)

  const canvasChromeAfterClose = await canvasChromeArea.boundingBox()
  const toolbarAfterClose = await toolbar.boundingBox()
  const dockAfterClose = await dock.boundingBox()
  const canvasChromeCenterAfterClose = centerX(canvasChromeAfterClose)

  expect(centerX(toolbarAfterClose)).toBeCloseTo(canvasChromeCenterAfterClose, 0)
  expect(centerX(dockAfterClose)).toBeCloseTo(canvasChromeCenterAfterClose, 0)
  expect(centerX(toolbarAfterClose)).not.toBeCloseTo(toolbarCenter, 0)
  expect(centerX(dockAfterClose)).not.toBeCloseTo(dockCenter, 0)

  await editor.page.getByTestId('open-layers-panel').click()
  await expect
    .poll(async () => (await sidebarSplitter.boundingBox())?.width ?? 0)
    .toBeGreaterThan((sidebarSplitterBounds?.width ?? 0) - 2)
})

test('Board dock keeps Workspace inside one unified shell', async () => {
  const dock = editor.page.getByTestId('board-dock')
  const dockShell = dock.getByTestId('board-dock-shell')
  const workspaceButton = dock.getByRole('button', { name: 'Workspace' })

  await expect(dockShell).toHaveCount(1)
  await expect(dockShell).toHaveAttribute('data-dock-layout', 'unified')
  await expect(workspaceButton).toHaveAttribute('data-dock-group', 'workspace')
  await expect(dock.getByTestId('board-dock-left-shell')).toHaveCount(0)
  await expect(dock.getByTestId('board-dock-right-shell')).toHaveCount(0)
  await expect(dock.getByTestId('board-dock-utility-divider')).toBeVisible()

  const unifiedDockComposition = await dockShell.evaluate((shell) => {
    const divider = shell.querySelector('[data-test-id="board-dock-utility-divider"]')
    const workspace = shell.querySelector('[data-test-id="board-dock-more"]')
    const interactiveItems = shell.querySelectorAll('button')
    return {
      dividerImmediatelyPrecedesWorkspace: divider?.nextElementSibling === workspace,
      workspaceAtEnd: interactiveItems.item(interactiveItems.length - 1) === workspace,
      workspaceInsideShell: workspace?.closest('[data-test-id="board-dock-shell"]') === shell
    }
  })
  expect(unifiedDockComposition).toEqual({
    dividerImmediatelyPrecedesWorkspace: true,
    workspaceAtEnd: true,
    workspaceInsideShell: true
  })

  await workspaceButton.click()
  await expect(editor.page.getByTestId('board-project-browser')).toBeVisible()
  await editor.page.keyboard.press('Escape')
  await expect(editor.page.getByTestId('board-project-browser')).toBeHidden()
})

test('Smylr uses one contextual sidebar with top tools and a bottom board dock', async () => {
  await letAppReceivePointerEvents()
  await expect(editor.page.getByTestId('properties-panel')).toHaveCount(0)
  await expect(editor.page.getByTestId('left-panel-layers-tab')).toBeVisible()
  await expect(editor.page.getByTestId('left-panel-assets-tab')).toBeVisible()
  await expect(editor.page.getByTestId('left-panel-trace-tab')).toBeVisible()
  await expect(editor.page.getByTestId('left-panel-layers-tab')).toHaveText('LAYERS')
  await expect(editor.page.getByTestId('left-panel-assets-tab')).toHaveText('ASSETS')
  await expect(editor.page.getByTestId('left-panel-trace-tab')).toHaveText('TRACE')

  const utilityTabs = [
    editor.page.getByTestId('left-panel-layers-tab'),
    editor.page.getByTestId('left-panel-assets-tab'),
    editor.page.getByTestId('left-panel-trace-tab')
  ]
  const utilityBounds = await Promise.all(utilityTabs.map((tab) => tab.boundingBox()))
  expect(utilityBounds.every((bounds) => bounds?.y === utilityBounds[0]?.y)).toBe(true)
  expect(utilityBounds[0]?.x).toBeLessThan(utilityBounds[1]?.x ?? 0)
  expect(utilityBounds[1]?.x).toBeLessThan(utilityBounds[2]?.x ?? 0)
  if ((await utilityTabs[0].getAttribute('data-state')) !== 'active') {
    await utilityTabs[0].click()
  }
  await expect(utilityTabs[0]).toHaveAttribute('data-state', 'active')
  await expect(utilityTabs[1]).toHaveAttribute('data-state', 'inactive')
  await expect(editor.page.getByTestId('left-panel-utility-area')).toBeVisible()
  await expect
    .poll(async () => {
      const [utilityAreaBounds, selectedTabBounds] = await Promise.all([
        editor.page.getByTestId('left-panel-utility-area').boundingBox(),
        utilityTabs[0].boundingBox()
      ])
      return Math.round((selectedTabBounds?.y ?? 0) - (utilityAreaBounds?.y ?? 0))
    })
    .toBe(8)
  expect(utilityBounds[0]?.height).toBeCloseTo(32, 0)

  const toolbar = editor.page.getByTestId('toolbar')
  const toolbarBounds = await toolbar.boundingBox()
  expect(toolbarBounds?.y).toBeLessThan(80)
  await expect(toolbar).toHaveClass(/rounded-\[14px\]/)
  await expect(toolbar).toHaveClass(/border-chrome-border/)
  const collaboration = toolbar.getByTestId('toolbar-collaboration')
  await expect(collaboration).toBeVisible()
  await expect(toolbar.getByTestId('collab-local-avatar')).toBeVisible()
  await expect(toolbar.getByTestId('collab-share-button')).toHaveAccessibleName('Share')
  await expect(toolbar.getByTestId('narrated-trace-ink-tool')).toBeVisible()
  await expect(toolbar.getByTestId('narrated-trace-start')).toHaveCount(0)
  await expect(toolbar.locator('span.h-6.w-px')).toHaveCount(1)
  expect(
    await collaboration.evaluate((element) => {
      const separator = element.previousElementSibling
      return (
        separator?.tagName === 'SPAN' &&
        separator.classList.contains('w-px') &&
        separator.classList.contains('self-center')
      )
    })
  ).toBe(true)
  await expect(toolbar.locator('.border-l')).toHaveCount(0)

  const dock = editor.page.getByTestId('board-dock')
  const dockBounds = await dock.boundingBox()
  expect(dockBounds?.y).toBeGreaterThan(650)
  const dockShell = dock.getByTestId('board-dock-shell')
  const moreProjects = dock.getByRole('button', { name: 'Workspace' })
  await expect(moreProjects).toBeVisible()
  const currentBoardButton = dock.getByRole('button').first()
  await expect(currentBoardButton.locator('span[aria-hidden="true"]')).toHaveCount(0)
  await expect(currentBoardButton).not.toHaveClass(/bg-white/)
  const currentBoardTitle = (await currentBoardButton.getAttribute('aria-label'))?.replace(
    /^Open /u,
    ''
  )
  expect(currentBoardTitle).toBeTruthy()
  await expect(currentBoardButton.locator('..')).toHaveAttribute('data-tooltip-delay', '0')
  const currentBoardBoundsBeforeHover = await currentBoardButton.boundingBox()
  await letAppReceivePointerEvents()
  await currentBoardButton.dispatchEvent('pointerover')
  await expect(editor.page.getByRole('tooltip')).toHaveText(currentBoardTitle ?? '', {
    timeout: 500
  })
  const currentBoardBoundsAfterHover = await currentBoardButton.boundingBox()
  expect(currentBoardBoundsAfterHover).toEqual(currentBoardBoundsBeforeHover)
  await expect(dockShell).toHaveAttribute('data-dock-padding', '8')
  await expect(dockShell).toHaveCSS('--dock-gap', '8px')
  await expect(dockShell).toHaveCSS('--dock-divider-margin', '6px')

  const boardTileStyle = await dock
    .getByTestId('board-dock-board-tile')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        height: style.height,
        width: style.width
      }
    })
  const moreTileStyle = await dock.getByTestId('board-dock-more-tile').evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      height: style.height,
      width: style.width
    }
  })
  expect(moreTileStyle.backgroundColor).toBe(boardTileStyle.backgroundColor)
  expect(moreTileStyle.borderColor).toBe(boardTileStyle.borderColor)
  expect(moreTileStyle.borderRadius).toBe(boardTileStyle.borderRadius)
  expect(moreTileStyle.height).toBe(boardTileStyle.height)
  expect(moreTileStyle.width).toBe(boardTileStyle.width)

  await letAppReceivePointerEvents()
  await moreProjects.hover()
  await editor.page.waitForTimeout(200)
  const hoveredMoreTileStyle = await dock
    .getByTestId('board-dock-more-tile')
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor
      }
    })
  const restingBoardTileStyle = await dock
    .getByTestId('board-dock-board-tile')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor
      }
    })
  expect(hoveredMoreTileStyle).toEqual({
    backgroundColor: restingBoardTileStyle.backgroundColor,
    borderColor: restingBoardTileStyle.borderColor
  })

  const toolbarRadius = await toolbar.evaluate((element) => getComputedStyle(element).borderRadius)
  const dockRadius = await dockShell.evaluate((element) => getComputedStyle(element).borderRadius)
  const toolbarControlRadius = await toolbar
    .getByTestId(toolbarToolTestId('SELECT'))
    .evaluate((element) => getComputedStyle(element).borderRadius)
  expect(dockRadius).toBe(toolbarRadius)
  expect(boardTileStyle.borderRadius).toBe(toolbarControlRadius)

  const dockPadding = await dockShell.evaluate((element) => {
    const style = getComputedStyle(element)
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
  })
  const toolbarPadding = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element)
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
  })
  expect(dockPadding).toEqual(['8px', '8px', '8px', '8px'])
  expect(toolbarPadding).toEqual(['4px', '4px', '4px', '4px'])

  await editor.page.getByRole('button', { name: 'Close sidebar' }).click()

  await editor.page.getByTestId('open-layers-panel').click()

  await editor.page.getByTestId('left-panel-trace-tab').click()
  await expect(editor.page.getByTestId('sidebar-context-inspector')).toHaveCount(0)
  await expect(editor.page.getByTestId('narrated-trace-panel')).toBeVisible()
})

test('board dock keeps three recent unpinned Boards in stable warm slots', async () => {
  test.setTimeout(30_000)
  await letAppReceivePointerEvents()

  const dock = editor.page.getByTestId('board-dock')
  const currentPageId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.currentPageId
  })
  const moreProjects = dock.getByTestId('board-dock-more')
  await moreProjects.click()
  const projectBrowser = editor.page.getByTestId('board-project-browser')
  await projectBrowser.getByTestId('board-switcher-manage').click()
  const currentPin = projectBrowser.getByTestId(`board-pin-${currentPageId}`)
  const currentPinLabel = await currentPin.getAttribute('aria-label')
  await currentPin.click({ force: true })
  if (currentPinLabel?.startsWith('Remove')) await currentPin.click({ force: true })
  await moreProjects.click()

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

  const warmSection = dock.getByTestId('board-dock-recents')
  await expect(warmSection.getByRole('button')).toHaveCount(3)
  const warmOrder = await warmSection
    .locator('button')
    .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-test-id')))

  const firstWarmBoard = dock.getByTestId(`board-dock-board-${warmPageIds[0]}`)
  await firstWarmBoard.dispatchEvent('click')
  const activeBoardDot = firstWarmBoard.locator('span[aria-hidden="true"]')
  await expect(activeBoardDot).toBeVisible()
  const activeBoardTile = firstWarmBoard.getByTestId('board-dock-board-tile')
  const [activeBoardDotBox, activeBoardTileBox] = await Promise.all([
    activeBoardDot.boundingBox(),
    activeBoardTile.boundingBox()
  ])
  expect(activeBoardDotBox).not.toBeNull()
  expect(activeBoardTileBox).not.toBeNull()
  if (activeBoardDotBox && activeBoardTileBox) {
    const activeBoardDotGap =
      activeBoardDotBox.y - (activeBoardTileBox.y + activeBoardTileBox.height)
    expect(activeBoardDotGap).toBeGreaterThanOrEqual(2.5)
  }
  await expect
    .poll(() =>
      warmSection
        .locator('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-test-id')))
    )
    .toEqual(warmOrder)

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

test('board dock supports Mac-style pin, close, and pinned Board reordering', async () => {
  test.setTimeout(30_000)
  await letAppReceivePointerEvents()

  const dock = editor.page.getByTestId('board-dock')
  const currentPageId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.currentPageId
  })
  const moreProjects = dock.getByTestId('board-dock-more')
  await moreProjects.click()
  const projectBrowser = editor.page.getByTestId('board-project-browser')
  const manageBoards = projectBrowser.getByTestId('board-switcher-manage')
  if (await manageBoards.isVisible()) await manageBoards.click()
  const currentPin = projectBrowser.getByTestId(`board-pin-${currentPageId}`)
  if ((await currentPin.getAttribute('aria-label'))?.startsWith('Add')) {
    await currentPin.click({ force: true })
  }
  await moreProjects.click()

  const { originalPageId, openPageIds } = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const originalPageId = store.state.currentPageId
    const openPageIds: string[] = []
    for (const name of ['Mac Dock Board A', 'Mac Dock Board B', 'Mac Dock Board C']) {
      const pageId = store.addPage(name)
      openPageIds.push(pageId)
      await store.switchPage(pageId)
    }
    return { openPageIds, originalPageId }
  })
  const [boardAId, boardBId] = openPageIds
  if (!boardAId || !boardBId) throw new Error('Expected dock test boards')

  const warmSection = dock.getByTestId('board-dock-recents')
  await expect(dock.getByTestId(`board-dock-board-${boardAId}`)).toBeVisible()
  await expect(dock.getByTestId(`board-dock-board-${boardBId}`)).toBeVisible()
  await expect(warmSection.locator('span[aria-hidden="true"]')).toHaveCount(3)

  async function pinFromContextMenu(boardPageId: string) {
    const board = dock.getByTestId(`board-dock-board-${boardPageId}`)
    await board.dispatchEvent('contextmenu')
    await editor.page.getByTestId(`board-dock-pin-${boardPageId}`).dispatchEvent('click')
    await expect(board).toHaveAttribute('data-dock-group', 'pins')
  }

  await pinFromContextMenu(boardAId)
  await pinFromContextMenu(boardBId)

  const pinnedSection = dock.getByTestId('board-dock-pins')
  await expect(dock.getByTestId('board-dock-section-divider')).toBeVisible()
  await expect(dock.getByTestId('board-dock-utility-divider')).toBeVisible()

  const pinnedBoardA = dock.getByTestId(`board-dock-board-${boardAId}`)
  const pinnedBoardB = dock.getByTestId(`board-dock-board-${boardBId}`)
  await expect(pinnedBoardA.locator('span[aria-hidden="true"]')).toBeVisible()
  await expect(pinnedBoardB.locator('span[aria-hidden="true"]')).toBeVisible()

  await editor.page.locator('[data-testid="react-grab-overlay"]').evaluateAll((overlays) => {
    for (const overlay of overlays) overlay.remove()
  })
  await pinnedBoardA.dragTo(pinnedBoardB, { targetPosition: { x: 34, y: 18 } })
  await expect
    .poll(async () => {
      const order = await pinnedSection
        .locator('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('data-test-id')))
      return (
        order.indexOf(`board-dock-board-${boardAId}`) >
        order.indexOf(`board-dock-board-${boardBId}`)
      )
    })
    .toBe(true)

  await pinnedBoardB.dispatchEvent('contextmenu')
  await editor.page.getByTestId(`board-dock-close-${boardBId}`).dispatchEvent('click')
  await expect(pinnedBoardB).toBeVisible()
  await expect(pinnedBoardB.locator('span[aria-hidden="true"]')).toHaveCount(0)

  await pinnedBoardB.dispatchEvent('contextmenu')
  await editor.page.getByTestId(`board-dock-pin-${boardBId}`).dispatchEvent('click')
  await expect(pinnedBoardB).toHaveCount(0)

  await editor.page.evaluate(
    async ({ originalPageId, openPageIds }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      await store.switchPage(originalPageId)
      for (const pageId of openPageIds) store.deletePage(pageId)
    },
    { openPageIds, originalPageId }
  )
})

test('board switcher keeps its header and project rows quiet', async () => {
  await letAppReceivePointerEvents()

  const dock = editor.page.getByTestId('board-dock')
  await dock.getByTestId('board-dock-more').click()
  const projectBrowser = editor.page.getByTestId('board-project-browser')
  const back = projectBrowser.getByTestId('board-switcher-back')
  if (await back.isVisible()) await back.click()
  const header = projectBrowser.getByTestId('board-switcher-header')
  await expect(header.getByText('Workspace', { exact: true })).toBeVisible()
  await expect(header.getByRole('button')).toHaveCount(0)
  await expect(projectBrowser.getByTestId('board-dock-toggle-current')).toHaveCount(0)
  const switcherBox = await projectBrowser.boundingBox()
  expect(switcherBox).not.toBeNull()
  if (switcherBox) {
    expect(switcherBox.height).toBeGreaterThan(400)
    expect(switcherBox.height).toBeLessThanOrEqual(553)
  }
  await expect(projectBrowser.getByTestId('board-switcher-pinned')).toBeVisible()

  const projectRows = projectBrowser.getByTestId('board-switcher-project-row')
  expect(await projectRows.count()).toBeGreaterThan(0)
  expect(
    await projectRows.evaluateAll((rows) =>
      rows.every(
        (row) => [...row.children].filter((child) => child.tagName === 'SPAN').length === 1
      )
    )
  ).toBe(true)
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

  const dock = editor.page.getByTestId('board-dock')
  await dock.getByTestId('board-dock-more').dispatchEvent('click')
  const projectBrowser = editor.page.getByTestId('board-project-browser')
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
    await editor.page.getByTestId('board-dock-more').dispatchEvent('click')
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

test('board dock scales continuously as pinned boards are added and removed', async () => {
  test.setTimeout(30_000)
  await letAppReceivePointerEvents()
  await editor.page.setViewportSize({ height: 900, width: 800 })
  const pinnedBoardCount = 15

  const dockShell = editor.page.getByTestId('board-dock-shell')
  const preferredSize = Number(await dockShell.getAttribute('data-dock-tile-size'))
  expect(preferredSize).toBe(36)

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    for (let index = 0; index < 36; index++) store.addPage(`Dock scale ${index + 1}`)
    store.requestRender()
  })

  const projectBrowser = editor.page.getByTestId('board-project-browser')
  if (!(await projectBrowser.isVisible()))
    await editor.page.getByTestId('board-dock-more').dispatchEvent('click')
  await expect(projectBrowser).toBeVisible()
  const projectBrowserBoxBefore = await projectBrowser.boundingBox()
  expect(projectBrowserBoxBefore).not.toBeNull()
  const manageBoards = projectBrowser.getByTestId('board-switcher-manage')
  if (await manageBoards.isVisible()) await manageBoards.click()
  const keepButtons = projectBrowser.getByRole('button', { name: 'Keep Main board in dock' })
  for (let index = 0; index < pinnedBoardCount; index++) {
    await projectBrowser
      .getByRole('button', { exact: true, name: `Dock scale ${index + 1}` })
      .dispatchEvent('click')
    await expect.poll(() => keepButtons.count()).toBeGreaterThan(0)
    await keepButtons.last().click({ force: true })
  }

  await expect
    .poll(async () => Number(await dockShell.getAttribute('data-dock-tile-size')))
    .toBeLessThan(preferredSize)
  const compressedSize = Number(await dockShell.getAttribute('data-dock-tile-size'))
  expect(compressedSize).toBeLessThan(preferredSize)
  const projectBrowserBoxCompressed = await projectBrowser.boundingBox()
  expect(projectBrowserBoxCompressed).not.toBeNull()
  if (projectBrowserBoxBefore && projectBrowserBoxCompressed) {
    expect(projectBrowserBoxCompressed.x + projectBrowserBoxCompressed.width / 2).toBeCloseTo(
      projectBrowserBoxBefore.x + projectBrowserBoxBefore.width / 2,
      0
    )
    expect(projectBrowserBoxCompressed.height).toBeCloseTo(projectBrowserBoxBefore.height, 0)
  }

  const removeButtons = projectBrowser.getByRole('button', { name: /Remove .* from dock/ })
  for (let index = 0; index < pinnedBoardCount; index++) {
    const visibleRemoveCount = await removeButtons.count()
    await removeButtons.first().click({ force: true })
    await expect.poll(() => removeButtons.count()).toBeLessThan(visibleRemoveCount)
  }

  await expect
    .poll(async () => Number(await dockShell.getAttribute('data-dock-tile-size')))
    .toBe(preferredSize)
  const restoredSize = Number(await dockShell.getAttribute('data-dock-tile-size'))
  expect(restoredSize).toBeGreaterThan(compressedSize)
  expect(restoredSize).toBe(preferredSize)
  const projectBrowserBoxRestored = await projectBrowser.boundingBox()
  expect(projectBrowserBoxRestored).not.toBeNull()
  if (projectBrowserBoxBefore && projectBrowserBoxRestored) {
    expect(projectBrowserBoxRestored.x + projectBrowserBoxRestored.width / 2).toBeCloseTo(
      projectBrowserBoxBefore.x + projectBrowserBoxBefore.width / 2,
      0
    )
  }
  await editor.page.setViewportSize({ height: 900, width: 1280 })
})

test('Smylr starts on Move and preserves the chosen tool across refreshes', async () => {
  const move = editor.page.getByTestId(toolbarToolTestId('SELECT'))
  const container = editor.page.getByTestId(toolbarToolTestId('SMYLR_CONTAINER'))

  await expect(move).toHaveClass(/bg-accent/)

  await container.click()
  await expect(container).toHaveClass(/bg-accent/)
  await editor.page.reload()
  await expect(container).toHaveClass(/bg-accent/)

  await move.click()
  await expect(move).toHaveClass(/bg-accent/)
  await editor.page.reload()
  await expect(move).toHaveClass(/bg-accent/)
})

test('Trace annotations switch exclusively with editor tools', async () => {
  const toolbar = editor.page.getByTestId('toolbar')
  const move = toolbar.getByTestId(toolbarToolTestId('SELECT'))
  const pen = toolbar.getByTestId(toolbarToolTestId('PEN'))
  const ink = toolbar.getByTestId('narrated-trace-ink-tool')
  const focus = toolbar.getByTestId('narrated-trace-focus-tool')

  await expect(move).toHaveClass(/bg-accent/)
  await focus.click()
  await expect(focus).toHaveClass(/bg-violet-500/)
  await expect(move).not.toHaveClass(/bg-accent/)

  await pen.click()
  await expect(pen).toHaveClass(/bg-accent/)
  await expect(focus).not.toHaveClass(/bg-violet-500/)

  await ink.click()
  await expect(ink).toHaveClass(/bg-rose-500/)
  await expect(move).not.toHaveClass(/bg-accent/)
  await expect(pen).not.toHaveClass(/bg-accent/)

  await move.click()
  await expect(move).toHaveClass(/bg-accent/)
  await expect(ink).not.toHaveClass(/bg-rose-500/)
})
