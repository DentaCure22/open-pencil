<script setup lang="ts">
import { useSceneComputed } from '@open-pencil/vue'

import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import {
  createStarterHtmlBoard,
  requestHtmlBoardComposer
} from '@/app/html-board/starter'
import { htmlBoardViewportInsets } from '@/app/html-board/workspace'

const store = useEditorStore()
const { activeTab } = useAIChat()

const pageIsEmpty = useSceneComputed(() => {
  void store.state.sceneVersion
  return store.graph.getChildren(store.state.currentPageId).length === 0
})

function startLiveBoard() {
  createStarterHtmlBoard(store)
  activeTab.value = 'code'
  requestAnimationFrame(() => store.zoomToSelection(htmlBoardViewportInsets()))
}

function openComposer() {
  activeTab.value = 'code'
  requestHtmlBoardComposer()
}
</script>

<template>
  <div
    v-if="pageIsEmpty"
    class="pointer-events-none absolute inset-0 z-[6] grid place-items-center px-6 pb-20"
    data-test-id="html-first-canvas-welcome"
  >
    <div
      class="pointer-events-auto w-full max-w-[320px] rounded-[14px] border border-white/[0.085] bg-[#17181d]/92 px-5 py-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-xl"
    >
      <div
        class="mx-auto grid size-9 place-items-center rounded-[10px] bg-violet-400/12 text-violet-200"
      >
        <icon-lucide-code-xml class="size-4" />
      </div>
      <h1 class="mt-3 text-[14px] font-semibold tracking-[-0.01em] text-surface">
        Start with live HTML
      </h1>
      <p class="mx-auto mt-1 max-w-[250px] text-[10px] leading-4 text-muted">
        HTML, CSS, and JavaScript render as the design.
      </p>
      <button
        type="button"
        class="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-violet-300 px-3 text-[10px] font-semibold text-[#17171a] transition hover:bg-violet-200"
        data-test-id="html-first-canvas-start"
        @click="startLiveBoard"
      >
        <icon-lucide-plus class="size-3" />
        New live board
      </button>
      <button
        type="button"
        class="mt-1.5 h-8 w-full rounded-[8px] text-[10px] font-medium text-muted transition hover:bg-white/[0.055] hover:text-surface"
        data-test-id="html-first-canvas-custom"
        @click="openComposer"
      >
        Paste or write code
      </button>
    </div>
  </div>
</template>
