<script setup lang="ts">
import { computed } from 'vue'

import {
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  formatCanvasZoomPercent,
  steppedCanvasZoom
} from '@/app/editor/canvas/zoom'
import { useEditorStore } from '@/app/editor/active-store'
import Tip from '@/components/ui/Tip.vue'

const store = useEditorStore()
const zoomPercent = computed(() => formatCanvasZoomPercent(store.state.zoom))
const canZoomOut = computed(() => store.state.zoom > CANVAS_ZOOM_MIN + 1e-6)
const canZoomIn = computed(() => store.state.zoom < CANVAS_ZOOM_MAX - 1e-6)

function zoomBy(direction: 1 | -1) {
  store.zoomToLevel(steppedCanvasZoom(store.state.zoom, direction))
}

function resetZoom() {
  store.zoomTo100()
}
</script>

<template>
  <div
    class="pointer-events-auto border-chrome-border bg-chrome-raised/95 text-surface fixed right-3 bottom-3 z-40 flex h-8 items-center gap-0.5 rounded-full border px-1 shadow-chrome-menu backdrop-blur-xl"
    data-test-id="canvas-zoom-controls"
    @pointerdown.stop
    @wheel.stop
  >
    <Tip label="Zoom out" side="top">
      <button
        type="button"
        class="text-muted hover:bg-hover hover:text-surface flex size-6 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
        data-test-id="canvas-zoom-out"
        aria-label="Zoom out"
        :disabled="!canZoomOut"
        @click="zoomBy(-1)"
      >
        <icon-lucide-minus class="size-3.5" />
      </button>
    </Tip>
    <Tip label="Zoom to 100%" side="top">
      <button
        type="button"
        class="hover:bg-hover min-w-11 cursor-pointer rounded-full px-1.5 text-center text-[11px] font-medium tabular-nums"
        data-test-id="canvas-zoom-percent"
        aria-label="Zoom to 100%"
        @click="resetZoom"
      >
        {{ zoomPercent }}
      </button>
    </Tip>
    <Tip label="Zoom in" side="top">
      <button
        type="button"
        class="text-muted hover:bg-hover hover:text-surface flex size-6 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
        data-test-id="canvas-zoom-in"
        aria-label="Zoom in"
        :disabled="!canZoomIn"
        @click="zoomBy(1)"
      >
        <IconlyIcon name="plus" class="size-3.5" />
      </button>
    </Tip>
  </div>
</template>
