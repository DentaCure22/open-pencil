import { expect, test, type Locator, type Page } from '@playwright/test'

import rendererCatalog from '@/app/smylr-component-library/renderer-catalog.generated.json' with { type: 'json' }

import { expectDefined } from '#tests/helpers/assert'
import { CanvasHelper } from '#tests/helpers/canvas'

const baseAssetCoverage = (() => {
  const liveSourcePaths = new Set(rendererCatalog.fixtures.map((fixture) => fixture.sourcePath))
  const sourceOnlyComponents = rendererCatalog.components.filter(
    (component) =>
      !liveSourcePaths.has(component.sourcePath) &&
      component.openPencilAudit?.assetAction !== 'remove-from-assets'
  )
  const live = rendererCatalog.fixtures.length
  const sourceOnly = sourceOnlyComponents.length

  return {
    total: live + sourceOnly,
    live,
    sourceOnly,
    byLayer: {
      features:
        rendererCatalog.fixtures.filter((fixture) => fixture.inventory.layer === 'feature').length +
        sourceOnlyComponents.filter((component) => component.layer === 'feature').length,
      layout:
        rendererCatalog.fixtures.filter((fixture) => fixture.inventory.layer === 'layout').length +
        sourceOnlyComponents.filter((component) => component.layer === 'layout').length,
      primitives:
        rendererCatalog.fixtures.filter((fixture) => fixture.inventory.layer === 'primitive')
          .length +
        sourceOnlyComponents.filter((component) => component.layer === 'primitive').length,
      shared:
        rendererCatalog.fixtures.filter((fixture) => fixture.inventory.layer === 'shared').length +
        sourceOnlyComponents.filter((component) => component.layer === 'shared').length
    }
  } as const
})()

async function selectedNodeSnapshot(page: Page) {
  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const selectedId = [...store.state.selectedIds][0]
    const selected = selectedId ? store.graph.getNode(selectedId) : null
    return selected
      ? {
          id: selected.id,
          type: selected.type,
          parentId: selected.parentId,
          componentId: selected.componentId,
          pageId: store.state.currentPageId,
          width: selected.width,
          smylrRoute: selected.pluginData.find(
            (entry) => entry.pluginId === 'smylr-production' && entry.key === 'route'
          )?.value,
          childTexts: store.graph
            .getChildren(selected.id)
            .filter((child) => child.type === 'TEXT')
            .map((child) => child.text)
        }
      : null
  })
}

async function dragAssetItemToCanvas(page: Page, item: Locator, offsetX = 540, offsetY = 360) {
  const canvasArea = page.getByTestId('canvas-area')
  const canvasBounds = await canvasArea.boundingBox()
  expectDefined(canvasBounds, 'canvas bounds')
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  const dropPoint = {
    clientX: canvasBounds.x + offsetX,
    clientY: canvasBounds.y + offsetY
  }
  await item.dispatchEvent('dragstart', { dataTransfer })
  const payload = await dataTransfer.evaluate((value) =>
    value.getData('application/x-openpencil-component-variant')
  )
  await expect(page.getByTestId('canvas-drop-overlay')).toBeVisible()
  await canvasArea.dispatchEvent('dragenter', { ...dropPoint, dataTransfer })
  await canvasArea.dispatchEvent('dragover', { ...dropPoint, dataTransfer })
  await canvasArea.dispatchEvent('drop', { ...dropPoint, dataTransfer })
  await item.dispatchEvent('dragend', { dataTransfer })
  return payload
}

async function openAssetGroup(page: Page, groupId: string) {
  const group = page.locator(`[data-asset-group="${groupId}"]`)
  if ((await group.getAttribute('aria-expanded')) !== 'true') await group.click()
  await expect(group).toHaveAttribute('aria-expanded', 'true')
}

test('asset folders start closed and remain individually expandable', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()

  await expect(page.getByTestId('asset-group-trigger')).not.toHaveCount(0)
  await expect(
    page.getByTestId('asset-group-trigger').and(page.locator('[aria-expanded="true"]'))
  ).toHaveCount(0)
  await openAssetGroup(page, 'primitives')
  await expect(page.locator('[data-asset-group="board-experiences"]')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  await expect(page.locator('[data-asset-group="interactive"]')).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  canvas.assertNoErrors()
})

test('assets expose an honest count and keyboard-accessible row actions', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()

  await expect(page.getByTestId('computed-assets-count')).toContainText(
    `${baseAssetCoverage.total} total`
  )
  await expect(page.getByTestId('assets-coverage-summary')).toHaveText(
    `${baseAssetCoverage.live} live · ${baseAssetCoverage.sourceOnly} source-only`
  )
  await expect(page.locator('[data-asset-group="primitives"]')).toContainText(
    `${baseAssetCoverage.byLayer.primitives}`
  )
  await openAssetGroup(page, 'primitives')
  const buttonAsset = page.locator('[data-asset-id="smylr-computed:button"]')
  await expect(buttonAsset.getByTestId('asset-open')).toHaveAccessibleName(/Button/)
  await buttonAsset.hover()
  await expect(buttonAsset.getByTestId('asset-actions')).toBeHidden()
  await buttonAsset.getByTestId('asset-open').click()
  await expect(buttonAsset.getByTestId('asset-actions')).toBeVisible()
  const variantScroll = buttonAsset.getByTestId('asset-variant-scroll')
  await expect(variantScroll).toBeVisible()
  await page.waitForTimeout(1_500)
  await expect(buttonAsset.locator('[data-variant-id="default"]')).toBeInViewport()
  await expect.poll(() => variantScroll.evaluate((element) => element.scrollTop)).toBe(0)
  await expect(variantScroll.locator('iframe')).toHaveCount(6)
  await expect(buttonAsset.getByTestId('asset-details')).toHaveRole('button')
  await expect(buttonAsset.getByTestId('asset-details')).toHaveAccessibleName('Component details')
  await expect(buttonAsset.getByTestId('asset-insert')).toHaveRole('button')
  await expect(buttonAsset.getByTestId('asset-insert')).toHaveAccessibleName('Add to board')
  canvas.assertNoErrors()
})

