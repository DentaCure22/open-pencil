import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import {
  applySmylrProductionView,
  captureSmylrProductionView,
  smylrProductionPageView
} from '@/app/smylr-production/view-state'

function createProductionStore() {
  const store = createEditorStore()
  store.setViewportSize(1200, 800)
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('test page missing')

  store.graph.updateNode(page.id, {
    pluginData: [
      { key: 'kind', pluginId: 'smylr-production', value: 'smylr-production-page' },
      { key: 'pageId', pluginId: 'smylr-production', value: 'dental-chart' }
    ]
  })
  store.graph.createNode('FRAME', page.id, {
    pluginData: [
      { key: 'kind', pluginId: 'smylr-production', value: 'smylr-code-object-frame' },
      { key: 'pageId', pluginId: 'smylr-production', value: 'dental-chart' }
    ]
  })
  return store
}

describe('Smylr production view tool state', () => {
  test('captures and restores the active tool on Code Object pages', async () => {
    const store = createProductionStore()
    store.setTool('PEN')
    const saved = captureSmylrProductionView(store)

    expect(saved?.activeTool).toBe('PEN')

    store.setTool('SELECT')
    expect(await applySmylrProductionView(store, saved)).toBe(true)
    expect(store.state.activeTool).toBe('PEN')
  })

  test('keeps Move selected when that was the saved tool on a Code Object page', async () => {
    const store = createProductionStore()
    const saved = captureSmylrProductionView(store)

    expect(saved?.activeTool).toBe('SELECT')

    store.setTool('PEN')
    expect(await applySmylrProductionView(store, saved)).toBe(true)
    expect(store.state.activeTool).toBe('SELECT')
  })

  test('uses Move for saved views without tool state', async () => {
    const store = createProductionStore()
    const saved = captureSmylrProductionView(store)
    if (!saved) throw new Error('test view missing')

    store.setTool('PEN')
    expect(
      await applySmylrProductionView(store, {
        page: saved.location,
        viewport: saved.viewport
      })
    ).toBe(true)
    expect(store.state.activeTool).toBe('SELECT')
  })

  test('preserves an ordinary board as the active production workspace view', async () => {
    const store = createProductionStore()
    const boardId = store.addPage('Product Map')
    const board = store.graph.getNode(boardId)
    const saved = captureSmylrProductionView(store)

    expect(smylrProductionPageView(board)).toEqual({ kind: 'ordinary-board', pageId: boardId })
    expect(saved?.location).toEqual({ kind: 'ordinary-board', pageId: boardId })

    await store.switchPage(store.graph.getPages()[0]?.id ?? '')
    expect(await applySmylrProductionView(store, saved)).toBe(true)
    expect(store.state.currentPageId).toBe(boardId)
  })
})
