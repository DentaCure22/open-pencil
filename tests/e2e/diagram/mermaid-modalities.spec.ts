import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'
import { CanvasHelper } from '#tests/helpers/canvas'

const MERMAID_MODALITIES = [
  {
    id: 'architecture',
    source: `architecture-beta
  group app(cloud)[Application]
  service agent(internet)[Agent] in app
  service board(server)[Board] in app
  service data(database)[Authority] in app
  agent:R --> L:board
  board:B --> T:data`
  },
  {
    id: 'flowchart',
    source: `flowchart LR
  Intent --> Context --> Build --> Board`
  },
  {
    id: 'ishikawa',
    source: `ishikawa-beta
  Slow board edits
    Context
      Repeated reads
      Broad searches
    Execution
      Native node expansion
      Runtime dependency`
  },
  {
    id: 'venn',
    source: `venn-beta
  title "Dynamic builder"
  set Intent
  set Context
  union Intent,Context["Right representation"]`
  },
  {
    id: 'tree-view',
    source: `treeView-beta
  openpencil/
    skills/
      openpencil.md
      mermaid.md
    workspace.json`
  }
] as const

test.setTimeout(90_000)

async function openMermaidDialog(page: Page): Promise<void> {
  const menubar = page.locator('[role="menubar"]')
  if (!(await menubar.isVisible())) await page.getByTestId('app-menu-toggle').click()
  await page.getByTestId('menubar-file').click()
  await page.getByRole('menuitem', { name: 'Mermaid diagram…', exact: true }).click()
  await expect(page.getByTestId('mermaid-import-dialog')).toBeVisible()
}

for (const modality of MERMAID_MODALITIES) {
  test(`renders ${modality.id} as one source-backed SVG object`, async ({ page }) => {
    await page.goto('/?test&no-rulers')
    const canvas = new CanvasHelper(page)
    await canvas.waitForInit()
    await canvas.clearCanvas()
    await openMermaidDialog(page)
    await page.getByTestId('mermaid-source').fill(modality.source)

    await expect(page.getByTestId('mermaid-layer-count')).toHaveText('1 SVG object', {
      timeout: 30_000
    })
    await expect(page.getByTestId('mermaid-preview-error')).toHaveCount(0)
    await expect(
      page.getByTestId('mermaid-preview').locator('svg[aria-label="Mermaid diagram"]')
    ).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('mermaid-insert').click()
    await expect(page.getByTestId('mermaid-import-dialog')).toHaveCount(0)
    await expect(
      page.getByTestId('mermaid-svg-object').locator('svg[aria-label="Mermaid diagram"]')
    ).toBeVisible({ timeout: 30_000 })

    const inserted = await page.evaluate(() => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const ownerId = [...store.state.selectedIds][0]
      const owner = ownerId ? store.graph.getNode(ownerId) : undefined
      return {
        childIds: owner?.childIds,
        ownerType: owner?.type,
        parser: owner?.pluginData.find((entry) => entry.key === 'mermaid/parser')?.value,
        source: owner?.pluginData.find((entry) => entry.key === 'mermaid/source')?.value
      }
    })

    expect(inserted).toEqual({
      childIds: [],
      ownerType: 'FRAME',
      parser: 'mermaid@11.16.0/svg',
      source: modality.source
    })
  })
}
