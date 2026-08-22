import type { Fill, SceneNode, Stroke } from '@open-pencil/scene-graph'

import {
  codeObjectDocument,
  createSmylrProductionAppDocument,
  setCodeObjectDocument
} from '@/app/code-object/model'

import type { EditorStore } from '../editor/session'
import {
  SMYLR_COMPUTED_ASSET_RENDERER_VERSION,
  type SmylrComputedAssetDefinition
} from './computed-catalog'
import {
  isSmylrComponentCodeObject,
  smylrComponentSurfaceHeight,
  SMYLR_COMPONENT_CODE_OBJECT_KIND,
  SMYLR_COMPONENT_SURFACE_INSET
} from './runtime'

export {
  isSmylrComponentCodeObject,
  smylrComponentDisplayName,
  smylrComponentRuntimeHeight,
  smylrComponentViewport,
  SMYLR_COMPONENT_SURFACE_INSET,
  type SmylrComponentViewport
} from './runtime'

const PLUGIN_ID = 'smylr-production'
const SMYLR_COMPONENT_METADATA_KEYS = new Set([
  'componentKind',
  'componentName',
  'sourcePath',
  'fixtureId',
  'frameHeight',
  'frameWidth',
  'interactionHeight',
  'overlayHeight',
  'overlayWidth',
  'rendererVersion',
  'surfaceInset',
  'variantId',
  'variantLabel'
])
export const SMYLR_COMPONENT_SURFACE_CORNER_RADIUS = 20
export const SMYLR_COMPONENT_CODE_OBJECT_PAGE_KIND = 'smylr-component-code-object-page'

const SMYLR_COMPONENT_SURFACE_FILL: Fill = {
  color: { a: 1, b: 249 / 255, g: 250 / 255, r: 250 / 255 },
  opacity: 1,
  type: 'SOLID',
  visible: true
}
const SMYLR_COMPONENT_SURFACE_STROKE: Stroke = {
  align: 'INSIDE',
  color: { a: 1, b: 232 / 255, g: 232 / 255, r: 228 / 255 },
  opacity: 1,
  visible: true,
  weight: 1
}

type ComponentFrameSnapshot = Partial<SceneNode> & { id: string }