test('assets index every component family and expose source-only coverage honestly', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()

  await expect(page.locator('[data-asset-group="layout"]')).toContainText(
    `${baseAssetCoverage.byLayer.layout}`
  )
  await expect(page.locator('[data-asset-group="shared"]')).toContainText(
    `${baseAssetCoverage.byLayer.shared}`
  )
  await expect(page.locator('[data-asset-group="features"]')).toContainText(
    `${baseAssetCoverage.byLayer.features}`
  )

  await page.getByTestId('assets-search').fill('AccountingReportsPage')
  await expect(page.getByTestId('assets-coverage-summary')).toHaveText('0 live · 1 source-only')
  const sourceAsset = page.locator(
    '[data-asset-id="smylr-inventory:src/features/accounting/components/close-reporting/accounting-reports-page.tsx"]'
  )
  await expect(sourceAsset).toBeVisible()
  await expect(sourceAsset).toHaveAttribute('data-asset-kind', 'inventory')
  await expect(sourceAsset.getByTestId('asset-source-status')).toHaveText('Runtime')
  await expect(sourceAsset.getByTestId('asset-open')).not.toHaveAttribute('draggable', 'true')
  await sourceAsset.getByTestId('asset-open').click()

  const details = page.getByTestId('asset-details-dialog')
  await expect(details).toContainText('Source component · source-only by design')
  await expect(details.getByTestId('asset-details-exports')).toContainText('AccountingReportsPage')
  await expect(details.getByTestId('asset-details-states')).toContainText('Loading')
  await expect(details.getByTestId('asset-details-audit-meta')).toContainText('runtime or service')
  await expect(details.getByTestId('asset-details-audit-meta')).toContainText('low priority')
  await expect(details.getByTestId('asset-details-coverage')).toContainText(
    'live store/service/context dependencies'
  )
  await expect(details.getByTestId('asset-details-audit-action')).toContainText(
    'Production source is valuable'
  )
  await expect(details.getByTestId('asset-details-insert')).toBeDisabled()
  await details.getByTestId('asset-details-close').click()

  await page.getByTestId('assets-search').fill('ScheduleKeyboardShortcuts')
  await expect(page.getByTestId('assets-coverage-summary')).toHaveText('0 live · 0 source-only')
  await expect(page.getByTestId('assets-empty')).toBeVisible()
  canvas.assertNoErrors()
})

test('assets without variants expose a draggable Original item', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await openAssetGroup(page, 'primitives')

  const accordionAsset = page.locator('[data-asset-id="smylr-computed:accordion"]')
  await accordionAsset.getByTestId('asset-open').click()

  const dropdown = accordionAsset.getByTestId('asset-variants-dropdown')
  await expect(dropdown).toBeVisible()
  const original = dropdown.locator('[data-variant-id="original"]')
  await expect(original).toHaveCount(1)
  await expect(original).toContainText('Original')
  await expect(original).toHaveAttribute('draggable', 'true')
  await expect(original).toContainText('Drag')
  const previewBounds = await original.getByTestId('asset-variant-preview').boundingBox()
  expectDefined(previewBounds, 'original preview bounds')
  expect(previewBounds.width).toBeGreaterThanOrEqual(90)
  expect(previewBounds.height).toBeGreaterThanOrEqual(60)

  const payload = await dragAssetItemToCanvas(page, original)
  expect(payload).toContain('"fixtureId":"accordion"')
  expect(payload).toContain('"variantId":null')
  await canvas.waitForRender()
  await expect(dropdown).toBeHidden()

  const placed = await selectedNodeSnapshot(page)
  expect(placed?.type).toBe('FRAME')
  expect(placed?.smylrRoute).toBe('/open-pencil-renderer?component=accordion&embed=1')
  const runtime = page.getByTestId('placed-live-component-runtime')
  await expect(runtime).toBeVisible()
  await expect(runtime).toHaveAttribute('src', /component=accordion.*embed=1/)
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(surface).toHaveAccessibleName('Use Accordion')
  await expect(surface).toBeEnabled()
  await expect(header).toHaveAccessibleName('Move Accordion')
  await surface.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'interact')
  await expect(header).toHaveAccessibleName('Finish interacting and move Accordion')
  await expect(header).toContainText('Done')
  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  await expect(surface).toBeVisible()
  canvas.assertNoErrors()
})

