<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  htmlBoardContent,
  isHtmlBoardFrame,
  updateHtmlBoardFrame
} from '@/app/html-board/workspace'
import AppTextButton from '@/components/ui/AppTextButton.vue'

const store = useEditorStore()
const html = ref('')
const css = ref('')
const savedHtml = ref('')
const savedCss = ref('')

const board = computed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length !== 1) return null
  const node = store.graph.getNode(ids[0])
  return isHtmlBoardFrame(node) ? node : null
})

const signature = computed(() => {
  const node = board.value
  if (!node) return ''
  return `${node.id}:${store.state.sceneVersion}`
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
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-test-id="html-board-code-panel">
    <div class="border-b border-border px-3 py-3">
      <div class="text-xs font-medium text-surface">Interactive HTML board</div>
      <div class="mt-0.5 text-[11px] leading-4 text-muted">
        Browser geometry stays exact. Use the canvas header to switch between design and interaction.
      </div>
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <label class="text-[11px] font-medium text-muted" for="html-board-html">HTML</label>
      <textarea
        id="html-board-html"
        v-model="html"
        class="min-h-44 flex-1 resize-none rounded border border-border bg-panel px-2 py-1.5 font-mono text-xs text-surface outline-none focus:border-accent"
        data-test-id="html-board-html"
        spellcheck="false"
      />
      <label class="text-[11px] font-medium text-muted" for="html-board-css">CSS</label>
      <textarea
        id="html-board-css"
        v-model="css"
        class="min-h-32 flex-1 resize-none rounded border border-border bg-panel px-2 py-1.5 font-mono text-xs text-surface outline-none focus:border-accent"
        data-test-id="html-board-css"
        spellcheck="false"
      />
      <div class="flex items-center justify-between gap-2 pt-1">
        <span class="text-[11px] text-muted">{{ dirty ? 'Unsaved changes' : 'Live board is current' }}</span>
        <AppTextButton
          data-test-id="html-board-update"
          :ui="{
            base: dirty
              ? 'rounded bg-accent px-2 py-1 text-[11px] text-black hover:bg-accent/90'
              : 'cursor-not-allowed rounded px-2 py-1 text-[11px] opacity-50'
          }"
          @click="updateBoard"
        >
          Update board
        </AppTextButton>
      </div>
    </div>
  </div>
</template>
