<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { htmlBoardSrcdoc, isHtmlBoardFrame } from '@/app/html-board/workspace'
import { liveFrameCanvasStyle, liveFrameHeaderStyle } from '@/app/smylr-production/frame-transform'

const store = useEditorStore()
const interactionFrameId = ref<string | null>(null)
const syncTick = ref(0)
let unsubscribe: Array<() => void> = []

const boards = computed(() => {
  void syncTick.value
  void store.state.currentPageId
  void store.state.sceneVersion
  return store.graph.getChildren(store.state.currentPageId).filter(isHtmlBoardFrame)
})

onMounted(() => {
  const sync = () => {
    syncTick.value += 1
  }
  unsubscribe = [
    store.onEditorEvent('graph:replaced', sync),
    store.onEditorEvent('page:changed', sync),
    store.onEditorEvent('node:updated', sync),
    store.onEditorEvent('viewport:changed', sync)
  ]
})

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
})

watch(boards, (nextBoards) => {
  if (
    interactionFrameId.value &&
    !nextBoards.some((candidate) => candidate.id === interactionFrameId.value)
  ) {
    interactionFrameId.value = null
  }
})

function toggleInteraction(frameId: string) {
  interactionFrameId.value = interactionFrameId.value === frameId ? null : frameId
  store.select([frameId])
}

function isInteracting(frameId: string) {
  return interactionFrameId.value === frameId
}
</script>

<template>
  <div
    v-for="board in boards"
    :key="board.id"
    data-test-id="html-board-embed"
    class="pointer-events-none absolute top-0 left-0 z-[5]"
    :style="liveFrameCanvasStyle(store, board)"
  >
    <div
      class="pointer-events-auto absolute left-1/2 z-[7] flex items-center gap-1.5 rounded-full border border-white/10 bg-[#17171a]/95 px-2 py-1 text-[11px] text-white shadow-lg backdrop-blur"
      :style="liveFrameHeaderStyle(store.state.zoom)"
      @pointerdown.stop
    >
      <span class="rounded-full bg-[#3159d9] px-1.5 py-0.5 text-[9px] font-bold tracking-wide">HTML</span>
      <span class="max-w-36 truncate px-1 text-white/70">{{ board.name }}</span>
      <span class="text-[10px] tabular-nums text-white/45">{{ Math.round(board.width) }} × {{ Math.round(board.height) }}</span>
      <button
        type="button"
        class="rounded-full bg-white px-2 py-0.5 font-medium text-black hover:bg-white/90"
        :data-test-id="`html-board-${isInteracting(board.id) ? 'design' : 'interact'}`"
        @click.stop="toggleInteraction(board.id)"
      >
        {{ isInteracting(board.id) ? 'Back to design' : 'Interact' }}
      </button>
    </div>
    <div class="absolute inset-0 overflow-hidden rounded-xl bg-white shadow-lg">
      <iframe
        :class="isInteracting(board.id) ? 'pointer-events-auto' : 'pointer-events-none'"
        :srcdoc="htmlBoardSrcdoc(board)"
        :title="`${board.name} interactive design`"
        class="size-full border-0 bg-white"
        data-test-id="html-board-frame"
        sandbox="allow-forms allow-modals allow-popups allow-scripts"
      />
    </div>
  </div>
</template>