test('placed live components switch between board editing and real interaction', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await openAssetGroup(page, 'primitives')

  const buttonAsset = page.locator('[data-asset-id="smylr-computed:button"]')
  await buttonAsset.getByTestId('asset-open').click()
  const defaultVariant = buttonAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="default"]')
  await dragAssetItemToCanvas(page, defaultVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  await expect(surface).toHaveAccessibleName('Use Button · Default')
  await expect(surface).toBeEnabled()
  await expect(header).toHaveAccessibleName('Move Button · Default')

  await surface.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'interact')
  await expect(header).toHaveAccessibleName('Finish interacting and move Button · Default')
  await expect(header).toContainText('Done')
  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  await expect(
    componentFrame.locator('[data-smylr-component-renderer-root="true"]')
  ).toHaveAttribute('data-smylr-component-renderer-ready', 'true')
  const button = componentFrame.locator('[data-openpencil-embedded-fixture="button"]')
  await expect(button).toBeVisible()
  await expect(button).toHaveText('Save changes')
  await button.click()
  await expect(button).toHaveText('Saved')

  const componentBoundsBeforeResize = await button.boundingBox()
  expectDefined(componentBoundsBeforeResize, 'component DOM bounds before resize')

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const selectedId = [...store.state.selectedIds][0]
    const selected = selectedId ? store.graph.getNode(selectedId) : null
    if (!selected) throw new Error('Placed component is not selected')
    store.updateNode(selected.id, {
      height: selected.height * 1.5,
      width: selected.width * 2
    })
    store.requestRender()
  })
  await canvas.waitForRender()

  const componentBoundsAfterResize = await button.boundingBox()
  expectDefined(componentBoundsAfterResize, 'component DOM bounds after resize')
  expect(componentBoundsAfterResize.width / componentBoundsBeforeResize.width).toBeCloseTo(2, 1)
  expect(componentBoundsAfterResize.height / componentBoundsBeforeResize.height).toBeCloseTo(1.5, 1)
  await expect(runtime).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(componentFrame.locator('html')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(componentFrame.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(componentFrame.locator('[data-smylr-component-renderer-root="true"]')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  )

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  await expect(surface).toBeVisible()

  const beforeFrame = await selectedNodeSnapshot(page)
  const beforeBounds = await runtime.boundingBox()
  const headerBounds = await header.boundingBox()
  expectDefined(beforeBounds, 'placed component bounds before move')
  expectDefined(headerBounds, 'placed component header bounds before move')
  await page.mouse.move(
    headerBounds.x + headerBounds.width / 2,
    headerBounds.y + headerBounds.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    headerBounds.x + headerBounds.width / 2 + 64,
    headerBounds.y + headerBounds.height / 2 + 32,
    { steps: 8 }
  )
  await page.mouse.up()
  await canvas.waitForRender()
  const afterFrame = await selectedNodeSnapshot(page)
  const afterBounds = await runtime.boundingBox()
  expectDefined(afterBounds, 'placed component bounds after move')
  expect(afterFrame?.id).toBe(beforeFrame?.id)
  expect(afterBounds.x - beforeBounds.x).toBeGreaterThan(55)
  expect(afterBounds.y - beforeBounds.y).toBeGreaterThan(25)
  canvas.assertNoErrors()
})

test('resizing nested live components transforms their real controls', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('ButtonGroup')

  const buttonGroupAsset = page.locator('[data-asset-id="smylr-computed:button-group"]')
  await buttonGroupAsset.getByTestId('asset-open').click()
  const plainVariant = buttonGroupAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="plain"]')
  await dragAssetItemToCanvas(page, plainVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  await page.getByTestId('placed-live-component-enter-interact').click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'interact')
  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  const dayButton = componentFrame.getByRole('button', { name: 'Day' })
  await expect(dayButton).toBeVisible()

  const controlBoundsBeforeResize = await dayButton.boundingBox()
  expectDefined(controlBoundsBeforeResize, 'nested control bounds before resize')
  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const selectedId = [...store.state.selectedIds][0]
    const selected = selectedId ? store.graph.getNode(selectedId) : null
    if (!selected) throw new Error('Placed component is not selected')
    store.updateNode(selected.id, {
      height: selected.height * 1.5,
      width: selected.width * 2
    })
    store.requestRender()
  })
  await canvas.waitForRender()

  const controlBoundsAfterResize = await dayButton.boundingBox()
  expectDefined(controlBoundsAfterResize, 'nested control bounds after resize')
  expect(controlBoundsAfterResize.width / controlBoundsBeforeResize.width).toBeCloseTo(2, 1)
  expect(controlBoundsAfterResize.height / controlBoundsBeforeResize.height).toBeCloseTo(1.5, 1)
  canvas.assertNoErrors()
})

test('foundation component fixtures expose variants and retain real interactive state', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('Toggle')

  const toggleAsset = page.locator('[data-asset-id="smylr-computed:toggle"]')
  await toggleAsset.getByTestId('asset-open').click()
  const outlineVariant = toggleAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="outline"]')
  await expect(outlineVariant).toContainText('Outline')
  await dragAssetItemToCanvas(page, outlineVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute('src', /component=toggle.*variant=outline.*embed=1/)
  await expect(surface).toHaveAccessibleName('Use Toggle · Outline')
  await expect(surface).toBeEnabled()

  await surface.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'interact')
  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  const toggle = componentFrame.getByRole('button', {
    name: 'Show completed tasks'
  })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  canvas.assertNoErrors()
})

