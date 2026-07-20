/**
 * Live Smylr containers → OpenPencil LayerTree (one layers system).
 *
 * Rules:
 * - Show every container from the live tree (no depth caps, no silent drops).
 * - Prefer readable names (component / data-slot / label).
 * - Expansion is owned by LayerTreeRoot (focused by default, selection reveals its path).
 */
import { computed, ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'
import type { LayerNode, LayerTreeHostBridge } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import {
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorInteractionMode,
  liveInspectorPendingSelectedId,
  liveInspectorSelectedId,
  liveInspectorStatus,
  selectLiveInspectorNode,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import {
  designSectionAnchorId,
  getDesignOutlineChildren,
  isDesignSectionId
} from '@/app/smylr-production/design-layer-outline'
import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'

export const LIVE_LAYER_ID_PREFIX = 'live:'

const GENERIC_LABELS = new Set([
  'div',
  'span',
  'section',
  'main',
  'aside',
  'header',
  'footer',
  'nav',
  'article',
  'form',
  'ul',
  'ol',
  'li',
  'body',
  'html',
  'button',
  'a',
  'p',
  'img',
  'svg',
  'path',
  'container',
  'root'
])

export function toLiveLayerId(nodeId: string): string {
  return nodeId.startsWith(LIVE_LAYER_ID_PREFIX) ? nodeId : `${LIVE_LAYER_ID_PREFIX}${nodeId}`
}

export function fromLiveLayerId(layerId: string): string | null {
  if (!layerId.startsWith(LIVE_LAYER_ID_PREFIX)) return null
  return layerId.slice(LIVE_LAYER_ID_PREFIX.length)
}

export function isLiveLayerId(id: string): boolean {
  return id.startsWith(LIVE_LAYER_ID_PREFIX)
}

function attr(node: SmylrLiveContainerNode, key: string): string | undefined {
  return node.attrs?.[key]?.trim() || undefined
}

/** Readable layer name — never drop the node, only rename. */
export function displayNameForLiveNode(node: SmylrLiveContainerNode): string {
  const component = node.source?.componentName?.trim()
  if (component) return component

  const slot = attr(node, 'data-slot')
  if (slot) return slot

  const dataComponent = attr(node, 'data-component') || attr(node, 'data-smylr-component')
  if (dataComponent) return dataComponent

  const label = (node.label || '').trim()
  if (label && !GENERIC_LABELS.has(label.toLowerCase())) return label

  if (node.role && !['none', 'presentation', 'generic'].includes(node.role)) {
    return node.role
  }

  if (label) return label
  return (node.tagName || 'container').toLowerCase()
}

function liveNodeToLayerNode(node: SmylrLiveContainerNode): LayerNode {
  const children = (node.children ?? []).map(liveNodeToLayerNode)
  const tag = node.tagName?.toLowerCase()
  const isText =
    Boolean(node.text?.trim()) &&
    (!node.children || node.children.length === 0) &&
    Boolean(tag && ['em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'p', 'strong'].includes(tag))
  return {
    id: toLiveLayerId(node.id),
    name: isText
      ? (node.attrs?.['data-smylr-label'] ?? node.text?.trim() ?? node.label)
      : displayNameForLiveNode(node),
    type: isText ? 'TEXT' : 'FRAME',
    layoutMode: 'NONE',
    visible: true,
    locked: true,
    virtual: true,
    children: children.length > 0 ? children : undefined
  }
}

/** Version signal for LayerTreeRoot rebuild when live tree changes. */
export const liveLayerTreeVersion = ref(0)

export function bumpLiveLayerTreeVersion() {
  liveLayerTreeVersion.value += 1
}

/**
 * Full live container tree under a live-app scene frame.
 * Shows every node from the inspector document — no filtering.
 */
export function buildLiveLayerChildrenForSceneNode(node: SceneNode): LayerNode[] | undefined {
  if (!isSmylrLiveAppFrameNode(node)) return undefined
  if (node.id !== liveInspectorActiveFrameId.value) return undefined
  const tree = liveInspectorDocument.value?.tree
  if (!tree) return undefined

  // Keep the root container as well as every descendant. Flattening to the
  // root's children made the first real container disappear from Layers.
  return [liveNodeToLayerNode(tree)]
}

export function createSmylrLiveLayerTreeBridge(): LayerTreeHostBridge {
  const store = useEditorStore()

  const virtualSelectedKey = computed(() => {
    const a = liveInspectorSelectedId.value ?? ''
    const b = liveInspectorPendingSelectedId.value ?? ''
    return `${a}\0${b}`
  })
  const virtualSelectedIds = computed(() => {
    const set = new Set<string>()
    const [a, b] = virtualSelectedKey.value.split('\0')
    if (a) set.add(toLiveLayerId(a))
    if (b) set.add(toLiveLayerId(b))
    return set
  })

  const version = computed(() => {
    void liveInspectorActiveFrameId.value
    void liveInspectorStatus.value
    void store.state.currentPageId
    const tree = liveInspectorDocument.value?.tree
    let count = 0
    function walk(n: SmylrLiveContainerNode | undefined) {
      if (!n || count > 5000) return
      count++
      for (const c of n.children ?? []) walk(c)
    }
    walk(tree)
    return count * 1000 + liveLayerTreeVersion.value
  })

  return {
    getVirtualChildren: buildLiveLayerChildrenForSceneNode,
    getSceneChildren: (parent) => getDesignOutlineChildren(store.graph, parent),
    isVirtualId: (id) => isLiveLayerId(id) || isDesignSectionId(id),
    selectVirtual: (layerId: string) => {
      if (isDesignSectionId(layerId)) {
        const anchor = designSectionAnchorId(layerId)
        if (anchor) store.select([anchor])
        return
      }
      const liveId = fromLiveLayerId(layerId)
      if (!liveId) return
      if (liveInspectorInteractionMode.value !== 'select') {
        setLiveInspectorInteractionMode('select')
      }
      selectLiveInspectorNode(liveId)
    },
    virtualSelectedIds,
    version
  }
}
