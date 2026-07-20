import type { SceneNode } from '@open-pencil/scene-graph'
import type { EditorStore } from '../editor/session'
import { DEFAULT_LIVE_FRAME_RADIUS } from '../smylr-production/frame-corners'
import type { SmylrComputedAssetDefinition } from './computed-catalog'
import { SMYLR_COMPUTED_ASSET_RENDERER_VERSION } from './computed-catalog'

const PLUGIN_ID = 'smylr-production'
const LIVE_APP_KIND = 'live-app-frame'
export const SMYLR_LIVE_COMPONENT_PAGE_KIND = 'smylr-live-component-page'

function pluginData(
  key: string,
  value: string
): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find(
    (entry) => entry.pluginId === PLUGIN_ID && entry.key === key
  )?.value
}

function samePluginData(
  left: SceneNode['pluginData'],
  right: SceneNode['pluginData']
) {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.pluginId === right[index]?.pluginId &&
        entry.key === right[index]?.key &&
        entry.value === right[index]?.value
    )
  )
}

export function smylrLiveComponentRoute(asset: SmylrComputedAssetDefinition) {
  return `/open-pencil-renderer?component=${encodeURIComponent(asset.fixtureId)}`
}

export function isSmylrLiveComponentFrame(node: SceneNode | null | undefined) {
  return Boolean(
    node &&
    pluginValue(node, 'kind') === LIVE_APP_KIND &&
    pluginValue(node, 'fixtureId') &&
    pluginValue(node, 'route')?.startsWith('/open-pencil-renderer?component=')
  )
}

function findLiveComponentPage(store: EditorStore, fixtureId: string) {
  return (
    store.graph
      .getPages()
      .find(
        (page) =>
          pluginValue(page, 'kind') === SMYLR_LIVE_COMPONENT_PAGE_KIND &&
          pluginValue(page, 'fixtureId') === fixtureId
      ) ?? null
  )
}

function componentMetadata(asset: SmylrComputedAssetDefinition) {
  return [
    pluginData('componentName', asset.name),
    pluginData('sourcePath', asset.sourcePath),
    pluginData('fixtureId', asset.fixtureId),
    pluginData('rendererVersion', SMYLR_COMPUTED_ASSET_RENDERER_VERSION),
  ]
}

/**
 * Create only the OpenPencil geometry needed to place the runtime. The visible
 * component remains the real Smylr React/DOM tree inside the live app iframe.
 */
export function ensureSmylrLiveComponentCanvas(
  store: EditorStore,
  asset: SmylrComputedAssetDefinition
) {
  let page = findLiveComponentPage(store, asset.fixtureId)
  let changed = false
  if (!page) {
    page = store.graph.addPage(asset.name)
    changed = true
  }

  const pagePluginData = [
    pluginData('kind', SMYLR_LIVE_COMPONENT_PAGE_KIND),
    pluginData('pageId', `component:${asset.fixtureId}`),
    ...componentMetadata(asset),
  ]
  if (
    page.name !== asset.name ||
    !samePluginData(page.pluginData, pagePluginData)
  ) {
    store.graph.updateNode(page.id, {
      name: asset.name,
      pluginData: pagePluginData,
    })
    page = store.graph.getNode(page.id) ?? page
    changed = true
  }

  let frame = store.graph
    .getChildren(page.id)
    .find(
      (node) =>
        pluginValue(node, 'kind') === LIVE_APP_KIND &&
        pluginValue(node, 'state') === 'current'
    )

  const route = smylrLiveComponentRoute(asset)
  if (!frame) {
    frame = store.graph.createNode('FRAME', page.id, {
      x: 96,
      y: 88,
      width: asset.frameWidth,
      height: asset.frameHeight,
      name: `${asset.name} / Live`,
      cornerRadius: DEFAULT_LIVE_FRAME_RADIUS,
      clipsContent: true,
      fills: [],
      strokes: [],
      pluginData: [],
    })
    changed = true
  }

  const framePluginData = [
    pluginData('kind', LIVE_APP_KIND),
    pluginData('pageId', `component:${asset.fixtureId}`),
    pluginData('route', route),
    pluginData('state', 'current'),
    ...componentMetadata(asset),
  ]
  if (
    frame.width !== asset.frameWidth ||
    frame.height !== asset.frameHeight ||
    frame.name !== `${asset.name} / Live` ||
    frame.fills.length > 0 ||
    frame.strokes.length > 0 ||
    !samePluginData(frame.pluginData, framePluginData)
  ) {
    store.graph.updateNode(frame.id, {
      width: asset.frameWidth,
      height: asset.frameHeight,
      name: `${asset.name} / Live`,
      fills: [],
      strokes: [],
      pluginData: framePluginData,
    })
    frame = store.graph.getNode(frame.id) ?? frame
    changed = true
  }

  if (changed) store.requestRender()
  return { page, frame }
}
