<script setup lang="ts">
import { computed } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { cadDrawingSource } from '@/app/cad/source'
import type { CadDrawingSource } from '@/app/cad/types'
import { useEditorStore } from '@/app/editor/active-store'

import CadDrawingViewport from './CadDrawingViewport.vue'

type CadDrawingItem = {
  node: SceneNode
  source: CadDrawingSource
}

const store = useEditorStore()

function belongsToCurrentPage(node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current.parentId) {
    if (current.parentId === store.state.currentPageId) return true
    current = store.graph.getNode(current.parentId)
    if (!current) return false
  }
  return false
}

const items = computed<CadDrawingItem[]>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  const result: CadDrawingItem[] = []
  for (const node of store.graph.getAllNodes()) {
    if (!node.visible || !belongsToCurrentPage(node)) continue
    const source = cadDrawingSource(node)
    if (!source || !store.graph.images.has(source.assetHash)) continue
    result.push({ node, source })
  }
  return result
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
</script>

<template>
  <div
    v-for="item in items"
    :key="item.node.id"
    :style="overlayStyle(item.node)"
    :class="
      isSelected(item.node.id) ? 'pointer-events-auto ring-2 ring-[#57a58a]' : 'pointer-events-none'
    "
    class="absolute top-0 left-0 z-[6] overflow-hidden rounded-[12px] shadow-[0_20px_64px_rgba(0,0,0,0.28)]"
    :data-cad-node-id="item.node.id"
  >
    <CadDrawingViewport :interactive="isSelected(item.node.id)" :source="item.source" />
  </div>
</template>