test('primitive component fixtures expose source states and stay interactive on the board', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('SensitiveInput')

  const sensitiveInputAsset = page.locator('[data-asset-id="smylr-computed:sensitive-input"]')
  await expect(sensitiveInputAsset.getByTestId('asset-variant-summary')).toContainText('3 variants')
  await sensitiveInputAsset.getByTestId('asset-open').click()
  const maskedVariant = sensitiveInputAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="masked"]')
  await expect(maskedVariant).toContainText('Mode: Masked')
  await dragAssetItemToCanvas(page, maskedVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute('src', /component=sensitive-input.*variant=masked.*embed=1/)
  await expect(surface).toHaveAccessibleName('Use SensitiveInput · Mode: Masked')
  await surface.click()

  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  const password = componentFrame.getByLabel('Account password')
  await expect(password).toHaveAttribute('type', 'password')
  await componentFrame.getByRole('button', { name: 'Show value' }).click()
  await expect(password).toHaveAttribute('type', 'text')

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  canvas.assertNoErrors()
})

test('overlay component fixtures stay contained and interactive on the board', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('Popover')

  const popoverAsset = page.locator('[data-asset-id="smylr-computed:popover"]')
  await expect(popoverAsset.getByTestId('asset-variant-summary')).toContainText('2 variants')
  await popoverAsset.getByTestId('asset-open').click()
  const openVariant = popoverAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="open"]')
  await expect(openVariant).toContainText('State: Open')
  await dragAssetItemToCanvas(page, openVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute('src', /component=popover.*variant=open.*embed=1/)
  await expect(surface).toHaveAccessibleName('Use Popover · State: Open')
  await surface.click()

  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  await expect(componentFrame.getByRole('button', { name: 'Route task' })).toBeVisible()
  await expect(componentFrame.locator('[data-openpencil-popover-status]')).toHaveText(
    'Choose a destination.'
  )
  await componentFrame.locator('[data-openpencil-popover-action]').click()
  await expect(componentFrame.locator('[data-openpencil-popover-status]')).toHaveText(
    'Assigned to billing.'
  )

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  canvas.assertNoErrors()
})

test('navigation fixtures preserve real right-click interaction on the board', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('ContextMenu')

  const contextMenuAsset = page.locator('[data-asset-id="smylr-computed:context-menu"]')
  await expect(contextMenuAsset.getByTestId('asset-variant-summary')).toContainText('2 variants')
  await contextMenuAsset.getByTestId('asset-open').click()
  const triggerVariant = contextMenuAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="trigger"]')
  await expect(triggerVariant).toContainText('State: Trigger')
  await dragAssetItemToCanvas(page, triggerVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute('src', /component=context-menu.*variant=trigger.*embed=1/)
  await expect(surface).toHaveAccessibleName('Use ContextMenu · State: Trigger')
  await surface.click()

  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  const trigger = componentFrame.locator('[data-slot="context-menu-trigger"]')
  await expect(trigger).toContainText('Right-click for actions')
  await trigger.click({ button: 'right' })
  await expect(componentFrame.getByText('Patient actions')).toBeVisible()
  await componentFrame.getByRole('menuitem', { name: /Open patient/ }).click()
  await expect(trigger).toContainText('Patient opened')

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  canvas.assertNoErrors()
})

test('feedback fixtures keep real tree navigation interactive on the board', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('TreeNav')

  const treeNavAsset = page.locator('[data-asset-id="smylr-computed:tree-nav"]')
  await expect(treeNavAsset.getByTestId('asset-variant-summary')).toContainText('3 variants')
  await treeNavAsset.getByTestId('asset-open').click()
  const openVariant = treeNavAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="open"]')
  await expect(openVariant).toContainText('State: Open')
  await dragAssetItemToCanvas(page, openVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute('src', /component=tree-nav.*variant=open.*embed=1/)
  await expect(surface).toHaveAccessibleName('Use TreeNav · State: Open')
  await surface.click()

  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  const group = componentFrame.getByRole('button', { name: 'Clinical' })
  const overview = componentFrame.getByRole('button', { name: 'Overview' })
  await expect(overview).toBeVisible()
  await group.click()
  await expect(overview).toBeHidden()
  await group.click()
  await expect(overview).toBeVisible()

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  canvas.assertNoErrors()
})

test('specialized fixtures support real pointer drawing and clearing on the board', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('SignaturePad')

  const signatureAsset = page.locator('[data-asset-id="smylr-computed:signature-pad"]')
  await expect(signatureAsset.getByTestId('asset-variant-summary')).toContainText('2 variants')
  await signatureAsset.getByTestId('asset-open').click()
  const detailsVariant = signatureAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="details"]')
  await expect(detailsVariant).toContainText('Display: Details')
  await dragAssetItemToCanvas(page, detailsVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute('src', /component=signature-pad.*variant=details.*embed=1/)
  await expect(surface).toHaveAccessibleName('Use SignaturePad · Display: Details')
  await surface.click()

  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  const signatureCanvas = componentFrame.locator('canvas')
  const signatureStatus = componentFrame.locator('[data-openpencil-signature-status]')
  const signatureBounds = await signatureCanvas.boundingBox()
  expectDefined(signatureBounds, 'signature canvas bounds')
  await page.mouse.move(signatureBounds.x + 70, signatureBounds.y + 80)
  await page.mouse.down()
  await page.mouse.move(signatureBounds.x + 145, signatureBounds.y + 60, { steps: 8 })
  await page.mouse.move(signatureBounds.x + 215, signatureBounds.y + 90, { steps: 8 })
  await page.mouse.up()
  await expect(signatureStatus).toHaveText('Signed')

  await componentFrame.getByRole('button', { name: 'Clear' }).click()
  await expect(signatureStatus).toHaveText('Empty')

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  canvas.assertNoErrors()
})

