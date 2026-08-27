import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

test('opens a standalone Mermaid object from stable canvas chrome and returns to Layers', async ({
  page
}) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  const objectId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const node = store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Mermaid · Flowchart',
      x: 160,
      y: 140,
      width: 420,
      height: 220,
      fills: [],
      strokes: [],
      pluginData: [
        { pluginId: 'open-pencil', key: 'mermaid/role', value: 'diagram' },
        { pluginId: 'open-pencil', key: 'mermaid/source', value: 'flowchart LR\nA --> B' },
        { pluginId: 'open-pencil', key: 'mermaid/appearance', value: 'dark' }
      ]
    })
    store.setViewport({ panX: 160, panY: 120, zoom: 1 })
    store.setHoveredNode(node.id)
    return node.id
  })

  const overlay = page.getByTestId('native-object-action-overlay')
  const openObject = page.getByTestId('open-native-object')
  await expect(overlay).toHaveAttribute('data-object-action-node-id', objectId)
  await expect(openObject).toBeVisible()

  const [overlayBox, buttonBox] = await Promise.all([
    overlay.boundingBox(),
    openObject.boundingBox()
  ])
  if (!overlayBox || !buttonBox) throw new Error('Expected object action geometry')
  expect(buttonBox.y + buttonBox.height).toBeGreaterThan(overlayBox.y)

  await openObject.hover()
  await page.evaluate(() => window.openPencil?.getStore?.()?.setHoveredNode(null))
  await page.waitForTimeout(240)
  await expect(openObject).toBeVisible()
  await openObject.click()

  await expect(page.getByTestId('native-object-panel-surface')).toBeVisible()
  await expect(page.getByTestId('native-object-name')).toHaveText('Mermaid · Flowchart')

  await page.getByTestId('native-object-back-to-layers').click()
  await expect(page.getByTestId('workspace-layers-surface')).toBeVisible()
  await expect(page.locator(`[data-node-id="${objectId}"]`)).toContainText('Mermaid · Flowchart')
})
