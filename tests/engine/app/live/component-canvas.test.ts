import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import { SMYLR_COMPUTED_ASSETS } from '@/app/smylr-component-library/computed-catalog'
import {
  ensureSmylrLiveComponentCanvas,
  isSmylrLiveComponentFrame,
  placeSmylrLiveComponentVariant,
  SMYLR_LIVE_COMPONENT_PAGE_KIND,
  smylrLiveComponentRoute
} from '@/app/smylr-component-library/live-component-canvas'
import { isSmylrLiveAppFrameNode, smylrLiveAppFrameRoute } from '@/app/smylr-production/workspace'

function pluginValue(
  node: { pluginData: Array<{ key: string; pluginId: string; value: string }> },
  key: string
) {
  return node.pluginData.find((entry) => entry.pluginId === 'smylr-production' && entry.key === key)
    ?.value
}

describe('Smylr live component canvases', () => {
  test('keeps the source component live and creates only one lightweight runtime frame', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'checkbox')
    expect(asset).toBeDefined()
    if (!asset) return

    const first = ensureSmylrLiveComponentCanvas(store, asset)
    const firstSceneVersion = store.state.sceneVersion
    const second = ensureSmylrLiveComponentCanvas(store, asset)

    expect(second.page.id).toBe(first.page.id)
    expect(second.frame.id).toBe(first.frame.id)
    expect(store.graph.getChildren(first.page.id)).toHaveLength(1)
    expect(pluginValue(first.page, 'kind')).toBe(SMYLR_LIVE_COMPONENT_PAGE_KIND)
    expect(first.frame).toMatchObject({
      fills: [],
      height: asset.frameHeight,
      strokes: [],
      width: asset.frameWidth
    })
    expect(isSmylrLiveAppFrameNode(first.frame)).toBe(true)
    expect(isSmylrLiveComponentFrame(first.frame)).toBe(true)
    expect(smylrLiveAppFrameRoute(first.frame)).toBe(smylrLiveComponentRoute(asset))
    expect(store.graph.getChildren(first.frame.id)).toHaveLength(0)
    expect(store.state.sceneVersion).toBe(firstSceneVersion)
  })

  test('keeps each source variant on one stable live component canvas', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'button')
    expect(asset).toBeDefined()
    if (!asset) return

    const first = ensureSmylrLiveComponentCanvas(store, asset, 'destructive')
    const second = ensureSmylrLiveComponentCanvas(store, asset, 'destructive')
    const outline = ensureSmylrLiveComponentCanvas(store, asset, 'outline')

    expect(second.page.id).toBe(first.page.id)
    expect(second.frame.id).toBe(first.frame.id)
    expect(outline.page.id).not.toBe(first.page.id)
    expect(first.page.name).toBe('Button · Destructive')
    expect(pluginValue(first.frame, 'variantId')).toBe('destructive')
    expect(smylrLiveAppFrameRoute(first.frame)).toBe(
      '/open-pencil-renderer?component=button&variant=destructive'
    )
    expect(smylrLiveComponentRoute(asset, 'outline', { embed: true, preview: true })).toBe(
      '/open-pencil-renderer?component=button&variant=outline&embed=1&preview=1'
    )
  })

  test('places a source-backed variant on the current board with undo and redo', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'badge')
    expect(asset).toBeDefined()
    if (!asset) return

    const frame = placeSmylrLiveComponentVariant(store, asset, 'warning', 420, 280)

    expect(frame.parentId).toBe(store.state.currentPageId)
    expect(frame.x + frame.width / 2).toBe(420)
    expect(frame.y + frame.height / 2).toBe(280)
    expect(pluginValue(frame, 'variantId')).toBe('warning')
    expect(smylrLiveAppFrameRoute(frame)).toBe(
      '/open-pencil-renderer?component=badge&variant=warning'
    )
    expect(store.state.selectedIds).toEqual(new Set([frame.id]))

    store.undoAction()
    expect(store.graph.getNode(frame.id)).toBeUndefined()

    store.redoAction()
    expect(store.graph.getNode(frame.id)).toBeDefined()
    expect(store.state.selectedIds).toEqual(new Set([frame.id]))
  })
})
