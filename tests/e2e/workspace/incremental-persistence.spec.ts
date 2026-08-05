import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/')

type ManifestProbe = {
  boardRefs: Array<{ boardId: string; revision: number }>
  generation: number
}

async function waitForWorkspace() {
  await expect
    .poll(
      () => editor.page.evaluate(() => window.openPencil?.getStore?.().state.documentName ?? null),
      { timeout: 30_000 }
    )
    .toBe('OpenPencil Workspace')
}

async function readIncrementalManifest(): Promise<ManifestProbe | null> {
  return editor.page.evaluate(
    () =>
      new Promise<ManifestProbe | null>((resolve, reject) => {
        const openRequest = window.indexedDB.open('open-pencil-cache-v1', 1)
        openRequest.onerror = () => reject(openRequest.error ?? new Error('IndexedDB open failed'))
        openRequest.onsuccess = () => {
          const database = openRequest.result
          const request = database
            .transaction('binary-entries', 'readonly')
            .objectStore('binary-entries')
            .get('smylr-production/document-v4/manifest')
          request.onerror = () => {
            database.close()
            reject(request.error ?? new Error('Manifest read failed'))
          }
          request.onsuccess = () => {
            const value = request.result as ManifestProbe | undefined
            database.close()
            resolve(value ?? null)
          }
        }
      })
  )
}

test('persists only the dirty Board and restores both Boards after reload', async () => {
  await waitForWorkspace()
  const probe = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')

    const boardAId = store.addPage('Incremental persistence A')
    const markerAId = store.graph.createNode('RECTANGLE', boardAId, {
      name: 'Incremental marker A'
    }).id
    const boardBId = store.addPage('Incremental persistence B')
    const markerBId = store.graph.createNode('RECTANGLE', boardBId, {
      name: 'Incremental marker B'
    }).id
    await store.switchPage(boardAId)
    store.requestRender()
    return { boardAId, boardBId, markerAId, markerBId }
  })

  let before: ManifestProbe | null = null
  await expect
    .poll(
      async () => {
        before = await readIncrementalManifest()
        const boardIds = new Set(before?.boardRefs.map((ref) => ref.boardId))
        return boardIds.has(probe.boardAId) && boardIds.has(probe.boardBId)
      },
      { timeout: 30_000 }
    )
    .toBe(true)
  if (!before) throw new Error('Initial incremental manifest missing')
  const beforeGeneration = before.generation
  const beforeA = before.boardRefs.find((ref) => ref.boardId === probe.boardAId)?.revision
  const beforeB = before.boardRefs.find((ref) => ref.boardId === probe.boardBId)?.revision

  await editor.page.evaluate(({ markerAId }) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.updateNode(markerAId, { name: 'Incremental marker A updated' })
  }, probe)

  let after: ManifestProbe | null = null
  await expect
    .poll(
      async () => {
        after = await readIncrementalManifest()
        return (after?.generation ?? 0) > beforeGeneration
      },
      { timeout: 30_000 }
    )
    .toBe(true)
  if (!after) throw new Error('Updated incremental manifest missing')
  expect(after.boardRefs.find((ref) => ref.boardId === probe.boardAId)?.revision).toBe(
    (beforeA ?? 0) + 1
  )
  expect(after.boardRefs.find((ref) => ref.boardId === probe.boardBId)?.revision).toBe(beforeB)

  await editor.page.reload()
  await waitForWorkspace()
  await expect
    .poll(
      () =>
        editor.page.evaluate(({ markerAId, markerBId }) => {
          const graph = window.openPencil?.getStore?.().graph
          return {
            markerA: graph?.getNode(markerAId)?.name ?? null,
            markerB: graph?.getNode(markerBId)?.name ?? null
          }
        }, probe),
      { timeout: 30_000 }
    )
    .toEqual({
      markerA: 'Incremental marker A updated',
      markerB: 'Incremental marker B'
    })

  editor.canvas.assertNoErrors()
})
