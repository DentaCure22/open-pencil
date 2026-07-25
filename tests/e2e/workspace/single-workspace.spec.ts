import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/')

type WorkspaceProbe = {
  identity: {
    documentId: string
    roomId: string
    workspaceId: string
  }
  markerId: string
  markerName: string
}

async function waitForWorkspace(): Promise<WorkspaceProbe['identity']> {
  let identity: WorkspaceProbe['identity'] | null = null
  await expect
    .poll(
      async () => {
        identity = await editor.page.evaluate(() => {
          const store = window.openPencil?.getStore?.()
          if (!store || store.state.documentName !== 'OpenPencil Workspace') return null
          const root = store.graph.getNode(store.graph.rootId)
          const serialized = root?.pluginData.find(
            (entry) => entry.pluginId === 'openpencil-workspace' && entry.key === 'identity-v1'
          )?.value
          if (!serialized) return null
          const parsed = JSON.parse(serialized) as {
            documentId?: string
            roomId?: string
            workspaceId?: string
          }
          if (!parsed.documentId || !parsed.roomId || !parsed.workspaceId) return null
          return {
            documentId: parsed.documentId,
            roomId: parsed.roomId,
            workspaceId: parsed.workspaceId
          }
        })
        return identity?.workspaceId ?? null
      },
      { timeout: 30_000 }
    )
    .not.toBeNull()
  if (!identity) throw new Error('OpenPencil workspace identity did not load')
  return identity
}

test('keeps one pinned workspace while normal files remain temporary tabs', async () => {
  const identity = await waitForWorkspace()
  const marker = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const name = `Workspace persistence ${crypto.randomUUID()}`
    const id = store.createShape('RECTANGLE', 120, 120, 180, 96)
    store.updateNode(id, { name })
    store.requestRender()
    return { markerId: id, markerName: name }
  })
  const probe: WorkspaceProbe = { identity, ...marker }

  await editor.page.waitForTimeout(1_500)
  await editor.page.keyboard.press('Meta+t')

  const tabs = editor.page.getByTestId('tabbar-tab')
  await expect(tabs).toHaveCount(2)
  const workspaceTab = tabs.filter({ hasText: 'OpenPencil Workspace' })
  const documentTab = tabs.filter({ hasText: 'Untitled' })
  await expect(workspaceTab).toHaveCount(1)
  await expect(workspaceTab.getByTestId('tabbar-close')).toHaveCount(0)
  await expect(documentTab.getByTestId('tabbar-close')).toHaveCount(1)

  // A fresh isolated browser may show the optional cloud sign-in gate. The tab
  // ownership contract must still hold underneath it, so exercise the tab itself.
  await workspaceTab.dispatchEvent('click')
  await workspaceTab.dispatchEvent('mousedown', { button: 1 })
  await expect(tabs).toHaveCount(2)
  await documentTab.dispatchEvent('click')
  await documentTab.getByTestId('tabbar-close').dispatchEvent('click')
  await expect(editor.page.getByTestId('tabbar-tab')).toHaveCount(0)

  await editor.page.reload()
  const reopenedIdentity = await waitForWorkspace()
  expect(reopenedIdentity).toEqual(probe.identity)
  await expect
    .poll(
      () =>
        editor.page.evaluate(({ markerId, markerName }) => {
          const markerNode = window.openPencil?.getStore?.().graph.getNode(markerId)
          return markerNode?.name === markerName
        }, probe),
      { timeout: 30_000 }
    )
    .toBe(true)

  editor.canvas.assertNoErrors()
})