test('layout fixtures expose organized states and keep navigation interactive on the board', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('NavContentCard')

  await expect(page.locator('[data-asset-group="layout"]')).toContainText('1')
  const layoutAsset = page.locator('[data-asset-id="smylr-computed:nav-content-card"]')
  await expect(layoutAsset.getByTestId('asset-variant-summary')).toContainText('3 variants')
  await layoutAsset.getByTestId('asset-open').click()
  const collapseVariant = layoutAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="collapse"]')
  await expect(collapseVariant).toContainText('Navigation: Collapsible')
  const layoutPreviewBounds = await collapseVariant
    .getByTestId('asset-variant-preview')
    .boundingBox()
  expectDefined(layoutPreviewBounds, 'layout preview bounds')
  expect(layoutPreviewBounds.height).toBeGreaterThanOrEqual(108)
  await dragAssetItemToCanvas(page, collapseVariant, 760)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute(
    'src',
    /component=nav-content-card.*variant=collapse.*embed=1/
  )
  await expect(surface).toHaveAccessibleName('Use NavContentCard · Navigation: Collapsible')
  await surface.click()

  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  const expandNavigation = componentFrame.getByRole('button', {
    name: 'Expand Patient workspace navigation'
  })
  await expect(expandNavigation).toBeVisible()
  await expandNavigation.click()
  await expect(
    componentFrame.getByRole('button', {
      name: 'Collapse Patient workspace navigation'
    })
  ).toBeVisible()

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  canvas.assertNoErrors()
})

test('stateful layout fixtures keep real context-menu interaction on the board', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('GlobalContextMenu')

  const menuAsset = page.locator('[data-asset-id="smylr-computed:global-context-menu"]')
  await expect(menuAsset.getByTestId('asset-variant-summary')).toContainText('2 variants')
  await menuAsset.getByTestId('asset-open').click()
  const triggerVariant = menuAsset
    .getByTestId('asset-variants-dropdown')
    .locator('[data-variant-id="trigger"]')
  await expect(triggerVariant).toContainText('State: Trigger')
  await dragAssetItemToCanvas(page, triggerVariant)
  await canvas.waitForRender()

  const runtime = page.getByTestId('placed-live-component-runtime')
  const surface = page.getByTestId('placed-live-component-enter-interact')
  const header = page.getByTestId('placed-live-component-header')
  await expect(runtime).toHaveAttribute(
    'src',
    /component=global-context-menu.*variant=trigger.*embed=1/
  )
  await expect(surface).toHaveAccessibleName('Use GlobalContextMenu · State: Trigger')
  await surface.click()

  const componentFrame = page.frameLocator('[data-test-id="placed-live-component-runtime"]')
  const stage = componentFrame.locator('[data-openpencil-fixture="global-context-menu"]')
  await stage.click({ button: 'right', position: { x: 90, y: 100 } })
  await expect(componentFrame.getByText('Layout actions', { exact: true })).toBeVisible()
  await componentFrame.getByText('Add note', { exact: true }).click()
  await expect(componentFrame.locator('[data-openpencil-context-menu-status]')).toHaveText(
    'Note added'
  )

  await header.click()
  await expect(runtime).toHaveAttribute('data-interaction-mode', 'frame')
  canvas.assertNoErrors()
})

test('expanded variants stay anchored in the Assets sidebar', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('SensitiveInput')
  const sensitiveInputAsset = page.locator('[data-asset-id="smylr-computed:sensitive-input"]')
  const assetTitle = sensitiveInputAsset.getByTestId('asset-open')
  await assetTitle.click()
  await page.waitForTimeout(1_500)

  await expect(assetTitle).toBeInViewport()
  await expect(
    sensitiveInputAsset.getByTestId('asset-variants-dropdown').locator('[data-variant-id="masked"]')
  ).toBeInViewport()
  const horizontalScroll = await page.evaluate(() => {
    const item = document.querySelector('[data-asset-id="smylr-computed:sensitive-input"]')
    const scrolledAncestors: Array<{ className: string; scrollLeft: number }> = []
    let ancestor = item?.parentElement ?? null
    while (ancestor) {
      if (ancestor.scrollLeft !== 0) {
        scrolledAncestors.push({
          className: ancestor.className,
          scrollLeft: ancestor.scrollLeft
        })
      }
      ancestor = ancestor.parentElement
    }
    return { scrolledAncestors, windowScrollX: window.scrollX }
  })
  expect(horizontalScroll).toEqual({ scrolledAncestors: [], windowScrollX: 0 })
  canvas.assertNoErrors()
})

