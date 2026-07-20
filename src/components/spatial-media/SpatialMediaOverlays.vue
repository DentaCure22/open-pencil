<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import { spatialMediaSource } from '@/app/spatial-media/source'
import type { SpatialMediaSource } from '@/app/spatial-media/types'

import SpatialMediaViewport from './SpatialMediaViewport.vue'

type SpatialMediaItem = { node: SceneNode; source: SpatialMediaSource }

const store = useEditorStore()
const previewUrls = shallowRef<Record<string, string>>({})

function belongsToCurrentPage(node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current.parentId) {
    if (current.parentId === store.state.currentPageId) return true
    current = store.graph.getNode(current.parentId)
    if (!current) return false
  }
  return false
}

const items = computed<SpatialMediaItem[]>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  const result: SpatialMediaItem[] = []
  for (const node of store.graph.getAllNodes()) {
    if (!node.visible || !belongsToCurrentPage(node)) continue
    const source = spatialMediaSource(node)
    if (!source || !store.graph.images.has(source.assetHash)) continue
    result.push({ node, source })
  }
  return result
})

watch(
  items,
  (nextItems) => {
    const nextHashes = new Set(
      nextItems.flatMap((item) => (item.source.previewHash ? [item.source.previewHash] : []))
    )
    const nextUrls: Record<string, string> = {}
    for (const hash of nextHashes) {
      const current = previewUrls.value[hash]
      if (current) {
        nextUrls[hash] = current
        continue
      }
      const bytes = store.graph.images.get(hash)
      if (!bytes) continue
      nextUrls[hash] = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'image/webp' }))
    }
    for (const [hash, url] of Object.entries(previewUrls.value)) {
      if (!nextHashes.has(hash)) URL.revokeObjectURL(url)
    }
    previewUrls.value = nextUrls
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
})

function overlayStyle(node: SceneNode) {
  void store.state.renderVersion
  const absolute = store.graph.getAbsolutePosition(node.id)
  const zoom = store.state.zoom
  return {
    height: `${Math.max(1, node.height * zoom)}px`,
    opacity: node.opacity,
    transform: `translate3d(${absolute.x * zoom + store.state.panX}px, ${
      absolute.y * zoom + store.state.panY
    }px, 0) rotate(${node.rotation}deg)`,
    transformOrigin: 'center center',
    width: `${Math.max(1, node.width * zoom)}px`
  }
}

function isSelected(nodeId: string): boolean {
  return store.state.selectedIds.has(nodeId)
}

function previewUrl(source: SpatialMediaSource): string {
  return source.previewHash ? (previewUrls.value[source.previewHash] ?? '') : ''
}
</script>

<template>
  <div
    v-for="item in items"
    :key="item.node.id"
    :style="overlayStyle(item.node)"
    :class="
      isSelected(item.node.id) ? 'pointer-events-auto ring-2 ring-[#8b5cf6]' : 'pointer-events-none'
    "
    class="absolute top-0 left-0 z-[6] overflow-hidden rounded-[12px] shadow-[0_20px_64px_rgba(0,0,0,0.28)]"
    :data-spatial-node-id="item.node.id"
  >
    <SpatialMediaViewport
      :interactive="isSelected(item.node.id)"
      :node="item.node"
      :preview-url="previewUrl(item.source)"
      :source="item.source"
    />
  </div>
</template>
