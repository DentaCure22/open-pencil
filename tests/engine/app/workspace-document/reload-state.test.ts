import { describe, expect, test } from 'bun:test'

import {
  loadReloadState,
  restoreReloadState,
  saveReloadState,
  type ReloadStateStorage
} from '@/app/document/io/reload-state'
import { createEditorStore } from '@/app/editor/session'

function memoryStorage(): ReloadStateStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    }
  }
}

describe('workspace reload state', () => {
  test('keeps reload state isolated by exact workspace identity', () => {
    const storage = memoryStorage()
    const store = createEditorStore()
    store.setViewportSize(1200, 800)
    const targetPageId = store.addPage('Exact reload target')
    store.state.currentPageId = targetPageId
    store.state.panX = 37
    store.state.panY = -11
    store.state.zoom = 1.4

    expect(saveReloadState('workspace-a', store.state, storage)).toBe(true)
    expect(loadReloadState('workspace-b', storage)).toBeNull()
    expect(loadReloadState('workspace-a', storage)).toEqual({
      pageId: targetPageId,
      viewport: { panX: 37, panY: -11, zoom: 1.4 }
    })
  })

  test('restores only an exact top-level Board and falls back safely otherwise', async () => {
    const store = createEditorStore()
    store.setViewportSize(1200, 800)
    const firstPageId = store.graph.getPages()[0]?.id
    const targetPageId = store.addPage('Exact reload target')
    if (!firstPageId) throw new Error('First test page missing')
    await store.switchPage(firstPageId)
    const pageChanges: string[] = []
    const viewportChanges: Array<{ panX: number; panY: number; zoom: number }> = []
    let renderRequests = 0
    store.onEditorEvent('page:changed', (pageId) => pageChanges.push(pageId))
    store.onEditorEvent('viewport:changed', (viewport) => viewportChanges.push(viewport))
    store.onEditorEvent('render:requested', () => {
      renderRequests += 1
    })

    await restoreReloadState(store, {
      pageId: targetPageId,
      viewport: { panX: 12, panY: 18, zoom: 2 }
    })
    expect(store.state.currentPageId).toBe(targetPageId)
    expect(pageChanges).toContain(targetPageId)
    expect(viewportChanges.at(-1)).toEqual({ panX: 12, panY: 18, zoom: 2 })
    expect({ panX: store.state.panX, panY: store.state.panY, zoom: store.state.zoom }).toEqual({
      panX: 12,
      panY: 18,
      zoom: 2
    })
    expect(renderRequests).toBeGreaterThan(0)

    const nonPageId = store.graph.createNode('RECTANGLE', targetPageId, {
      name: 'Not a Board'
    }).id
    await restoreReloadState(store, {
      pageId: nonPageId,
      viewport: { panX: 1, panY: 2, zoom: 0.8 }
    })
    expect(store.state.currentPageId).toBe(firstPageId)

    store.graph.deleteNode(targetPageId)
    await restoreReloadState(store, {
      pageId: targetPageId,
      viewport: { panX: 3, panY: 4, zoom: 1.1 }
    })
    expect(store.state.currentPageId).toBe(firstPageId)
  })
})
