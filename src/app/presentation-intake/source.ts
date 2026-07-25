import type { PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

const PLUGIN_ID = 'open-pencil-pptx'
const KIND_KEY = 'kind'
const KIND = 'source-deck'
const LEGACY_NATIVE_KIND = 'native-deck'
const SLIDE_COUNT_KEY = 'slide-count'

export function pptxDeckPluginData(slideCount: number): PluginDataEntry[] {
  return [
    { key: KIND_KEY, pluginId: PLUGIN_ID, value: KIND },
    { key: SLIDE_COUNT_KEY, pluginId: PLUGIN_ID, value: String(slideCount) }
  ]
}

export function isPptxDeckNode(node: Pick<SceneNode, 'pluginData'> | null | undefined): boolean {
  return Boolean(
    node?.pluginData.some(
      (entry) =>
        entry.pluginId === PLUGIN_ID &&
        entry.key === KIND_KEY &&
        (entry.value === KIND || entry.value === LEGACY_NATIVE_KIND)
    )
  )
}

export function pptxSlideCount(
  node: Pick<SceneNode, 'pluginData'> | null | undefined
): number | null {
  const value = node?.pluginData.find(
    (entry) => entry.pluginId === PLUGIN_ID && entry.key === SLIDE_COUNT_KEY
  )?.value
  const count = value ? Number.parseInt(value, 10) : Number.NaN
  return Number.isSafeInteger(count) && count > 0 ? count : null
}
