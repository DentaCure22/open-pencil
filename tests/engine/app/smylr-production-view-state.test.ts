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
      { key: 'kind', pluginId: 'smylr-production', value: 'live-app-frame' },
      { key: 'pageId', pluginId: 'smylr-production', value: 'dental-chart' }
    ]
  })
  return store
}

describe('Smylr production view tool state', () => {
  test('captures and restores the active tool instead of inferring it from live frames', async () => {
    const store = createProductionStore()
    store.setTool('SMYLR_CONTAINER')
    const saved = captureSmylrProductionView(store)

    expect(saved?.activeTool).toBe('SMYLR_CONTAINER')

    store.setTool('SELECT')
    expect(await applySmylrProductionView(store, saved)).toBe(true)
    expect(store.state.activeTool).toBe('SMYLR_CONTAINER')
  })

  test('keeps Move selected when that was the saved tool on a live-frame page', async () => {
    const store = createProductionStore()
    const saved = captureSmylrProductionView(store)

    expect(saved?.activeTool).toBe('SELECT')

    store.setTool('SMYLR_CONTAINER')
    expect(await applySmylrProductionView(store, saved)).toBe(true)
    expect(store.state.activeTool).toBe('SELECT')
  })

  test('uses Move for legacy saved views without tool state', async () => {
    const store = createProductionStore()
    const saved = captureSmylrProductionView(store)
    if (!saved) throw new Error('test view missing')

    store.setTool('SMYLR_CONTAINER')
    expect(
      await applySmylrProductionView(store, {
        page: saved.location,
        viewport: saved.viewport
      })
    ).toBe(true)
    expect(store.state.activeTool).toBe('SELECT')
  })

  test('gives each experience purpose an independent view-memory identity', () => {
    const store = createProductionStore()
    const page = store.graph.getPages()[0]
    if (!page) throw new Error('test page missing')

    store.graph.updateNode(page.id, {
      pluginData: [
        ...page.pluginData,
        {
          key: 'basePageId',
          pluginId: 'openpencil-knowledge-workspace',
          value: 'dental-chart-base'
        },
        {
          key: 'experiencePurpose',
          pluginId: 'openpencil-knowledge-workspace',
          value: 'compare'
        }
      ]
    })

    expect(smylrProductionPageView(store.graph.getNode(page.id))).toEqual({
      kind: 'experience-compare',
      pageId: 'dental-chart-base'
    })
    expect(captureSmylrProductionView(store)?.location).toEqual({
      kind: 'experience-compare',
      pageId: 'dental-chart-base'
    })
  })
})
