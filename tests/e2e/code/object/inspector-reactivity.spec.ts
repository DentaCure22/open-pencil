import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('refreshes an open Code Object inspector after a remote graph update', async () => {
  await editor.page.getByTestId('code-object-start').click()
  await editor.page.getByRole('tab', { name: 'Code' }).click()

  const stateEditor = editor.page.getByTestId('code-object-state')
  await expect(stateEditor).toHaveValue(/"count": 0/)

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const nodeId = store ? [...store.state.selectedIds][0] : null
    const node = nodeId ? store?.graph.getNode(nodeId) : null
    if (!store || !node) throw new Error('Selected Code Object is unavailable')

    const pluginData = node.pluginData.map((entry) => {
      if (entry.pluginId !== 'openpencil-code-object' || entry.key !== 'document') return entry
      const document = JSON.parse(entry.value)
      return {
        ...entry,
        value: JSON.stringify({
          ...document,
          state: { verification: 'remote-update' }
        })
      }
    })

    store.graph.updateNode(node.id, { pluginData })
    store.requestRender()
  })

  await expect(stateEditor).toHaveValue(/"verification": "remote-update"/)
})
