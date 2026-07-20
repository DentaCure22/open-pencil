import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditor } from '#core/editor'

describe('viewport fitting', () => {
  test('centers content inside the unobstructed viewport insets', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    if (!page) throw new Error('Expected a page')
    const frame = graph.createNode('FRAME', page.id, {
      x: 100,
      y: 50,
      width: 1000,
      height: 800
    })
    const editor = createEditor({
      graph,
      getViewportSize: () => ({ width: 1000, height: 700 }),
      skipInitialGraphSetup: true
    })

    editor.zoomToFit({ left: 200, right: 100, top: 50, bottom: 100 })

    const left = frame.x * editor.state.zoom + editor.state.panX
    const right = (frame.x + frame.width) * editor.state.zoom + editor.state.panX
    const top = frame.y * editor.state.zoom + editor.state.panY
    const bottom = (frame.y + frame.height) * editor.state.zoom + editor.state.panY

    expect(left).toBeGreaterThan(200)
    expect(right).toBeLessThan(900)
    expect(top).toBeGreaterThan(50)
    expect(bottom).toBeLessThan(600)
    expect((left + right) / 2).toBeCloseTo(550)
    expect((top + bottom) / 2).toBeCloseTo(325)
  })

  test('fits an unseen page and restores its focal point when chrome changes', async () => {
    const graph = new SceneGraph()
    const firstPage = graph.getPages()[0]
    if (!firstPage) throw new Error('Expected a page')
    graph.createNode('FRAME', firstPage.id, {
      x: 0,
      y: 0,
      width: 400,
      height: 300
    })
    const secondPage = graph.addPage('Second')
    const frame = graph.createNode('FRAME', secondPage.id, {
      x: 200,
      y: 100,
      width: 900,
      height: 600
    })
    graph.createNode('FRAME', secondPage.id, {
      x: 1600,
      y: 100,
      width: 900,
      height: 600
    })
    const editor = createEditor({
      graph,
      getViewportSize: () => ({ width: 1200, height: 800 }),
      skipInitialGraphSetup: true
    })
    const sidebarOpen = { bottom: 70, left: 260, right: 14, top: 70 }

    await editor.switchPage(secondPage.id, {
      fitNodeIdOnFirstVisit: frame.id,
      fitOnFirstVisit: true,
      viewportInsets: sidebarOpen
    })

    const openCenter = {
      x: sidebarOpen.left + (1200 - sidebarOpen.left - sidebarOpen.right) / 2,
      y: sidebarOpen.top + (800 - sidebarOpen.top - sidebarOpen.bottom) / 2
    }
    const frameCenter = {
      x: editor.state.panX + (frame.x + frame.width / 2) * editor.state.zoom,
      y: editor.state.panY + (frame.y + frame.height / 2) * editor.state.zoom
    }
    expect(frameCenter.x).toBeCloseTo(openCenter.x)
    expect(frameCenter.y).toBeCloseTo(openCenter.y)

    editor.setZoomAroundPoint(editor.state.zoom * 1.4, openCenter.x, openCenter.y)
    editor.pan(53, -37)
    const savedZoom = editor.state.zoom
    const savedFocus = {
      x: (openCenter.x - editor.state.panX) / editor.state.zoom,
      y: (openCenter.y - editor.state.panY) / editor.state.zoom
    }

    await editor.switchPage(firstPage.id, { viewportInsets: sidebarOpen })

    const sidebarClosed = { bottom: 70, left: 14, right: 14, top: 70 }
    await editor.switchPage(secondPage.id, { viewportInsets: sidebarClosed })

    const closedCenter = {
      x: sidebarClosed.left + (1200 - sidebarClosed.left - sidebarClosed.right) / 2,
      y: sidebarClosed.top + (800 - sidebarClosed.top - sidebarClosed.bottom) / 2
    }
    const restoredFocus = {
      x: (closedCenter.x - editor.state.panX) / editor.state.zoom,
      y: (closedCenter.y - editor.state.panY) / editor.state.zoom
    }
    expect(editor.state.zoom).toBeCloseTo(savedZoom)
    expect(restoredFocus.x).toBeCloseTo(savedFocus.x)
    expect(restoredFocus.y).toBeCloseTo(savedFocus.y)
  })
})
