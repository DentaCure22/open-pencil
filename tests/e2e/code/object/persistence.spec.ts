import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/')

type PersistedCodeObjectProbe = {
  frameId: string
  pageId: string
}

test('persists the authored Code Object record in the shared workspace and restores it on reload', async () => {
  await expect
    .poll(
      () =>
        editor.page.evaluate(
          () => window.openPencil?.getStore?.().state.documentName ?? null
        ),
      { timeout: 30_000 }
    )
    .toBe('OpenPencil Workspace')

  const probe = await editor.page.evaluate<PersistedCodeObjectProbe>(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { createCodeObjectFromPreset, codeObjectDocument, setCodeObjectDocument } = await import(
      '/src/app/code-object/model.ts'
    )
    const frame = createCodeObjectFromPreset(store, 'user-code')
    const document = frame ? codeObjectDocument(frame) : null
    if (!frame || document?.component !== 'user-code') {
      throw new Error('Authored Code Object was not created')
    }
    setCodeObjectDocument(store.graph, frame.id, {
      ...document,
      name: 'Persisted Code Object',
      props: { title: 'Restored from workspace' },
      state: { count: 7 }
    })
    store.graph.updateNode(frame.id, { name: 'Persisted Code Object' })
    store.select([frame.id])
    store.requestRender()
    return { frameId: frame.id, pageId: store.state.currentPageId }
  })

  await editor.page.waitForTimeout(1_500)
  await editor.page.reload()
  await editor.canvas.waitForInit()

  await expect
    .poll(
      () =>
        editor.page.evaluate(async ({ frameId, pageId }) => {
          const store = window.openPencil?.getStore?.()
          if (!store || store.state.documentName !== 'OpenPencil Workspace') return null
          const { codeObjectDocument } = await import('/src/app/code-object/model.ts')
          const frame = store.graph.getNode(frameId)
          const document = codeObjectDocument(frame)
          return {
            component: document?.component ?? null,
            frameName: frame?.name ?? null,
            pageStillExists: Boolean(store.graph.getNode(pageId)),
            props: document?.component === 'user-code' ? document.props : null,
            state: document?.state ?? null
          }
        }, probe),
      { timeout: 30_000 }
    )
    .toEqual({
      component: 'user-code',
      frameName: 'Persisted Code Object',
      pageStillExists: true,
      props: { title: 'Restored from workspace' },
      state: { count: 7 }
    })
})
