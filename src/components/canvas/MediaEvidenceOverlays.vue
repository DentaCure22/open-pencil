<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import {
  mediaEvidenceSource,
  type MediaEvidenceKind,
  type MediaEvidenceSource
} from '@/app/media-evidence/source'

type MediaEvidenceItem = {
  node: SceneNode
  source: MediaEvidenceSource
}

type ViewerState = 'error' | 'loading' | 'ready'

const store = useEditorStore()
const assetUrls = shallowRef<Record<string, string>>({})
const viewerStates = shallowRef<Record<string, ViewerState>>({})

function belongsToCurrentPage(node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current.parentId) {
    if (current.parentId === store.state.currentPageId) return true
    current = store.graph.getNode(current.parentId)
    if (!current) return false
  }
  return false
}

const items = computed<MediaEvidenceItem[]>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  const result: MediaEvidenceItem[] = []
  for (const node of store.graph.getAllNodes()) {
    if (!node.visible || !belongsToCurrentPage(node)) continue
    const source = mediaEvidenceSource(node)
    if (!source || !store.graph.images.has(source.assetHash)) continue
    result.push({ node, source })
  }
  return result
})

watch(
  items,
  (nextItems) => {
    const nextHashes = new Set(nextItems.map((item) => item.source.assetHash))
    const nextUrls: Record<string, string> = {}
    for (const hash of nextHashes) {
      const current = assetUrls.value[hash]
      if (current) {
        nextUrls[hash] = current
        continue
      }
      const bytes = store.graph.images.get(hash)
      const item = nextItems.find((candidate) => candidate.source.assetHash === hash)
      if (!bytes || !item) continue
      nextUrls[hash] = URL.createObjectURL(
        new Blob([bytes.slice().buffer], { type: item.source.metadata.mimeType })
      )
    }
    for (const [hash, url] of Object.entries(assetUrls.value)) {
      if (!nextHashes.has(hash)) URL.revokeObjectURL(url)
    }
    assetUrls.value = nextUrls
    viewerStates.value = Object.fromEntries(
      nextItems.map((item) => [item.node.id, viewerStates.value[item.node.id] ?? 'loading'])
    )
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  for (const url of Object.values(assetUrls.value)) URL.revokeObjectURL(url)
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

function sourceUrl(source: MediaEvidenceSource): string {
  return assetUrls.value[source.assetHash] ?? ''
}

function kindLabel(kind: MediaEvidenceKind): string {
  return kind.toUpperCase()
}

function viewerState(nodeId: string): ViewerState {
  return viewerStates.value[nodeId] ?? 'loading'
}

function setViewerState(nodeId: string, state: ViewerState) {
  viewerStates.value = { ...viewerStates.value, [nodeId]: state }
}

function viewerStateMessage(item: MediaEvidenceItem): string {
  const label = kindLabel(item.source.kind)
  return viewerState(item.node.id) === 'error'
    ? `${label} preview could not be loaded`
    : `Loading ${label} preview`
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[4] overflow-hidden" aria-hidden="false">
    <article
      v-for="item in items"
      :key="item.node.id"
      :data-test-id="`media-evidence-${item.source.kind}`"
      :data-media-node-id="item.node.id"
      :style="overlayStyle(item.node)"
      class="pointer-events-none absolute top-0 left-0 overflow-hidden rounded-[12px] bg-[#0e0f12] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]"
      :class="isSelected(item.node.id) ? 'ring-2 ring-accent/85' : ''"
    >
      <header
        class="flex h-8 items-center justify-between gap-3 border-b border-white/10 bg-[#17181d]/95 px-3 text-[11px] text-[#f1f1f3]"
      >
        <span class="min-w-0 truncate font-medium">{{ item.source.fileName }}</span>
        <span class="shrink-0 text-[9px] font-semibold tracking-[0.08em] text-[#aaa0d2]">
          {{ kindLabel(item.source.kind) }} · source
        </span>
      </header>

      <div
        class="relative h-[calc(100%-2rem)] w-full overflow-hidden bg-[#090a0c]"
        :class="isSelected(item.node.id) ? 'pointer-events-auto' : 'pointer-events-none'"
      >
        <div v-if="item.source.kind === 'pdf'" class="relative size-full bg-white">
          <iframe
            :src="`${sourceUrl(item.source)}#view=FitH&toolbar=0`"
            :aria-label="`PDF preview: ${item.source.fileName}`"
            class="size-full border-0 bg-white"
            data-test-id="media-evidence-pdf-viewer"
            @error="setViewerState(item.node.id, 'error')"
            @load="setViewerState(item.node.id, 'ready')"
          />
          <a
            :href="sourceUrl(item.source)"
            :aria-label="`Open source PDF: ${item.source.fileName}`"
            class="absolute right-3 bottom-3 z-20 flex items-center gap-1.5 rounded-md border border-black/10 bg-[#17181d]/90 px-2.5 py-1.5 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm hover:bg-[#23252b]"
            rel="noopener noreferrer"
            target="_blank"
          >
            <icon-lucide-external-link class="size-3" />
            Open PDF
          </a>
        </div>
        <div v-else-if="item.source.kind === 'video'" class="size-full bg-black">
          <video
            :src="sourceUrl(item.source)"
            :aria-label="`Video preview: ${item.source.fileName}`"
            class="size-full object-contain"
            controls
            playsinline
            preload="metadata"
            data-test-id="media-evidence-video-viewer"
            @error="setViewerState(item.node.id, 'error')"
            @loadedmetadata="setViewerState(item.node.id, 'ready')"
          />
        </div>
        <div
          v-else
          class="flex size-full flex-col items-center justify-center gap-4 bg-[radial-gradient(circle_at_50%_20%,rgba(145,122,226,0.18),transparent_55%)] px-8"
          data-test-id="media-evidence-audio-viewer"
        >
          <div class="flex items-center gap-2 text-[12px] text-[#c8c3dc]">
            <icon-lucide-audio-lines class="size-4 text-[#a995f1]" />
            <span>Source audio</span>
          </div>
          <audio
            :src="sourceUrl(item.source)"
            :aria-label="`Audio preview: ${item.source.fileName}`"
            class="w-full max-w-[440px]"
            controls
            preload="metadata"
            @error="setViewerState(item.node.id, 'error')"
            @loadedmetadata="setViewerState(item.node.id, 'ready')"
          />
        </div>

        <div
          v-if="viewerState(item.node.id) !== 'ready'"
          :data-test-id="`media-evidence-${item.source.kind}-status`"
          :role="viewerState(item.node.id) === 'error' ? 'alert' : 'status'"
          aria-live="polite"
          class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#111218]/92 px-6 text-center text-[11px] text-[#d7d4e2]"
        >
          <icon-lucide-circle-alert
            v-if="viewerState(item.node.id) === 'error'"
            class="size-5 text-[#f0a7a7]"
          />
          <icon-lucide-loader-circle v-else class="size-5 animate-spin text-[#a995f1]" />
          <span>{{ viewerStateMessage(item) }}</span>
        </div>
      </div>
    </article>
  </div>
</template>