test('assets publish a portable library and review imports before applying', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await page.getByTestId('left-panel-assets-tab').click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('assets-publish-library').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('untitled.openpencil-library.json')

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByTestId('assets-import-library').click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    name: 'acme.openpencil-library.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        format: 'openpencil/library/v1',
        library: {
          key: 'acme-ui',
          name: 'Acme UI',
          version: '1.0.0',
          publishedAt: '2026-07-20T00:00:00.000Z'
        },
        components: [],
        tokens: {
          $schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
          $extensions: {},
          Acme: {
            color: {
              accent: {
                $type: 'color',
                $value: {
                  colorSpace: 'srgb',
                  components: [0.45, 0.25, 0.9],
                  alpha: 1
                }
              }
            }
          }
        },
        images: {}
      })
    )
  })

  const review = page.getByTestId('assets-library-review')
  await expect(review).toBeVisible()
  await expect(review).toContainText('Review library update')
  await expect(review).toContainText('Acme UI')
  await expect(review.getByTestId('assets-library-apply')).toBeVisible()
  await review.getByRole('button', { name: 'Cancel' }).click()
  await expect(review).toBeHidden()
  canvas.assertNoErrors()
})

test('assets panel groups component sets and inserts the default variant', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()

  const ids = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')

    const pageNode = store.graph.getNode(store.state.currentPageId)
    if (!pageNode) throw new Error('Current page not found')

    const set = store.graph.createNode('COMPONENT_SET', pageNode.id, {
      name: 'Button',
      x: 80,
      y: 80,
      width: 260,
      height: 100,
      sourceLibraryKey: 'lk-test-library',
      symbolDescription: 'Reusable button component',
      symbolLinks: [{ uri: 'https://example.com/button', displayName: 'Button docs' }],
      componentPropertyDefinitions: [
        {
          id: 'prop:type',
          name: 'Type',
          type: 'VARIANT',
          defaultValue: 'Secondary',
          variantOptions: ['Primary', 'Secondary']
        }
      ]
    })
    const primary = store.graph.createNode('COMPONENT', set.id, {
      name: 'Type=Primary',
      x: 0,
      y: 0,
      width: 96,
      height: 40,
      componentPropertyValues: { Type: 'Primary' }
    })
    store.graph.createNode('TEXT', primary.id, {
      name: 'Label',
      text: 'Primary',
      width: 72,
      height: 20
    })
    const secondary = store.graph.createNode('COMPONENT', set.id, {
      name: 'Type=Secondary',
      x: 120,
      y: 0,
      width: 132,
      height: 40,
      componentPropertyValues: { Type: 'Secondary' }
    })
    store.graph.createNode('TEXT', secondary.id, {
      name: 'Label',
      text: 'Secondary',
      width: 96,
      height: 20
    })
    const duplicateSecondary = store.graph.createNode('COMPONENT', set.id, {
      name: 'Type=Secondary duplicate',
      x: 280,
      y: 0,
      width: 132,
      height: 40,
      componentPropertyValues: { Type: 'Secondary' }
    })
    const card = store.graph.createNode('COMPONENT', pageNode.id, {
      name: 'Card',
      x: 80,
      y: 240,
      width: 160,
      height: 100
    })
    store.requestRender()
    return {
      setId: set.id,
      primaryId: primary.id,
      secondaryId: secondary.id,
      duplicateSecondaryId: duplicateSecondary.id,
      cardId: card.id
    }
  })
  await canvas.waitForRender()

  await page.getByTestId('left-panel-assets-tab').click()
  await openAssetGroup(page, 'local')
  await openAssetGroup(page, 'primitives')

  const assetsPanel = page.getByTestId('assets-panel')
  const sceneAssetItems = page
    .getByTestId('asset-item')
    .and(page.locator('[data-asset-kind="scene"]'))
  const localSceneAssetCount = await sceneAssetItems.count()
  await expect(assetsPanel).toContainText('Button')
  await expect(assetsPanel).toContainText('Card')
  await expect(assetsPanel).not.toContainText('Type=Primary')
  await expect(assetsPanel).not.toContainText('Type=Secondary')
  const buttonAsset = page.locator(`[data-asset-id="${ids.setId}"]`)
  await expect(buttonAsset.getByTestId('asset-open')).toHaveAccessibleName(/Button/)
  await buttonAsset.getByTestId('asset-open').click()
  await expect(buttonAsset.getByTestId('asset-actions')).toBeVisible()
  await expect(buttonAsset.getByTestId('asset-details')).toHaveRole('button')
  await expect(buttonAsset.getByTestId('asset-details')).toHaveAccessibleName('Component details')
  await expect(buttonAsset.getByTestId('asset-insert')).toHaveRole('button')
  await expect(buttonAsset.getByTestId('asset-insert')).toHaveAccessibleName('Add to board')
  await expect(page.getByTestId('computed-assets-count')).toContainText(
    `${baseAssetCoverage.total + localSceneAssetCount} total`
  )
  await expect(page.getByTestId('assets-coverage-summary')).toHaveText(
    `${baseAssetCoverage.live + localSceneAssetCount} live · ${baseAssetCoverage.sourceOnly} source-only`
  )
  await expect(buttonAsset.getByTestId('asset-variant-summary')).toContainText('3 variants')
  await expect(buttonAsset.getByTestId('asset-docs')).toBeVisible()
  await expect(buttonAsset.getByTestId('asset-variant-conflict')).toContainText(
    'Duplicate variant values'
  )

  await buttonAsset.getByTestId('asset-details').click()
  const details = page.getByTestId('asset-details-dialog')
  await expect(details).toBeVisible()
  await expect(details).toContainText('Button')
  await expect(details.getByTestId('asset-details-preview')).toBeVisible()
  await expect(details.getByTestId('asset-details-preview-image')).toBeVisible()
  await expect(details.getByTestId('asset-details-description')).toContainText(
    'Reusable button component'
  )
  await expect(details.getByTestId('asset-details-library')).toContainText('lk-test-library')
  await expect(details.getByTestId('asset-details-docs')).toBeVisible()
  await expect(details.getByTestId('asset-details-property')).toContainText('Type')
  await page.getByTestId('asset-details-close').click()
  await expect(details).toBeHidden()

  await page.getByTestId('assets-search').fill('card')
  await expect(sceneAssetItems).toHaveCount(1)
  await expect(assetsPanel).toContainText('Card')
  const cardAsset = page.locator(`[data-asset-id="${ids.cardId}"]`)
  await cardAsset.getByTestId('asset-open').click()
  await cardAsset.getByTestId('asset-insert').click()
  await canvas.waitForRender()

  const cardInstance = await selectedNodeSnapshot(page)
  expect(cardInstance?.type).toBe('INSTANCE')
  expect(cardInstance?.componentId).toBe(ids.cardId)
  await expect(page.getByTestId('left-panel-layers-tab')).toHaveAttribute('data-state', 'active')
  expectDefined(cardInstance?.id, 'card instance id')
  const selectedCardLayer = page
    .locator(`[data-node-id="${cardInstance.id}"]`)
    .getByTestId('layers-item')
  await expect(selectedCardLayer).toBeVisible()
  await expect(selectedCardLayer).toHaveClass(/bg-white/)

  await page.getByTestId('left-panel-assets-tab').click()
  await page.getByTestId('assets-search').fill('missing asset')
  await expect(page.getByTestId('assets-empty')).toBeVisible()
  await expect(sceneAssetItems).toHaveCount(0)

  await page.getByTestId('assets-search').fill('button')
  await expect(sceneAssetItems).toHaveCount(1)
  const filteredButtonAsset = page.locator(`[data-asset-id="${ids.setId}"]`)
  await filteredButtonAsset.getByTestId('asset-open').click()
  await filteredButtonAsset.getByTestId('asset-insert').click()
  await canvas.waitForRender()

  const inserted = await selectedNodeSnapshot(page)

  expect(inserted?.type).toBe('INSTANCE')
  expect(inserted?.componentId).toBe(ids.secondaryId)
  expect(inserted?.parentId).toBe(inserted?.pageId)
  expect(inserted?.width).toBe(132)
  expect(inserted?.childTexts).toEqual(['Secondary'])

  await expect(page.getByTestId('variant-section')).toBeVisible()

  await page.getByTestId('variant-section').getByRole('combobox').click()
  await page.getByRole('option', { name: 'Primary' }).click()

  expectDefined(inserted?.id, 'inserted instance id')
  const switched = await selectedNodeSnapshot(page)
  expect(switched?.componentId).toBe(ids.primaryId)
  expect(switched?.width).toBe(96)
  expect(switched?.childTexts).toEqual(['Primary'])

  canvas.assertNoErrors()
})

