import { afterEach, describe, expect, test } from 'bun:test'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { syncAutomationToolState } from '@/app/automation/bridge/tool-handlers'
import { createEditorStore } from '@/app/editor/session'

function installWindowFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('live automation state synchronization', () => {
  test('commits FigmaAPI page and selection changes to the editor', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const figma = makeFigmaFromStore(store)
    const page = figma.createPage()
    page.name = 'Diagram Studio'
    figma.currentPage = page
    const frame = figma.createFrame()
    frame.name = 'Flow Examples'
    frame.resize(1800, 1100)
    figma.currentPage.appendChild(frame)
    figma.currentPage.selection = [frame]

    await syncAutomationToolState(store, figma, 'select_nodes', { selected: [frame.id] })

    expect(store.state.currentPageId).toBe(page.id)
    expect([...store.state.selectedIds]).toEqual([frame.id])
  })

  test('applies viewport tool bounds to the editor viewport', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const frame = store.graph.createNode('FRAME', pageId, {
      height: 1100,
      name: 'Flow Examples',
      width: 1800,
      x: 1950,
      y: 0
    })
    const figma = makeFigmaFromStore(store)

    await syncAutomationToolState(store, figma, 'viewport_zoom_to_fit', {
      bounds: { height: frame.height, width: frame.width, x: frame.x, y: frame.y }
    })

    expect(store.state.zoom).toBeLessThan(1)
    expect(store.state.panX).toBeLessThan(0)
    expect(store.state.panY).toBeGreaterThan(0)
  })
})
