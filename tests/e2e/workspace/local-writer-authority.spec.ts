import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'

type ManifestProbe = {
  boardRefs: Array<{ boardId: string; key: string; revision: number }>
  generation: number
}

type BoardSnapshotProbe = {
  nodes: Array<[string, unknown]>
}

async function readCacheEntry<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate(
    ({ cacheKey }) =>
      new Promise<T | null>((resolve, reject) => {
        const openRequest = window.indexedDB.open('open-pencil-cache-v1', 1)
        openRequest.onerror = () => reject(openRequest.error ?? new Error('IndexedDB open failed'))
        openRequest.onsuccess = () => {
          const database = openRequest.result
          const request = database
            .transaction('binary-entries', 'readonly')
            .objectStore('binary-entries')
            .get(cacheKey)
          request.onerror = () => {
            database.close()
            reject(request.error ?? new Error(`Cache read failed for "${cacheKey}"`))
          }
          request.onsuccess = () => {
            const value = request.result as T | undefined
            database.close()
            resolve(value ?? null)
          }
        }
      }),
    { cacheKey: key }
  )
}

async function waitForWorkspaceRole(page: Page, role: 'viewer' | 'writer') {
  await expect
    .poll(
      () =>
        page
          .getByTestId('editor-root')
          .getAttribute('data-local-workspace-role')
          .catch(() => null),
      { timeout: 45_000 }
    )
    .toBe(role)
  await expect
    .poll(() => page.evaluate(() => window.openPencil?.getStore?.().state.documentName ?? null), {
      timeout: 45_000
    })
    .toBe('OpenPencil Workspace')
}

async function savedBoardHasNode(page: Page, boardId: string, nodeId: string) {
  const manifest = await readCacheEntry<ManifestProbe>(
    page,
    'smylr-production/document-v4/manifest'
  )
  const boardRef = manifest?.boardRefs.find((ref) => ref.boardId === boardId)
  if (!boardRef) return null
  const snapshot = await readCacheEntry<BoardSnapshotProbe>(page, boardRef.key)
  return snapshot?.nodes.some(([id]) => id === nodeId) ?? null
}

test('a stale view-only tab cannot restore a deleted Board object', async ({
  browser,
  baseURL
}) => {
  test.setTimeout(150_000)
  const context = await browser.newContext()
  const writer = await context.newPage()
  const proofUrl = `${baseURL}/?local-writer-proof=${crypto.randomUUID()}`

  await writer.goto(proofUrl)
  await waitForWorkspaceRole(writer, 'writer')
  const earth = await writer.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const boardId = store.state.currentPageId
    const nodeId = store.createShape('ELLIPSE', 180, 180, 160, 160)
    store.updateNode(nodeId, { name: 'Earth orbit stale-tab proof' })
    store.requestRender()
    return { boardId, nodeId }
  })

  await expect
    .poll(() => savedBoardHasNode(writer, earth.boardId, earth.nodeId), { timeout: 30_000 })
    .toBe(true)

  const staleViewer = await context.newPage()
  await staleViewer.goto(proofUrl)
  await waitForWorkspaceRole(staleViewer, 'viewer')
  await expect
    .poll(
      () =>
        staleViewer.evaluate(
          ({ nodeId }) => Boolean(window.openPencil?.getStore?.().graph.getNode(nodeId)),
          earth
        ),
      { timeout: 30_000 }
    )
    .toBe(true)

  await writer.evaluate(({ nodeId }) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.select([nodeId])
    store.deleteSelected()
  }, earth)
  await expect
    .poll(() => savedBoardHasNode(writer, earth.boardId, earth.nodeId), { timeout: 30_000 })
    .toBe(false)
  await expect(staleViewer.getByTestId('local-workspace-viewer')).toContainText(
    'Newer saved Board available'
  )

  await staleViewer.evaluate(({ nodeId }) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.updateNode(nodeId, { name: 'Earth tried to return from stale viewer' })
    store.requestRender()
  }, earth)
  await staleViewer.waitForTimeout(1_500)
  expect(await savedBoardHasNode(staleViewer, earth.boardId, earth.nodeId)).toBe(false)

  await writer.close()
  await staleViewer.close()

  const reopened = await context.newPage()
  await reopened.goto(proofUrl)
  await waitForWorkspaceRole(reopened, 'writer')
  await expect
    .poll(
      () =>
        reopened.evaluate(
          ({ nodeId }) => Boolean(window.openPencil?.getStore?.().graph.getNode(nodeId)),
          earth
        ),
      { timeout: 30_000 }
    )
    .toBe(false)

  await reopened.close()
  await context.close()
})
