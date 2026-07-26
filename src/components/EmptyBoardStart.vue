<script setup lang="ts">
import {
  codeObjectViewportInsets,
  createCodeObjectFromPreset,
  type CodeComponentPresetId
} from '@/app/code-object/model'
import { useEditorStore } from '@/app/editor/active-store'
import { narratedTraceAnnotationTool } from '@/app/narrated-trace'

const { pageIsEmpty } = defineProps<{ pageIsEmpty: boolean }>()

const store = useEditorStore()

function startCodeObject(id: CodeComponentPresetId) {
  createCodeObjectFromPreset(store, id)
  requestAnimationFrame(() => store.zoomToSelection(codeObjectViewportInsets()))
}
</script>

<template>
  <div
    v-if="pageIsEmpty && narratedTraceAnnotationTool === 'none'"
    class="pointer-events-none absolute inset-0 z-[6] isolate grid place-items-center px-6"
    data-test-id="empty-board-start"
  >
    <div
      class="border-border bg-panel/88 pointer-events-auto relative z-10 w-full max-w-[320px] rounded-[14px] border px-5 py-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl"
    >
      <div
        class="mx-auto grid size-9 place-items-center rounded-[10px] bg-violet-400/12 text-violet-500 [[data-theme=dark]_&]:text-violet-200"
      >
        <icon-lucide-shapes class="size-4" />
      </div>
      <h1 class="mt-3 text-[14px] font-semibold tracking-[-0.01em] text-surface">Start a board</h1>
      <p class="mx-auto mt-1 max-w-[250px] text-[10px] leading-4 text-muted">
        Add one living Code Object or start drawing with native objects.
      </p>
      <button
        type="button"
        class="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-violet-300 px-3 text-[10px] font-semibold text-[#17171a] transition hover:bg-violet-200"
        data-test-id="code-object-start"
        @click="startCodeObject('user-code')"
      >
        <icon-lucide-code-2 class="size-3" />
        New Code Object
      </button>
      <div class="mt-1.5 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          class="text-muted hover:bg-hover hover:text-surface flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-white/[0.025] text-[9px] font-medium transition"
          data-test-id="code-object-start-document"
          @click="startCodeObject('office-document')"
        >
          <icon-lucide-file-text class="size-3" />
          Document
        </button>
        <button
          type="button"
          class="text-muted hover:bg-hover hover:text-surface flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-white/[0.025] text-[9px] font-medium transition"
          data-test-id="code-object-start-spreadsheet"
          @click="startCodeObject('office-spreadsheet')"
        >
          <icon-lucide-table-2 class="size-3" />
          Spreadsheet
        </button>
      </div>
    </div>
  </div>
</template>
