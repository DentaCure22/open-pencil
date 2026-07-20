<script setup lang="ts">
import { ref } from 'vue'

import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import { createStarterHtmlBoard } from '@/app/html-board/starter'
import { htmlBoardViewportInsets } from '@/app/html-board/workspace'
import { narratedTraceAnnotationTool } from '@/app/narrated-trace'
import {
  createSourceDocument,
  sourceDocumentStarter,
  sourceDocumentViewportInsets,
  type SourceDocumentFormat
} from '@/app/source-document/workspace'

const { pageIsEmpty } = defineProps<{ pageIsEmpty: boolean }>()

const store = useEditorStore()
const { activeTab } = useAIChat()
const choosingSourceFormat = ref(false)

function startLiveBoard() {
  createStarterHtmlBoard(store)
  activeTab.value = 'code'
  requestAnimationFrame(() => store.zoomToSelection(htmlBoardViewportInsets()))
}

async function startThreeExperience() {
  const { createThreeExperience, THREE_EXPERIENCE_FIXTURE_SOURCE } =
    await import('@/app/spatial-media/three-experience')
  createThreeExperience(store, {
    sceneSource: THREE_EXPERIENCE_FIXTURE_SOURCE,
    sourceId: 'starter-torus-knot',
    sourceRevision: 1,
    title: 'Three.js torus knot'
  })
  activeTab.value = 'code'
  requestAnimationFrame(() => store.zoomToSelection(htmlBoardViewportInsets()))
}

function chooseSourceFormat() {
  choosingSourceFormat.value = !choosingSourceFormat.value
}

function startSourceDocument(format: SourceDocumentFormat) {
  createSourceDocument(store, sourceDocumentStarter(format), {
    fileName: `untitled.${format}`,
    format
  })
  activeTab.value = 'code'
  requestAnimationFrame(() => store.zoomToSelection(sourceDocumentViewportInsets()))
}
</script>

<template>
  <div
    v-if="pageIsEmpty && narratedTraceAnnotationTool === 'none'"
    class="pointer-events-none absolute inset-0 z-[6] isolate grid place-items-center px-6"
    data-test-id="html-first-canvas-welcome"
  >
    <div
      class="border-border bg-panel/88 pointer-events-auto relative z-10 w-full max-w-[320px] rounded-[14px] border px-5 py-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl"
    >
      <div
        class="mx-auto grid size-9 place-items-center rounded-[10px] bg-violet-400/12 text-violet-500 [[data-theme=dark]_&]:text-violet-200"
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
        class="text-muted hover:bg-hover hover:text-surface mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] text-[10px] font-medium transition"
        data-test-id="three-experience-start"
        @click="startThreeExperience"
      >
        <icon-lucide-box class="size-3" />
        New Three.js experience
      </button>
      <button
        type="button"
        class="text-muted hover:bg-hover hover:text-surface mt-1.5 h-8 w-full rounded-[8px] text-[10px] font-medium transition"
        data-test-id="source-document-start"
        :aria-expanded="choosingSourceFormat"
        @click="chooseSourceFormat"
      >
        New source document
      </button>
      <div
        v-if="choosingSourceFormat"
        data-test-id="source-document-format-picker"
        class="mt-1 grid grid-cols-3 gap-1"
      >
        <button
          v-for="format in ['html', 'jsx', 'tsx'] as const"
          :key="format"
          type="button"
          :data-test-id="`source-document-new-${format}`"
          class="h-7 rounded-[7px] bg-white/[0.045] text-[9px] font-semibold text-muted uppercase transition hover:bg-white/[0.08] hover:text-surface"
          @click="startSourceDocument(format)"
        >
          {{ format }}
        </button>
      </div>
    </div>
  </div>
</template>
