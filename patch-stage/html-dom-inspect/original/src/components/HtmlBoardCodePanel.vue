<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  HTML_BOARD_SCHEMA_VERSION,
  htmlBoardContent,
  isHtmlBoardFrame,
  updateHtmlBoardFrame,
  updateHtmlBoardViewport
} from '@/app/html-board/workspace'
import AppTextButton from '@/components/ui/AppTextButton.vue'

const store = useEditorStore()
const sourceTab = ref<'css' | 'html'>('html')
const html = ref('')
const css = ref('')
const savedHtml = ref('')
const savedCss = ref('')

const viewportPresets = [
  { height: 900, label: 'Desktop', width: 1440 },
  { height: 1024, label: 'Tablet', width: 768 },
  { height: 844, label: 'Phone', width: 390 }
] as const

const board = computed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length !== 1) return null
  const node = store.graph.getNode(ids[0])
  return isHtmlBoardFrame(node) ? node : null
})

const signature = computed(() => {
  const node = board.value
  return node ? `${node.id}:${store.state.sceneVersion}` : ''
})

const dirty = computed(() => html.value !== savedHtml.value || css.value !== savedCss.value)

watch(
  signature,
  () => {
    if (!board.value) return
    const content = htmlBoardContent(board.value)
    html.value = content.html
    css.value = content.css
    savedHtml.value = content.html
    savedCss.value = content.css
  },
  { immediate: true }
)

function updateBoard() {
  if (!board.value || !dirty.value) return
  if (!updateHtmlBoardFrame(store, board.value.id, html.value, css.value)) return
  savedHtml.value = html.value
  savedCss.value = css.value
}

function setViewport(preset: (typeof viewportPresets)[number]) {
  if (!board.value) return
  if (
    !updateHtmlBoardViewport(
      store,
      board.value.id,
      { height: preset.height, width: preset.width },
      `Set HTML board to ${preset.label}`
    )
  ) {
    return
  }
  requestAnimationFrame(() => store.zoomToSelection())
}

function isActiveViewport(preset: (typeof viewportPresets)[number]) {
  return board.value?.width === preset.width && board.value?.height === preset.height
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-test-id="html-board-code-panel">
    <div class="border-b border-border px-3 py-3">
      <div class="flex items-center justify-between gap-2">
        <div>
          <div class="text-xs font-medium text-surface">HTML design source</div>
          <div class="mt-0.5 text-[11px] leading-4 text-muted">
            Sandboxed browser runtime · schema v{{ HTML_BOARD_SCHEMA_VERSION }}
          </div>
        </div>
        <span class="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-300">
          Live
        </span>
      </div>
      <div class="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-black/20 p-1">
        <button
          v-for="preset in viewportPresets"
          :key="preset.label"
          type="button"
          class="rounded-md px-1.5 py-1 text-[10px] transition"
          :class="
            isActiveViewport(preset)
              ? 'bg-white/10 text-surface shadow-sm'
              : 'text-muted hover:bg-white/5 hover:text-surface'
          "
          :data-test-id="`html-board-viewport-${preset.label.toLowerCase()}`"
          @click="setViewport(preset)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col p-3">
      <div class="mb-2 flex items-center gap-1 border-b border-border">
        <button
          v-for="tabName in ['html', 'css'] as const"
          :key="tabName"
          type="button"
          class="border-b-2 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide"
          :class="
            sourceTab === tabName
              ? 'border-accent text-surface'
              : 'border-transparent text-muted hover:text-surface'
          "
          @click="sourceTab = tabName"
        >
          {{ tabName }}
        </button>
      </div>

      <textarea
        v-if="sourceTab === 'html'"
        id="html-board-html"
        v-model="html"
        class="min-h-0 flex-1 resize-none rounded-lg border border-border bg-black/15 px-2.5 py-2 font-mono text-xs leading-5 text-surface outline-none focus:border-accent"
        data-test-id="html-board-html"
        spellcheck="false"
      />
      <textarea
        v-else
        id="html-board-css"
        v-model="css"
        class="min-h-0 flex-1 resize-none rounded-lg border border-border bg-black/15 px-2.5 py-2 font-mono text-xs leading-5 text-surface outline-none focus:border-accent"
        data-test-id="html-board-css"
        spellcheck="false"
      />

      <div class="mt-3 flex items-center justify-between gap-2">
        <span class="text-[11px] text-muted">{{ dirty ? 'Unsaved source changes' : 'Preview is current' }}</span>
        <AppTextButton
          data-test-id="html-board-update"
          :ui="{
            base: dirty
              ? 'rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-black hover:bg-accent/90'
              : 'cursor-not-allowed rounded-md px-2.5 py-1.5 text-[11px] opacity-40'
          }"
          @click="updateBoard"
        >
          Update live preview
        </AppTextButton>
      </div>
    </div>
  </div>
</template>
