import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const SOURCE = `flowchart LR
  A[Draft] --> B[Review]
  B --> C[Publish]`

const UPDATED_SOURCE = `flowchart LR
  A[Draft] --> B[Review]
  B --> C[Publish]
  C --> D[Measure]`

const editor = useEditorSetupWithClear('/?test&no-rulers')

async function insertMermaid(source: string): Promise<void> {
  const menubar = editor.page.locator('[role="menubar"]')
  if (!(await menubar.isVisible())) await editor.page.getByTestId('app-menu-toggle').click()
  await editor.page.getByTestId('menubar-insert').click()
  await editor.page.getByRole('menuitem', { name: 'Mermaid diagram…', exact: true }).click()
  await editor.page.getByTestId('mermaid-source').fill(source)
  await expect(editor.page.getByTestId('mermaid-insert')).toBeEnabled({ timeout: 15_000 })
  await editor.page.getByTestId('mermaid-insert').click()
  await expect(editor.page.getByTestId('mermaid-import-dialog')).toHaveCount(0)
  await editor.canvas.waitForRender()
}

test('drills into native Mermaid parts and updates the same diagram from source', async () => {
  await insertMermaid(SOURCE)

  const target = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const ownerId = [...store.state.selectedIds][0]
    const owner = ownerId ? store.graph.getNode(ownerId) : undefined
    if (!owner) throw new Error('Expected selected Mermaid owner')
    const shape = owner.childIds
      .map((id) => store.graph.getNode(id))
      .find(
        (node) =>
          node?.name === 'Draft' &&
          node.pluginData.some(
            (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/semantic-id'
          )
      )
    if (!shape) throw new Error('Expected a native Mermaid shape')
    const roundedShape = shape.childIds
      .map((id) => store.graph.getNode(id))
      .find((node) => node?.type === 'RECTANGLE')
    if (!roundedShape) {
      const children = shape.childIds.map((id) => {
        const node = store.graph.getNode(id)
        return node ? `${node.type}:${node.name}` : id
      })
      throw new Error(`Expected a rounded native Mermaid rectangle; found ${children.join(', ')}`)
    }
    const absolute = store.graph.getAbsolutePosition(shape.id)
    return {
      ownerWidth: owner.width,
      ownerId: owner.id,
      cornerRadius: roundedShape.cornerRadius,
      shapeWidth: shape.width,
      shapeId: shape.id,
      x: (absolute.x + 8) * store.state.zoom + store.state.panX,
      y: (absolute.y + 8) * store.state.zoom + store.state.panY
    }
  })

  expect(target.shapeWidth).toBeLessThan(target.ownerWidth)
  expect(target.cornerRadius).toBeGreaterThanOrEqual(10)

  await editor.canvas.dblclick(target.x, target.y)

  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return {
          enteredContainerId: store.state.enteredContainerId,
          selectedIds: [...store.state.selectedIds]
        }
      })
    )
    .toEqual({ enteredContainerId: target.ownerId, selectedIds: [target.shapeId] })
  await expect(editor.page.getByText('Editing native parts', { exact: false })).toBeVisible()

  await editor.canvas.pressKey('Escape')
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return {
          enteredContainerId: store.state.enteredContainerId,
          selectedIds: [...store.state.selectedIds]
        }
      })
    )
    .toEqual({ enteredContainerId: null, selectedIds: [target.ownerId] })

  await editor.page.getByTestId('mermaid-edit-source').click()
  await expect(editor.page.getByRole('heading', { name: 'Edit Mermaid source' })).toBeVisible()
  await expect(editor.page.getByTestId('mermaid-source')).toHaveValue(SOURCE)
  await editor.page.getByTestId('mermaid-source').fill(UPDATED_SOURCE)
  await expect(editor.page.getByTestId('mermaid-insert')).toBeEnabled({ timeout: 15_000 })
  await editor.page.getByTestId('mermaid-insert').click()
  await expect(editor.page.getByTestId('mermaid-import-dialog')).toHaveCount(0)

  const updated = await editor.page.evaluate((ownerId) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const owner = store.graph.getNode(ownerId)
    const text: string[] = []
    const pending = [...(owner?.childIds ?? [])]
    while (pending.length > 0) {
      const id = pending.shift()
      const node = id ? store.graph.getNode(id) : undefined
      if (!node) continue
      if (node.type === 'TEXT') text.push(node.text)
      pending.push(...node.childIds)
    }
    return {
      ownerId: owner?.id,
      selectedIds: [...store.state.selectedIds],
      source: owner?.pluginData.find((entry) => entry.key === 'mermaid/source')?.value,
      text
    }
  }, target.ownerId)

  expect(updated.ownerId).toBe(target.ownerId)
  expect(updated.selectedIds).toEqual([target.ownerId])
  expect(updated.source).toBe(UPDATED_SOURCE)
  expect(updated.text).toContain('Measure')
  editor.canvas.assertNoErrors()
})
