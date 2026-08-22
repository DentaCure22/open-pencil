<script setup lang="ts">
import { refAutoReset } from '@vueuse/core'
import { ref, useTemplateRef, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import { placeExtractedVideoFrame } from '@/app/media-evidence/extraction'
import type { MediaEvidenceSource } from '@/app/media-evidence/source'
import { captureVideoFrame } from '@/app/media-evidence/video'
import VideoPlayer from '@/components/ui/VideoPlayer.vue'

const { node, selected, source, sourceUrl } = defineProps<{
  node: SceneNode
  selected: boolean
  source: MediaEvidenceSource
  sourceUrl: string
}>()

const emit = defineEmits<{
  error: []
  focusSurface: []
  ready: []
}>()

const store = useEditorStore()
const player = useTemplateRef<{ mediaElement: () => HTMLVideoElement | null }>('player')
const isReady = ref(false)
const isCapturing = ref(false)
const captureError = refAutoReset(false, 2400)

watch(
  () => selected,
  (interactive) => {
    if (!interactive) player.value?.mediaElement()?.pause()
  }
)

function handleReady() {
  isReady.value = true
  emit('ready')
}

function handleError() {
  isReady.value = false
  emit('error')
}

async function captureFrame() {
  const media = player.value?.mediaElement()
  if (!media || !isReady.value || isCapturing.value) return
  isCapturing.value = true
  captureError.value = false
  try {
    const captured = await captureVideoFrame(media, source.fileName)
    const sourceNode = store.graph.getNode(node.id)
    if (!sourceNode) return
    placeExtractedVideoFrame(store, sourceNode, source, captured.timeMs, captured.image)
  } catch {
    captureError.value = true
  } finally {
    isCapturing.value = false
  }
}
</script>

<template>
  <div class="relative size-full bg-black" @dblclick.stop.prevent="emit('focusSurface')">
    <VideoPlayer
      ref="player"
      :controls="selected"
      data-test-id="media-evidence-video-viewer"
      :label="`Video preview: ${source.fileName}`"
      :src="sourceUrl"
      @error="handleError"
      @loaded="handleReady"
    />
    <button
      v-if="selected"
      :disabled="!isReady || isCapturing"
      class="absolute top-3 right-3 z-10 flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-[#17181d]/90 px-2.5 text-[10px] font-medium text-white shadow-sm backdrop-blur-sm hover:bg-[#23252b] disabled:cursor-not-allowed disabled:opacity-45"
      type="button"
      @click="captureFrame"
    >
      <icon-lucide-image-down class="size-3" />
      {{ isCapturing ? 'Capturing…' : 'Capture frame' }}
    </button>
    <span
      v-if="captureError"
      class="absolute top-3 left-3 rounded bg-[#2d1719]/92 px-2 py-1 text-[10px] text-[#f0a7a7]"
      role="alert"
    >
      Frame capture failed
    </span>
  </div>
</template>
