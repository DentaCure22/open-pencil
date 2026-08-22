<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import { focusCanvasSurface } from '@/app/editor/canvas/surface/focus'
import { canvasSurfaceCanReceivePointer } from '@/app/editor/canvas/surface/interaction'
import { useSceneNodeOverlayStyle } from '@/app/editor/presentation'
import { spatialMediaSource } from '@/app/spatial-media/source'
import type { SpatialMediaSource } from '@/app/spatial-media/types'

import SpatialMediaViewport from './SpatialMediaViewport.vue'

type SpatialMediaItem = { node: SceneNode; source: SpatialMediaSource }

const store = useEditorStore()
const overlayStyle = useSceneNodeOverlayStyle(store)
const previewUrls = shallowRef<Record<string, string>>({})

const items = computed<SpatialMediaItem[]>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  const result: SpatialMediaItem[] = []
  for (const node of store.graph.getDescendants(store.state.currentPageId)) {
    if (!node.visible) continue
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

function isSelected(nodeId: string): boolean {
  return store.state.selectedIds.has(nodeId)
}

function isInteractive(nodeId: string): boolean {
  return isSelected(nodeId) && canvasSurfaceCanReceivePointer(store.state.activeTool)
}

function previewUrl(source: SpatialMediaSource): string {
  return source.previewHash ? (previewUrls.value[source.previewHash] ?? '') : ''
}

function focusSpatialMedia(nodeId: string) {
  focusCanvasSurface(store, nodeId)
}
</script>

<template>
  <div
    v-for="item in items"
    :key="item.node.id"
    :style="overlayStyle(item.node)"
    :class="
      isInteractive(item.node.id)
        ? 'pointer-events-auto ring-2 ring-[#8b5cf6]'
        : isSelected(item.node.id)
          ? 'pointer-events-none ring-2 ring-[#8b5cf6]'
          : 'pointer-events-none'
    "
    class="absolute top-0 left-0 z-[6] overflow-hidden rounded-[12px] shadow-[0_20px_64px_rgba(0,0,0,0.28)]"
    :data-spatial-node-id="item.node.id"
    @dblclick.stop.prevent="focusSpatialMedia(item.node.id)"
  >
    <SpatialMediaViewport
      :interactive="isSelected(item.node.id)"
      :node="item.node"
      :preview-url="previewUrl(item.source)"
      :source="item.source"
    />
  </div>
</template>