type SmylrComponentPreviewRouteOptions = {
  embed?: boolean
  preview?: boolean
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

function componentSurfaceProps(asset: SmylrComputedAssetDefinition) {
  return {
    clipsContent: false,
    cornerRadius: SMYLR_COMPONENT_SURFACE_CORNER_RADIUS,
    fills: [{ ...SMYLR_COMPONENT_SURFACE_FILL, color: { ...SMYLR_COMPONENT_SURFACE_FILL.color } }],
    height: smylrComponentSurfaceHeight(asset),
    strokes: [
      { ...SMYLR_COMPONENT_SURFACE_STROKE, color: { ...SMYLR_COMPONENT_SURFACE_STROKE.color } }
    ],
    width: asset.frameWidth
  }
}

export function smylrComponentPreviewRoute(
  asset: SmylrComputedAssetDefinition,
  variantId?: string,
  options: SmylrComponentPreviewRouteOptions = {}
) {
  const params = [`component=${encodeURIComponent(asset.fixtureId)}`]
  if (variantId) params.push(`variant=${encodeURIComponent(variantId)}`)
  if (options.embed) params.push('embed=1')
  if (options.preview) params.push('preview=1')
  return `/open-pencil-renderer?${params.join('&')}`
}

function findComponentPage(store: EditorStore, fixtureId: string, variantId?: string) {
  return (
    store.graph
      .getPages()
      .find(
        (page) =>
          pluginValue(page, 'kind') === SMYLR_COMPONENT_CODE_OBJECT_PAGE_KIND &&
          pluginValue(page, 'fixtureId') === fixtureId &&
          pluginValue(page, 'variantId') === variantId
      ) ?? null
  )
}

function componentMetadata(asset: SmylrComputedAssetDefinition, variantId?: string) {
  const variant = asset.variants.find((candidate) => candidate.id === variantId)
  return [
    pluginData('componentKind', SMYLR_COMPONENT_CODE_OBJECT_KIND),
    pluginData('componentName', asset.name),
    pluginData('sourcePath', asset.sourcePath),
    pluginData('fixtureId', asset.fixtureId),
    pluginData('frameHeight', String(asset.frameHeight)),
    pluginData('frameWidth', String(asset.frameWidth)),
    pluginData('interactionHeight', String(asset.interactionHeight)),
    pluginData('overlayHeight', String(asset.overlayHeight)),
    pluginData('overlayWidth', String(asset.overlayWidth)),
    pluginData('rendererVersion', SMYLR_COMPUTED_ASSET_RENDERER_VERSION),
    pluginData('surfaceInset', String(SMYLR_COMPONENT_SURFACE_INSET)),
    ...(variant
      ? [pluginData('variantId', variant.id), pluginData('variantLabel', variant.label)]
      : [])
  ]
}

function componentName(asset: SmylrComputedAssetDefinition, variantId?: string) {
  const variant = asset.variants.find((candidate) => candidate.id === variantId)
  return variant ? `${asset.name} · ${variant.label}` : asset.name
}

function componentDocument(asset: SmylrComputedAssetDefinition, variantId?: string) {
  return createSmylrProductionAppDocument({
    label: componentName(asset, variantId),
    route: smylrComponentPreviewRoute(asset, variantId, { embed: true })
  })
}

function updateComponentFrame(
  store: EditorStore,
  frame: SceneNode,
  asset: SmylrComputedAssetDefinition,
  variantId?: string
) {
  const document = componentDocument(asset, variantId)
  const currentDocument = codeObjectDocument(frame)
  const documentChanged = JSON.stringify(currentDocument) !== JSON.stringify(document)
  if (documentChanged) setCodeObjectDocument(store.graph, frame.id, document)
  const currentFrame = store.graph.getNode(frame.id) ?? frame
  const metadata = [
    ...currentFrame.pluginData.filter(
      (entry) => entry.pluginId !== PLUGIN_ID || !SMYLR_COMPONENT_METADATA_KEYS.has(entry.key)
    ),
    ...componentMetadata(asset, variantId)
  ]
  const metadataChanged = !samePluginData(currentFrame.pluginData, metadata)
  const surface = componentSurfaceProps(asset)
  const surfaceChanged =
    currentFrame.clipsContent !== surface.clipsContent ||
    currentFrame.cornerRadius !== surface.cornerRadius ||
    currentFrame.height !== surface.height ||
    currentFrame.width !== surface.width ||
    JSON.stringify(currentFrame.fills) !== JSON.stringify(surface.fills) ||
    JSON.stringify(currentFrame.strokes) !== JSON.stringify(surface.strokes)
  if (metadataChanged || surfaceChanged) {
    store.graph.updateNode(frame.id, { ...surface, pluginData: metadata })
  }
  return metadataChanged || surfaceChanged || documentChanged
}

export function ensureSmylrComponentCodeObjectCanvas(
  store: EditorStore,
  asset: SmylrComputedAssetDefinition,
  variantId?: string
) {
  let page = findComponentPage(store, asset.fixtureId, variantId)
  let changed = false
  if (!page) {
    page = store.graph.addPage(componentName(asset, variantId))
    changed = true
  }

  const pagePluginData = [
    pluginData('kind', SMYLR_COMPONENT_CODE_OBJECT_PAGE_KIND),
    pluginData('fixtureId', asset.fixtureId),
    ...componentMetadata(asset, variantId)
  ]
  if (
    page.name !== componentName(asset, variantId) ||
    !samePluginData(page.pluginData, pagePluginData)
  ) {
    store.graph.updateNode(page.id, {
      name: componentName(asset, variantId),
      pluginData: pagePluginData
    })
    page = store.graph.getNode(page.id) ?? page
    changed = true
  }

  let frame = store.graph.getChildren(page.id).find((node) => isSmylrComponentCodeObject(node))
  if (!frame) {
    frame = store.graph.createNode('FRAME', page.id, {
      ...componentSurfaceProps(asset),
      name: componentName(asset, variantId),
      pluginData: [],
      x: 96,
      y: 88
    })
    changed = true
  }
  if (updateComponentFrame(store, frame, asset, variantId)) changed = true
  frame = store.graph.getNode(frame.id) ?? frame
  if (changed) store.requestRender()
  return { page, frame }
}

/** Place a Smylr component on the active Board as one ordinary Code Object. */
export function placeSmylrComponentCodeObject(
  store: EditorStore,
  asset: SmylrComputedAssetDefinition,
  variantId: string | undefined,
  centerX: number,
  centerY: number
) {
  const parentId = store.state.currentPageId
  const previousSelection = new Set(store.state.selectedIds)
  const displayName = componentName(asset, variantId)
  const surface = componentSurfaceProps(asset)
  let frame = store.graph.createNode('FRAME', parentId, {
    ...surface,
    name: displayName,
    pluginData: [],
    x: centerX - surface.width / 2,
    y: centerY - surface.height / 2
  })
  updateComponentFrame(store, frame, asset, variantId)
  frame = store.graph.getNode(frame.id) ?? frame
  const cloned = structuredClone(frame)
  const { childIds: _childIds, parentId: _parentId, type: _type, ...snapshot } = cloned
  const frameSnapshot: ComponentFrameSnapshot = snapshot
  const frameId = frame.id

  store.setTool('SELECT')
  store.select([frameId])
  store.pushUndoEntry({
    label: 'Place Smylr Code Object',
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
