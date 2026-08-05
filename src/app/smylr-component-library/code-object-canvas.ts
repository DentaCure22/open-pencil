import type { SceneNode } from '@open-pencil/scene-graph'

import {
  codeObjectDocument,
  createUserCodeObjectDocument,
  isCodeObjectFrame,
  setCodeObjectDocument
} from '@/app/code-object/model'

import type { EditorStore } from '../editor/session'
import type { SmylrComputedAssetDefinition } from './computed-catalog'
import { SMYLR_COMPUTED_ASSET_RENDERER_VERSION } from './computed-catalog'

const PLUGIN_ID = 'smylr-production'
const SMYLR_COMPONENT_CODE_OBJECT_KIND = 'smylr-component-code-object'
export const SMYLR_COMPONENT_CODE_OBJECT_PAGE_KIND = 'smylr-component-code-object-page'

type ComponentFrameSnapshot = Partial<SceneNode> & { id: string }

type SmylrComponentPreviewRouteOptions = {
  embed?: boolean
  preview?: boolean
}

const SMYLR_COMPONENT_SOURCE = `type CodeObjectProps = {
  interactionEnabled: boolean
  props: {
    componentName?: string
    sourcePath?: string
    variantLabel?: string
    variantProps?: Record<string, string>
  }
  setState: (next: { active: boolean }) => void
  state: { active?: boolean }
}

export default function SmylrComponent({
  interactionEnabled,
  props,
  setState,
  state
}: CodeObjectProps) {
  const entries = Object.entries(props.variantProps ?? {})
  return (
    <main style={{
      boxSizing: 'border-box',
      minHeight: '100%',
      padding: 24,
      color: '#1d2b34',
      fontFamily: 'Inter, ui-sans-serif, system-ui',
      background: '#f7faf9'
    }}>
      <section style={{
        display: 'flex',
        minHeight: 180,
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 18,
        border: state.active ? '2px solid #20a98b' : '1px solid #dce5e2',
        borderRadius: 16,
        padding: 20,
        background: '#fff',
        boxShadow: '0 12px 36px #18332b14'
      }}>
        <div>
          <p style={{ margin: 0, color: '#628078', fontSize: 10, fontWeight: 800, letterSpacing: 1.2 }}>
            SMYLR CODE OBJECT
          </p>
          <h1 style={{ margin: '8px 0 4px', fontSize: 22 }}>
            {props.componentName ?? 'Smylr component'}
          </h1>
          <p style={{ margin: 0, color: '#71827d', fontSize: 12 }}>
            {props.variantLabel ?? 'Default variant'}
          </p>
        </div>
        {entries.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {entries.map(([name, value]) => (
              <span key={name} style={{
                borderRadius: 999,
                padding: '6px 9px',
                color: '#2b5e52',
                fontSize: 10,
                fontWeight: 700,
                background: '#e8f6f2'
              }}>
                {name}: {value}
              </span>
            ))}
          </div>
        ) : null}
        <button
          disabled={!interactionEnabled}
          onClick={() => setState({ active: !state.active })}
          style={{
            alignSelf: 'flex-start',
            border: 0,
            borderRadius: 10,
            padding: '9px 13px',
            color: '#fff',
            cursor: interactionEnabled ? 'pointer' : 'default',
            fontSize: 11,
            fontWeight: 800,
            background: state.active ? '#1d7d69' : '#263c35'
          }}
        >
          {state.active ? 'Active' : 'Try component'}
        </button>
      </section>
    </main>
  )
}`

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

export function isSmylrComponentCodeObject(node: SceneNode | null | undefined) {
  return Boolean(
    isCodeObjectFrame(node) &&
    node &&
    pluginValue(node, 'kind') === SMYLR_COMPONENT_CODE_OBJECT_KIND
  )
}

export function smylrComponentDisplayName(node: SceneNode) {
  const componentName = pluginValue(node, 'componentName') ?? node.name.split(' / ')[0] ?? node.name
  const variantLabel = pluginValue(node, 'variantLabel')
  return variantLabel ? `${componentName} · ${variantLabel}` : componentName
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
    pluginData('componentName', asset.name),
    pluginData('sourcePath', asset.sourcePath),
    pluginData('fixtureId', asset.fixtureId),
    pluginData('rendererVersion', SMYLR_COMPUTED_ASSET_RENDERER_VERSION),
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
  const variant = asset.variants.find((candidate) => candidate.id === variantId)
  return createUserCodeObjectDocument({
    definitionId: `smylr.component.${asset.fixtureId}${variant ? `.${variant.id}` : ''}`,
    name: componentName(asset, variantId),
    props: {
      componentName: asset.name,
      sourcePath: asset.sourcePath,
      variantLabel: variant?.label ?? 'Default',
      variantProps: structuredClone(variant?.props ?? {})
    },
    source: SMYLR_COMPONENT_SOURCE,
    state: { active: false }
  })
}

function updateComponentFrame(
  store: EditorStore,
  frame: SceneNode,
  asset: SmylrComputedAssetDefinition,
  variantId?: string
) {
  const metadata = [
    ...frame.pluginData.filter((entry) => entry.pluginId !== PLUGIN_ID),
    pluginData('kind', SMYLR_COMPONENT_CODE_OBJECT_KIND),
    ...componentMetadata(asset, variantId)
  ]
  const document = componentDocument(asset, variantId)
  const currentDocument = codeObjectDocument(frame)
  const metadataChanged = !samePluginData(frame.pluginData, metadata)
  if (metadataChanged) store.graph.updateNode(frame.id, { pluginData: metadata })
  const documentChanged = currentDocument?.component !== 'user-code'
  if (documentChanged) setCodeObjectDocument(store.graph, frame.id, document)
  return metadataChanged || documentChanged
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

  let frame = store.graph
    .getChildren(page.id)
    .find((node) => pluginValue(node, 'kind') === SMYLR_COMPONENT_CODE_OBJECT_KIND)
  if (!frame) {
    frame = store.graph.createNode('FRAME', page.id, {
      clipsContent: true,
      cornerRadius: 0,
      fills: [],
      height: asset.interactionHeight,
      name: componentName(asset, variantId),
      pluginData: [],
      strokes: [],
      width: asset.overlayWidth,
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
  let frame = store.graph.createNode('FRAME', parentId, {
    clipsContent: true,
    cornerRadius: 0,
    fills: [],
    height: asset.interactionHeight,
    name: displayName,
    pluginData: [],
    strokes: [],
    width: asset.overlayWidth,
    x: centerX - asset.overlayWidth / 2,
    y: centerY - asset.interactionHeight / 2
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
