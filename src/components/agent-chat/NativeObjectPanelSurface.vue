<script setup lang="ts">
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

import { renderNodesToSVG } from '@open-pencil/core/io'
import { renderNodesToImage } from '@open-pencil/core/io/formats/raster'
import type { Fill, SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import { openAgentRightPanel } from '@/app/agent-chat/right-panel'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import Tip from '@/components/ui/Tip.vue'

const { objectId } = defineProps<{ objectId: string }>()

const store = useEditorStore()
const node = shallowRef<SceneNode | null>(null)
const previewUrl = ref('')
const previewError = ref('')
let objectPreviewUrl = ''
let unsubscribe: Array<() => void> = []

function visibleImageFill(current: SceneNode): Fill | undefined {
  return current.fills.find((fill) => fill.visible && fill.type === 'IMAGE')
}

function imageMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  return 'image/png'
}

function revokeObjectPreview() {
  if (objectPreviewUrl) URL.revokeObjectURL(objectPreviewUrl)
  objectPreviewUrl = ''
}

function objectPageId(current: SceneNode): string {
  let ancestor = current
  while (ancestor.parentId) {
    const parent = store.graph.getNode(ancestor.parentId)
    if (!parent) break
    if (parent.type === 'CANVAS') return parent.id
    ancestor = parent
  }
  return store.state.currentPageId
}

function previewScale(current: SceneNode): number {
  const longestSide = Math.max(current.width, current.height, 1)
  return Math.min(1, 1200 / longestSide)
}

function setBlobPreview(bytes: Uint8Array, mime: string) {
  objectPreviewUrl = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }))
  previewUrl.value = objectPreviewUrl
}

function updatePreview(current: SceneNode) {
  revokeObjectPreview()
  previewError.value = ''
  if (!current.visible) {
    previewUrl.value = ''
    return
  }

  const imageFill = visibleImageFill(current)
  if (imageFill?.type === 'IMAGE' && imageFill.imageHash) {
    const bytes = store.graph.images.get(imageFill.imageHash)
    if (bytes) {
      setBlobPreview(bytes, imageMime(bytes))
      return
    }
  }

  try {
    const renderer = store.renderer
    if (renderer) {
      const bytes = renderNodesToImage(
        renderer.ck,
        renderer,
        store.graph,
        objectPageId(current),
        [objectId],
        { format: 'PNG', scale: previewScale(current) }
      )
      if (bytes) {
        setBlobPreview(bytes, 'image/png')
        return
      }
    }

    const svg = renderNodesToSVG(store.graph, store.state.currentPageId, [objectId], {
      xmlDeclaration: false
    })
    previewUrl.value = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ''
    if (!svg) previewError.value = 'This object has no visible preview.'
  } catch {
    previewUrl.value = ''
    previewError.value = 'Preview unavailable for this object.'
  }
}

function refreshObject() {
  const current = store.graph.getNode(objectId)
  node.value = current ? { ...current } : null
  if (!current) {
    previewUrl.value = ''
    previewError.value = 'This object is no longer available.'
    return
  }
  updatePreview(current)
}

function showOnBoard() {
  store.zoomToNode(objectId, editorViewportInsets())
}

function objectChanged(id: string) {
  if (id === objectId || store.graph.isDescendant(id, objectId)) refreshObject()
}

watch(() => objectId, refreshObject)

onMounted(() => {
  unsubscribe = [
    store.onEditorEvent('graph:replaced', refreshObject),
    store.onEditorEvent('node:created', (created) => objectChanged(created.id)),
    store.onEditorEvent('node:deleted', objectChanged),
    store.onEditorEvent('node:reordered', objectChanged),
    store.onEditorEvent('node:updated', objectChanged)
  ]
  refreshObject()
})

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  revokeObjectPreview()
})
</script>

<template>
  <section
    v-if="node"
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-surface"
    data-test-id="native-object-panel-surface"
  >
    <header class="flex h-11 shrink-0 items-center gap-2 px-3">
      <Tip label="Back to Layers">
        <button
          type="button"
          data-test-id="native-object-back-to-layers"
          aria-label="Back to Layers"
          class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface"
          @click="openAgentRightPanel('layers')"
        >
          <icon-lucide-arrow-left class="size-3.5 stroke-[1.6]" />
        </button>
      </Tip>
      <div
        class="min-w-0 flex-1 truncate text-[12px] font-medium text-surface"
        data-test-id="native-object-name"
      >
        {{ node.name }}
      </div>
      <Tip label="Show on Board">
        <button
          type="button"
          data-test-id="native-object-show-on-board"
          aria-label="Show object on Board"
          class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface"
          @click="showOnBoard"
        >
          <icon-lucide-scan-search class="size-3.5 stroke-[1.6]" />
        </button>
      </Tip>
    </header>

    <div class="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 pb-3">
      <div
        class="flex size-full items-center justify-center overflow-hidden"
        data-test-id="native-object-preview"
      >
        <img
          v-if="previewUrl"
          :src="previewUrl"
          :alt="`${node.name} preview`"
          class="max-h-full max-w-full object-contain"
        />
        <div v-else class="max-w-48 text-center text-[11px] leading-4 text-muted">
          {{ node.visible ? previewError : 'This object is hidden on the Board.' }}
        </div>
      </div>
    </div>
  </section>
</template>
