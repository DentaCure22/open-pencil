import { describe, expect, test } from 'bun:test'

import {
  DOUBLE_CLICK_FOCUS_MAX_ZOOM,
  DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
} from '@open-pencil/core/constants'

import { createEditorStore } from '@/app/editor/session'
import { revealLocalWorkspaceNavigationTargets } from '@/app/workspace-document/local-authority/reveal'

describe('local workspace navigation reveal', () => {
  test('punches into an already-visible object the same way double-click does', () => {
    const store = createEditorStore()
    store.setViewportSize(1000, 700)
    const pageId = store.state.currentPageId
    const frame = store.graph.createNode('FRAME', pageId, {
      height: 800,
      width: 1200,
      x: 100,
      y: 80
    })
    store.setViewport({ panX: 180, panY: -40, zoom: 0.24 })
    const before = { panX: store.state.panX, panY: store.state.panY, zoom: store.state.zoom }

    expect(revealLocalWorkspaceNavigationTargets(store, { objectIds: [frame.id], pageId })).toBe(
      true
    )

    expect(store.state.selectedIds.has(frame.id)).toBe(true)
    expect(store.state.zoom).not.toBeCloseTo(before.zoom)
    expect(store.state.zoom).toBeCloseTo(
      Math.min(
        (1000 / (frame.width + 160)) * DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER,
        (700 / (frame.height + 160)) * DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER,
        DOUBLE_CLICK_FOCUS_MAX_ZOOM
      )
    )
    expect(store.state.panX + (frame.x + frame.width / 2) * store.state.zoom).toBeCloseTo(500)
    expect(store.state.panY + (frame.y + frame.height / 2) * store.state.zoom).toBeCloseTo(350)
  })
})