test('assets insertion accounts for entered container coordinates', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()

  const setup = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.state.panX = 0
    store.state.panY = 0
    store.state.zoom = 1
    const pageNode = store.graph.getNode(store.state.currentPageId)
    if (!pageNode) throw new Error('Current page not found')
    const frame = store.graph.createNode('FRAME', pageNode.id, {
      name: 'Target Frame',
      x: 200,
      y: 150,
      width: 300,
      height: 240
    })
    const component = store.graph.createNode('COMPONENT', pageNode.id, {
      name: 'Panel Card',
      x: 40,
      y: 40,
      width: 120,
      height: 60
    })
    store.state.enteredContainerId = frame.id
    store.requestRender()
    return { frameId: frame.id, componentId: component.id }
  })
  await canvas.waitForRender()

  await page.getByTestId('left-panel-assets-tab').click()
  await openAssetGroup(page, 'local')
  const componentAsset = page.locator(`[data-asset-id="${setup.componentId}"]`)
  await componentAsset.getByTestId('asset-open').click()
  await componentAsset.getByTestId('asset-insert').click()
  await canvas.waitForRender()

  const inserted = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const selectedId = [...store.state.selectedIds][0]
    const selected = selectedId ? store.graph.getNode(selectedId) : null
    if (!selected) return null
    const abs = store.graph.getAbsolutePosition(selected.id)
    const center = store.screenToCanvas(
      ...(Object.values(store.viewportCanvasCenter()) as [number, number])
    )
    return {
      parentId: selected.parentId,
      centerX: abs.x + selected.width / 2,
      centerY: abs.y + selected.height / 2,
      expectedCenterX: center.x,
      expectedCenterY: center.y
    }
  })

  expect(inserted?.parentId).toBe(setup.frameId)
  expect(inserted?.centerX).toBeCloseTo(inserted?.expectedCenterX ?? 0, 1)
  expect(inserted?.centerY).toBeCloseTo(inserted?.expectedCenterY ?? 0, 1)
  canvas.assertNoErrors()
})

