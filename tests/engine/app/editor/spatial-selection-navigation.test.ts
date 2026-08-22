import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'

describe('spatial selection navigation', () => {
  test('selects and centers the nearest visible sibling in the requested direction', () => {
    const store = createEditorStore()
    store.setViewportSize(800, 600)
    const pageId = store.state.currentPageId
    const source = store.graph.createNode('RECTANGLE', pageId, {
      height: 100,
      name: 'Source',
      width: 100,
      x: 100,
      y: 100
    })
    const nearest = store.graph.createNode('RECTANGLE', pageId, {
      height: 100,
      name: 'Nearest',
      width: 100,
      x: 400,
      y: 140
    })
    store.graph.createNode('RECTANGLE', pageId, {
      height: 100,
      name: 'Farther aligned',
      width: 100,
      x: 800,
      y: 100
    })
    store.graph.createNode('RECTANGLE', pageId, {
      height: 100,
      locked: true,
      name: 'Locked closer',
      width: 100,
      x: 250,
      y: 100
    })
    store.select([source.id])
    store.setViewport({ panX: 23, panY: -41, zoom: 1.5 })

    expect(store.spatialSelectionNavigation.navigateInDirection('right')).toBe(true)
    expect([...store.state.selectedIds]).toEqual([nearest.id])
    expect(store.state.zoom).toBe(1.5)
    expect(store.state.panX + (nearest.x + nearest.width / 2) * store.state.zoom).toBeCloseTo(400)
    expect(store.state.panY + (nearest.y + nearest.height / 2) * store.state.zoom).toBeCloseTo(300)
    expect(store.undo.canUndo).toBe(false)
  })

  test('moves outward to the nearest sibling container when the current scope has no target', () => {
    const store = createEditorStore()
    store.setViewportSize(800, 600)
    const pageId = store.state.currentPageId
    const left = store.graph.createNode('FRAME', pageId, {
      height: 400,
      name: 'Left frame',
      width: 400,
      x: 100,
      y: 100
    })
    const child = store.graph.createNode('RECTANGLE', left.id, {
      height: 80,
      name: 'Only child',
      width: 80,
      x: 40,
      y: 40
    })
    const right = store.graph.createNode('FRAME', pageId, {
      height: 400,
      name: 'Right frame',
      width: 400,
      x: 700,
      y: 100
    })
    store.select([child.id])

    expect(store.spatialSelectionNavigation.navigateInDirection('right')).toBe(true)
    expect([...store.state.selectedIds]).toEqual([right.id])
  })
})
