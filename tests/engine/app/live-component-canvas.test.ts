import { createEditorStore } from '@/app/editor/session'
import { SMYLR_COMPUTED_ASSETS } from '@/app/smylr-component-library/computed-catalog'
import {
  ensureSmylrLiveComponentCanvas,
  isSmylrLiveComponentFrame,
  SMYLR_LIVE_COMPONENT_PAGE_KIND,
  smylrLiveComponentRoute,
} from '@/app/smylr-component-library/live-component-canvas'
import {
  isSmylrLiveAppFrameNode,
  smylrLiveAppFrameRoute,
} from '@/app/smylr-production/workspace'
import { describe, expect, test } from 'bun:test'

function pluginValue(
  node: { pluginData: Array<{ key: string; pluginId: string; value: string }> },
  key: string
) {
  return node.pluginData.find(
    (entry) => entry.pluginId === 'smylr-production' && entry.key === key
  )?.value
}

describe('Smylr live component canvases', () => {
  test('keeps the source component live and creates only one lightweight runtime frame', () => {
    const store = createEditorStore()
    const asset = SMYLR_COMPUTED_ASSETS.find(
      (candidate) => candidate.fixtureId === 'checkbox'
    )
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
      width: asset.frameWidth,
    })
    expect(isSmylrLiveAppFrameNode(first.frame)).toBe(true)
    expect(isSmylrLiveComponentFrame(first.frame)).toBe(true)
    expect(smylrLiveAppFrameRoute(first.frame)).toBe(
      smylrLiveComponentRoute(asset)
    )
    expect(store.graph.getChildren(first.frame.id)).toHaveLength(0)
    expect(store.state.sceneVersion).toBe(firstSceneVersion)
  })
})
