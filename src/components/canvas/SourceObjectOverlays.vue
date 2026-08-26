<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import { canvasSurfaceCanReceivePointer } from '@/app/editor/canvas/surface/interaction'
import { useSceneNodeOverlayStyle } from '@/app/editor/presentation'
import { sourceObjectSource, type SourceObjectSource } from '@/app/source-object/source'

type SourceObjectItem = {
  node: SceneNode
  source: SourceObjectSource
}

const store = useEditorStore()
const overlayStyle = useSceneNodeOverlayStyle(store)
const assetUrls = shallowRef<Record<string, string>>({})

const items = computed<SourceObjectItem[]>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  const result: SourceObjectItem[] = []
  for (const node of store.graph.getDescendants(store.state.currentPageId)) {
    if (!node.visible) continue
    const source = sourceObjectSource(node)
    if (source) result.push({ node, source })
  }
  return result
})

watch(
  items,
  (nextItems) => {
    const activeHashes = new Set(nextItems.map((item) => item.source.assetHash))
    const nextUrls: Record<string, string> = {}
    for (const item of nextItems) {
      const currentUrl = assetUrls.value[item.source.assetHash]
      if (currentUrl) {
        nextUrls[item.source.assetHash] = currentUrl
        continue
      }
      const bytes = store.graph.images.get(item.source.assetHash)
      if (!bytes) continue
      nextUrls[item.source.assetHash] = URL.createObjectURL(
        new Blob([bytes.slice().buffer], { type: item.source.metadata.mimeType })
      )
    }
    for (const [hash, url] of Object.entries(assetUrls.value)) {
      if (!activeHashes.has(hash)) URL.revokeObjectURL(url)
    }
    assetUrls.value = nextUrls
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  for (const url of Object.values(assetUrls.value)) URL.revokeObjectURL(url)
})

function isSelected(nodeId: string): boolean {
  return store.state.selectedIds.has(nodeId)
}

function surfaceAcceptsPointer(nodeId: string): boolean {
  return isSelected(nodeId) && canvasSurfaceCanReceivePointer(store.state.activeTool)
}

function assetUrl(source: SourceObjectSource): string {
  return assetUrls.value[source.assetHash] ?? ''
}

function byteSize(source: SourceObjectSource): string {
  const bytes = store.graph.images.get(source.assetHash)?.byteLength ?? source.byteLength
  if (bytes === null || bytes === undefined) return 'Bytes unavailable'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[4] overflow-hidden" aria-hidden="false">
    <article
      v-for="item in items"
      :key="item.node.id"
      :data-source-object-node-id="item.node.id"
      :style="overlayStyle(item.node)"
      class="pointer-events-none absolute top-0 left-0 flex flex-col overflow-hidden rounded-[12px] bg-[#101113] shadow-[inset_0_0_0_1px_rgba(173,153,235,0.22),0_12px_32px_rgba(0,0,0,0.22)]"
      :class="isSelected(item.node.id) ? 'ring-2 ring-accent/85' : ''"
      data-test-id="source-object"
    >
      <header class="flex h-10 items-center justify-between gap-3 border-b border-white/8 px-4">
        <span class="min-w-0 truncate text-[12px] font-semibold text-[#f1f1f3]">
          {{ item.source.fileName }}
        </span>
        <span class="shrink-0 text-[9px] font-semibold tracking-[0.08em] text-[#b3a4df]">
          {{ item.source.metadata.format.toUpperCase() }} · ATTACHED FILE
        </span>
      </header>

      <div class="flex min-h-0 flex-1 items-center gap-4 px-4 py-3">
        <div
          class="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#292535] text-[#b9a7ef]"
        >
          <icon-lucide-file-archive class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[12px] font-medium text-[#e5e3e9]">Preview unavailable</p>
          <p class="mt-1 text-[10px] leading-4 text-[#aaa7b1]">
            Original file preserved. Open or download it without losing filename, MIME type, or
            bytes.
          </p>
          <p class="mt-2 truncate text-[9px] text-[#7f7b88]">
            {{ item.source.metadata.mimeType }} · {{ byteSize(item.source) }}
          </p>
        </div>
      </div>

      <footer class="flex h-11 items-center justify-between border-t border-white/8 px-4">
        <span class="text-[9px] font-medium text-[#8f8a99]">Unsupported board preview</span>
        <div
          v-if="isSelected(item.node.id) && assetUrl(item.source)"
          class="flex gap-2"
          :class="
            surfaceAcceptsPointer(item.node.id) ? 'pointer-events-auto' : 'pointer-events-none'
          "
        >
          <a
            :aria-label="`Open attached file: ${item.source.fileName}`"
            :href="assetUrl(item.source)"
            class="flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1.5 text-[10px] font-medium text-[#dedbe5] hover:bg-white/6"
            rel="noopener noreferrer"
            target="_blank"
          >
            <icon-lucide-external-link class="size-3" />
            Open
          </a>
          <a
            :aria-label="`Download attached file: ${item.source.fileName}`"
            :download="item.source.fileName"
            :href="assetUrl(item.source)"
            class="flex items-center gap-1.5 rounded-md bg-[#7662b9] px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-[#856fd0]"
          >
            <IconlyIcon name="download" class="size-3" />
            Download
          </a>
        </div>
        <span v-else-if="!assetUrl(item.source)" class="text-[9px] font-medium text-[#d58f8f]">
          Attached bytes unavailable
        </span>
      </footer>
    </article>
  </div>
</template>