test('clicking an asset opens and selects its separate component canvas', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()

  const ids = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const componentPage = store.graph.addPage('Button')
    const component = store.graph.createNode('COMPONENT', componentPage.id, {
      name: 'Button',
      x: 80,
      y: 80,
      width: 120,
      height: 36,
      sourceLibraryKey: 'smylr-native',
      symbolDescription: 'Native Smylr Button · src/components/ui/button.tsx'
    })
    store.requestRender()
    return { componentId: component.id, pageId: componentPage.id }
  })

  await page.getByTestId('left-panel-assets-tab').click()
  await openAssetGroup(page, 'local')
  const asset = page.locator(`[data-asset-id="${ids.componentId}"]`)
  await asset.getByTestId('asset-open').click()
  const dropdown = asset.getByTestId('asset-variants-dropdown')
  await expect(dropdown).toBeVisible()
  await expect(dropdown.getByTestId('asset-variant-item')).toHaveCount(1)
  await dropdown.getByTestId('asset-variant-item').click()
  await canvas.waitForRender()

  const opened = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return {
      pageId: store.state.currentPageId,
      selectedIds: [...store.state.selectedIds]
    }
  })
  expect(opened.pageId).toBe(ids.pageId)
  expect(opened.selectedIds).toEqual([ids.componentId])
})

test('variant thumbnails open their source canvas and drag linked instances onto this board', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()

  const ids = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const targetPageId = store.state.currentPageId
    const componentPage = store.graph.addPage('Button components')
    const set = store.graph.createNode('COMPONENT_SET', componentPage.id, {
      name: 'Button variants',
      x: 80,
      y: 80,
      width: 280,
      height: 100,
      componentPropertyDefinitions: [
        {
          id: 'prop:state',
          name: 'State',
          type: 'VARIANT',
          defaultValue: 'Primary',
          variantOptions: ['Primary', 'Secondary']
        }
      ]
    })
    const primary = store.graph.createNode('COMPONENT', set.id, {
      name: 'State=Primary',
      x: 0,
      y: 0,
      width: 104,
      height: 40,
      componentPropertyValues: { State: 'Primary' },
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.36, g: 0.2, b: 0.92, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    const secondary = store.graph.createNode('COMPONENT', set.id, {
      name: 'State=Secondary',
      x: 128,
      y: 0,
      width: 120,
      height: 40,
      componentPropertyValues: { State: 'Secondary' },
      fills: [
        {
          type: 'SOLID',
          color: { r: 0.18, g: 0.2, b: 0.24, a: 1 },
          opacity: 1,
          visible: true
        }
      ]
    })
    store.requestRender()
    await store.switchPage(targetPageId)
    return {
      componentPageId: componentPage.id,
      primaryId: primary.id,
      secondaryId: secondary.id,
      setId: set.id,
      targetPageId
    }
  })
  await canvas.waitForRender()

  await page.getByTestId('left-panel-assets-tab').click()
  await openAssetGroup(page, 'local')
  const asset = page.locator(`[data-asset-id="${ids.setId}"]`)
  await asset.getByTestId('asset-variants-trigger').click()
  const dropdown = asset.getByTestId('asset-variants-dropdown')
  await expect(dropdown).toBeVisible()
  await expect(dropdown.getByTestId('asset-variant-item')).toHaveCount(2)
  await expect(dropdown.locator(`[data-variant-id="${ids.primaryId}"] img`)).toBeVisible()

  await dropdown.locator(`[data-variant-id="${ids.primaryId}"]`).click()
  await canvas.waitForRender()
  const opened = await selectedNodeSnapshot(page)
  expect(opened?.pageId).toBe(ids.componentPageId)
  expect(opened?.id).toBe(ids.primaryId)

  await page.evaluate(async (targetPageId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    await store.switchPage(targetPageId)
  }, ids.targetPageId)
  await canvas.waitForRender()

  const variantTrigger = page
    .locator(`[data-asset-id="${ids.setId}"]`)
    .getByTestId('asset-variants-trigger')
  await variantTrigger.click()
  const secondary = asset
    .getByTestId('asset-variants-dropdown')
    .locator(`[data-variant-id="${ids.secondaryId}"]`)
  expect(await dragAssetItemToCanvas(page, secondary)).toContain(ids.secondaryId)
  await canvas.waitForRender()

  const placed = await selectedNodeSnapshot(page)
  expect(placed?.type).toBe('INSTANCE')
  expect(placed?.componentId).toBe(ids.secondaryId)
  expect(placed?.pageId).toBe(ids.targetPageId)
  canvas.assertNoErrors()
})

test('demo exposes component set assets', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/demo')
  await canvas.waitForInit()

  await page.getByTestId('left-panel-assets-tab').click()
  await openAssetGroup(page, 'local')
  await openAssetGroup(page, 'primitives')
  const assetsPanel = page.getByTestId('assets-panel')
  const sceneAssetItems = page
    .getByTestId('asset-item')
    .and(page.locator('[data-asset-kind="scene"]'))
  const localSceneAssetCount = await sceneAssetItems.count()

  await expect(page.getByTestId('computed-assets-count')).toContainText(
    `${baseAssetCoverage.total + localSceneAssetCount} total`
  )
  await expect(page.getByTestId('assets-coverage-summary')).toHaveText(
    `${baseAssetCoverage.live + localSceneAssetCount} live · ${baseAssetCoverage.sourceOnly} source-only`
  )
  await expect(assetsPanel).toContainText('Button')
  await expect(assetsPanel).toContainText('2 variants')
  await expect(assetsPanel).toContainText('Avatar')
  await expect(assetsPanel).not.toContainText('Button/Primary')

  canvas.assertNoErrors()
})
