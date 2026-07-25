import { describe, expect, test } from 'bun:test'

import { deserializeSceneGraph, serializeSceneGraph } from '@open-pencil/core/kiwi'

import { createEditorStore } from '@/app/editor/session'
import { SMYLR_COMPUTED_ASSETS } from '@/app/smylr-component-library/computed-catalog'
import {
  ensureSmylrLiveComponentCanvas,
  isSmylrLiveComponentFrame,
  placeSmylrLiveComponentVariant,
  SMYLR_LIVE_COMPONENT_PAGE_KIND,
  smylrLiveComponentDisplayName,
  smylrLiveComponentRoute,
  syncSmylrLiveComponentIntrinsicSize
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
      cornerRadius: 0,
      fills: [],
      height: asset.interactionHeight,
      strokes: [],
      width: asset.overlayWidth
    })
    expect(isSmylrLiveAppFrameNode(first.frame)).toBe(true)
    expect(isSmylrLiveComponentFrame(first.frame)).toBe(true)
    expect(smylrLiveComponentDisplayName(first.frame)).toBe('Checkbox')
    expect(smylrLiveAppFrameRoute(first.frame)).toBe(
      smylrLiveComponentRoute(asset, undefined, { embed: true })
    )
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
      '/open-pencil-renderer?component=button&variant=destructive&embed=1'
    )
    expect(smylrLiveComponentRoute(asset, 'outline', { embed: true, preview: true })).toBe(
      '/open-pencil-renderer?component=button&variant=outline&embed=1&preview=1'
    )
  })

  test('keeps intrinsic source bounds when the responsive runtime frame is resized', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'button')
    expect(asset).toBeDefined()
    if (!asset) return

    const frame = placeSmylrLiveComponentVariant(store, asset, 'default', 420, 280)
    store.graph.updateNode(frame.id, {
      height: asset.interactionHeight * 1.5,
      width: asset.overlayWidth * 2
    })
    const resized = store.graph.getNode(frame.id)

    expect(resized).toBeDefined()
    if (!resized) return
    expect(resized.width).toBe(asset.overlayWidth * 2)
    expect(resized.height).toBe(asset.interactionHeight * 1.5)
    expect(pluginValue(resized, 'intrinsicWidth')).toBe(String(asset.overlayWidth))
    expect(pluginValue(resized, 'intrinsicHeight')).toBe(String(asset.interactionHeight))
  })

  test('learns the real DOM bounds without undoing a user resize', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'button-group')
    expect(asset).toBeDefined()
    if (!asset) return

    const intrinsicFrame = placeSmylrLiveComponentVariant(store, asset, 'plain', 420, 280)
    expect(
      syncSmylrLiveComponentIntrinsicSize(store, intrinsicFrame.id, { height: 24, width: 160 })
    ).toBe(true)
    expect(store.graph.getNode(intrinsicFrame.id)).toMatchObject({ height: 24, width: 160 })

    store.graph.updateNode(intrinsicFrame.id, { height: 177, width: 382 })
    expect(
      syncSmylrLiveComponentIntrinsicSize(store, intrinsicFrame.id, { height: 26, width: 164 })
    ).toBe(true)
    const resized = store.graph.getNode(intrinsicFrame.id)
    expect(resized).toMatchObject({ height: 177, width: 382 })
    expect(resized && pluginValue(resized, 'intrinsicWidth')).toBe('164')
    expect(resized && pluginValue(resized, 'intrinsicHeight')).toBe('26')
  })

  test('places a source-backed variant on the current board with undo and redo', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'badge')
    expect(asset).toBeDefined()
    if (!asset) return

    const frame = placeSmylrLiveComponentVariant(store, asset, 'warning', 420, 280)

    expect(frame.parentId).toBe(store.state.currentPageId)
    expect(frame.fills).toEqual([])
    expect(frame.strokes).toEqual([])
    expect(frame.width).toBe(asset.overlayWidth)
    expect(frame.height).toBe(asset.interactionHeight)
    expect(frame.x + frame.width / 2).toBe(420)
    expect(frame.y + frame.height / 2).toBe(280)
    expect(pluginValue(frame, 'variantId')).toBe('warning')
    expect(smylrLiveComponentDisplayName(frame)).toBe('Badge · Warning')
    expect(smylrLiveAppFrameRoute(frame)).toBe(
      '/open-pencil-renderer?component=badge&variant=warning&embed=1'
    )
    expect(store.state.selectedIds).toEqual(new Set([frame.id]))

    store.undoAction()
    expect(store.graph.getNode(frame.id)).toBeUndefined()

    store.redoAction()
    expect(store.graph.getNode(frame.id)).toBeDefined()
    expect(store.state.selectedIds).toEqual(new Set([frame.id]))
  })

  test('persists the chosen source variant and its moved board position', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find(
      (candidate) => candidate.fixtureId === 'sensitive-input'
    )
    expect(asset).toBeDefined()
    if (!asset) return

    const frame = placeSmylrLiveComponentVariant(store, asset, 'visible', 420, 280)
    const movedX = frame.x + 72
    const movedY = frame.y + 36
    store.graph.updateNode(frame.id, { x: movedX, y: movedY })
    const reloaded = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    const persisted = reloaded.getNode(frame.id)

    expect(persisted).toBeDefined()
    if (!persisted) return
    expect(persisted.x).toBe(movedX)
    expect(persisted.y).toBe(movedY)
    expect(persisted.width).toBe(asset.overlayWidth)
    expect(persisted.height).toBe(asset.interactionHeight)
    expect(pluginValue(persisted, 'variantId')).toBe('visible')
    expect(smylrLiveAppFrameRoute(persisted)).toBe(
      '/open-pencil-renderer?component=sensitive-input&variant=visible&embed=1'
    )
  })

  test('persists an open overlay fixture as a transparent movable board object', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find((candidate) => candidate.fixtureId === 'popover')
    expect(asset).toBeDefined()
    if (!asset) return

    const frame = placeSmylrLiveComponentVariant(store, asset, 'open', 510, 340)
    const movedX = frame.x - 48
    const movedY = frame.y + 64
    store.graph.updateNode(frame.id, { x: movedX, y: movedY })
    const reloaded = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    const persisted = reloaded.getNode(frame.id)

    expect(persisted).toBeDefined()
    if (!persisted) return
    expect(persisted.fills).toEqual([])
    expect(persisted.strokes).toEqual([])
    expect(persisted.x).toBe(movedX)
    expect(persisted.y).toBe(movedY)
    expect(persisted.width).toBe(asset.overlayWidth)
    expect(persisted.height).toBe(asset.interactionHeight)
    expect(pluginValue(persisted, 'variantId')).toBe('open')
    expect(smylrLiveAppFrameRoute(persisted)).toBe(
      '/open-pencil-renderer?component=popover&variant=open&embed=1'
    )
  })
})
