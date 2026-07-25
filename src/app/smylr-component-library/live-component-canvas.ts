import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '../editor/session'
import type { SmylrComputedAssetDefinition } from './computed-catalog'
import { SMYLR_COMPUTED_ASSET_RENDERER_VERSION } from './computed-catalog'

const PLUGIN_ID = 'smylr-production'
const LIVE_APP_KIND = 'live-app-frame'
export const SMYLR_LIVE_COMPONENT_PAGE_KIND = 'smylr-live-component-page'

type SmylrLiveComponentRouteOptions = {
  embed?: boolean
  preview?: boolean
}

type LiveComponentFrameSnapshot = Partial<SceneNode> & { id: string }

type SmylrLiveComponentIntrinsicSize = {
  height: number
  width: number
}

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { pluginId: PLUGIN_ID, key, value }
}

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function samePluginData(left: SceneNode['pluginData'], right: SceneNode['pluginData']) {
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

export function smylrLiveComponentRoute(
  asset: SmylrComputedAssetDefinition,
  variantId?: string,
  options: SmylrLiveComponentRouteOptions = {}
) {
  const params = [`component=${encodeURIComponent(asset.fixtureId)}`]
  if (variantId) params.push(`variant=${encodeURIComponent(variantId)}`)
  if (options.embed) params.push('embed=1')
  if (options.preview) params.push('preview=1')
  return `/open-pencil-renderer?${params.join('&')}`
}

export function isSmylrLiveComponentFrame(node: SceneNode | null | undefined) {
  return Boolean(
    node &&
    pluginValue(node, 'kind') === LIVE_APP_KIND &&
    pluginValue(node, 'fixtureId') &&
    pluginValue(node, 'route')?.startsWith('/open-pencil-renderer?component=')
  )
}

export function smylrLiveComponentDisplayName(node: SceneNode) {
  const componentName = pluginValue(node, 'componentName') ?? node.name.split(' / ')[0] ?? node.name
  const variantLabel = pluginValue(node, 'variantLabel')
  return variantLabel ? `${componentName} · ${variantLabel}` : componentName
}

function validIntrinsicDimension(value: number) {
  return Number.isFinite(value) && value >= 1 && value <= 10_000
}

function replacePluginValue(
  pluginDataEntries: SceneNode['pluginData'],
  key: 'intrinsicHeight' | 'intrinsicWidth',
  value: string
) {
  let replaced = false
  const nextEntries = pluginDataEntries.map((entry) => {
    if (entry.pluginId !== PLUGIN_ID || entry.key !== key) return entry
    replaced = true
    return pluginData(key, value)
  })
  return replaced ? nextEntries : [...nextEntries, pluginData(key, value)]
}

export function syncSmylrLiveComponentIntrinsicSize(
  store: EditorStore,
  frameId: string,
  size: SmylrLiveComponentIntrinsicSize
) {
  if (!validIntrinsicDimension(size.width) || !validIntrinsicDimension(size.height)) return false
  const frame = store.graph.getNode(frameId)
  if (!frame || !isSmylrLiveComponentFrame(frame)) return false

  const previousWidth = Number(pluginValue(frame, 'intrinsicWidth'))
  const previousHeight = Number(pluginValue(frame, 'intrinsicHeight'))
  const wasAtIntrinsicSize = frame.width === previousWidth && frame.height === previousHeight
  const width = Math.round(size.width)
  const height = Math.round(size.height)
  let pluginDataEntries = replacePluginValue(frame.pluginData, 'intrinsicWidth', String(width))
  pluginDataEntries = replacePluginValue(pluginDataEntries, 'intrinsicHeight', String(height))
  const pluginDataChanged = !samePluginData(frame.pluginData, pluginDataEntries)
  const frameSizeChanged = wasAtIntrinsicSize && (frame.width !== width || frame.height !== height)
  if (!pluginDataChanged && !frameSizeChanged) return false

  store.graph.updateNode(frame.id, {
    ...(frameSizeChanged ? { height, width } : {}),
    pluginData: pluginDataEntries
  })
  store.requestRender()
  return true
}

function findLiveComponentPage(store: EditorStore, fixtureId: string, variantId?: string) {
  return (
    store.graph
      .getPages()
      .find(
        (page) =>
          pluginValue(page, 'kind') === SMYLR_LIVE_COMPONENT_PAGE_KIND &&
          pluginValue(page, 'fixtureId') === fixtureId &&
          pluginValue(page, 'variantId') === variantId
      ) ?? null
  )
}

function componentMetadata(asset: SmylrComputedAssetDefinition, variantId?: string) {
  const variant = asset.variants.find((candidate) => candidate.id === variantId)
  return [
    pluginData('componentName', asset.name),
    pluginData('sourcePath', asset.sourcePath),
    pluginData('fixtureId', asset.fixtureId),
    pluginData('intrinsicWidth', String(asset.overlayWidth)),
    pluginData('intrinsicHeight', String(asset.interactionHeight)),
    pluginData('rendererVersion', SMYLR_COMPUTED_ASSET_RENDERER_VERSION),
    ...(variant
      ? [pluginData('variantId', variant.id), pluginData('variantLabel', variant.label)]
      : [])
  ]
}

function componentCanvasName(asset: SmylrComputedAssetDefinition, variantId?: string) {
  const variant = asset.variants.find((candidate) => candidate.id === variantId)
  return variant ? `${asset.name} · ${variant.label}` : asset.name
}

/**
 * Create only the OpenPencil geometry needed to place the runtime. The visible
 * component remains the real Smylr React/DOM tree inside the live app iframe.
 */
export function ensureSmylrLiveComponentCanvas(
  store: EditorStore,
  asset: SmylrComputedAssetDefinition,
  variantId?: string
) {
  let page = findLiveComponentPage(store, asset.fixtureId, variantId)
  let changed = false
  if (!page) {
    page = store.graph.addPage(componentCanvasName(asset, variantId))
    changed = true
  }

  const pageIdentity = `component:${asset.fixtureId}${variantId ? `:${variantId}` : ''}`
  const canvasName = componentCanvasName(asset, variantId)
  const pagePluginData = [
    pluginData('kind', SMYLR_LIVE_COMPONENT_PAGE_KIND),
    pluginData('pageId', pageIdentity),
    ...componentMetadata(asset, variantId)
  ]
  if (page.name !== canvasName || !samePluginData(page.pluginData, pagePluginData)) {
    store.graph.updateNode(page.id, {
      name: canvasName,
      pluginData: pagePluginData
    })
    page = store.graph.getNode(page.id) ?? page
    changed = true
  }

  let frame = store.graph
    .getChildren(page.id)
    .find(
      (node) =>
        pluginValue(node, 'kind') === LIVE_APP_KIND && pluginValue(node, 'state') === 'current'
    )

  const route = smylrLiveComponentRoute(asset, variantId, { embed: true })
  if (!frame) {
    frame = store.graph.createNode('FRAME', page.id, {
      x: 96,
      y: 88,
      width: asset.overlayWidth,
      height: asset.interactionHeight,
      name: `${canvasName} / Live`,
      cornerRadius: 0,
      clipsContent: true,
      fills: [],
      strokes: [],
      pluginData: []
    })
    changed = true
  }

  const framePluginData = [
    pluginData('kind', LIVE_APP_KIND),
    pluginData('pageId', pageIdentity),
    pluginData('route', route),
    pluginData('state', 'current'),
    ...componentMetadata(asset, variantId)
  ]
  if (
    frame.width !== asset.overlayWidth ||
    frame.height !== asset.interactionHeight ||
    frame.cornerRadius !== 0 ||
    frame.name !== `${canvasName} / Live` ||
    frame.fills.length > 0 ||
    frame.strokes.length > 0 ||
    !samePluginData(frame.pluginData, framePluginData)
  ) {
    store.graph.updateNode(frame.id, {
      width: asset.overlayWidth,
      height: asset.interactionHeight,
      cornerRadius: 0,
      name: `${canvasName} / Live`,
      fills: [],
      strokes: [],
      pluginData: framePluginData
    })
    frame = store.graph.getNode(frame.id) ?? frame
    changed = true
  }

  if (changed) store.requestRender()
  return { page, frame }
}

/** Place a source-backed Smylr variant on the active board as one undoable live frame. */
export function placeSmylrLiveComponentVariant(
  store: EditorStore,
  asset: SmylrComputedAssetDefinition,
  variantId: string | undefined,
  centerX: number,
  centerY: number
) {
  const parentId = store.state.currentPageId
  const previousSelection = new Set(store.state.selectedIds)
  const variant = asset.variants.find((candidate) => candidate.id === variantId)
  const displayName = variant ? `${asset.name} / ${variant.label}` : `${asset.name} / Live`
  const placedWidth = asset.overlayWidth
  const placedHeight = asset.interactionHeight
  let frame = store.graph.createNode('FRAME', parentId, {
    x: centerX - placedWidth / 2,
    y: centerY - placedHeight / 2,
    width: placedWidth,
    height: placedHeight,
    name: displayName,
    cornerRadius: 0,
    clipsContent: true,
    fills: [],
    strokes: [],
    pluginData: []
  })
  const framePluginData = [
    pluginData('kind', LIVE_APP_KIND),
    pluginData('pageId', parentId),
    pluginData('route', smylrLiveComponentRoute(asset, variantId, { embed: true })),
    pluginData('state', `placed:${frame.id}`),
    ...componentMetadata(asset, variantId)
  ]
  store.graph.updateNode(frame.id, { pluginData: framePluginData })
  frame = store.graph.getNode(frame.id) ?? frame
  const cloned = structuredClone(frame)
  const { childIds: _childIds, parentId: _parentId, type: _type, ...snapshot } = cloned
  const frameSnapshot: LiveComponentFrameSnapshot = snapshot
  const frameId = frame.id

  store.setTool('SELECT')
  store.select([frameId])
  store.pushUndoEntry({
    label: 'Place component variant',
    forward: () => {
      store.graph.createNode('FRAME', parentId, structuredClone(frameSnapshot))
      store.select([frameId])
    },
    inverse: () => {
      store.graph.deleteNode(frameId)
      store.select([...previousSelection])
    }
  })
  store.requestRender()
  return frame
}
