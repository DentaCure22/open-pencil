<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  HTML_BOARD_SCHEMA_VERSION,
  htmlBoardContent,
  htmlBoardElementSelection,
  htmlBoardViewportStyleScope,
  isHtmlBoardFrame,
  updateHtmlBoardFrame,
  updateHtmlBoardStyleOverride,
  updateHtmlBoardViewport
} from '@/app/html-board/workspace'
import AppTextButton from '@/components/ui/AppTextButton.vue'

const store = useEditorStore()
const sourceTab = ref<'css' | 'html'>('html')
const html = ref('')
const css = ref('')
const savedHtml = ref('')
const savedCss = ref('')
const displayValue = ref('block')
const gapValue = ref('normal')
const paddingValue = ref('0px')
const fontSizeValue = ref('16px')
const styleBaseline = ref('')

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

const elementSelection = computed(() => {
  if (!board.value || htmlBoardElementSelection.value?.boardId !== board.value.id) return null
  return htmlBoardElementSelection.value
})

const selectedStyleRows = computed(() => {
  const selection = elementSelection.value
  if (!selection) return []
  const styles = selection.styles
  return [
    {
      label: 'Layout',
      value: [styles.display, styles.position].filter(Boolean).join(' · ')
    },
    {
      label: 'Size',
      value: `${Math.round(selection.rect.width)} × ${Math.round(selection.rect.height)}`
    },
    {
      label: 'Spacing',
      value: [styles.gap && `gap ${styles.gap}`, styles.padding && `pad ${styles.padding}`]
        .filter(Boolean)
        .join(' · ')
    },
    {
      label: 'Type',
      value: [styles['font-size'], styles['font-weight'], styles['line-height']]
        .filter(Boolean)
        .join(' / ')
    }
  ].filter((row) => row.value)
})

const styleScope = computed(() => {
  void store.state.sceneVersion
  return board.value ? htmlBoardViewportStyleScope(board.value) : 'base'
})

const styleScopeName = computed(() => {
  if (styleScope.value === 'phone') return 'Phone only'
  if (styleScope.value === 'tablet') return 'Tablet only'
  return 'Desktop base'
})

const styleDraftSignature = computed(() => {
  return [displayValue.value, gapValue.value, paddingValue.value, fontSizeValue.value].join('|')
})

const styleDirty = computed(() => {
  return Boolean(elementSelection.value && styleDraftSignature.value !== styleBaseline.value)
})

watch(
  () => {
    const selection = elementSelection.value
    if (!selection) return ''
    return [
      selection.boardId,
      selection.selector,
      selection.styles.display,
      selection.styles.gap,
      selection.styles.padding,
      selection.styles['font-size']
    ].join('|')
  },
  () => {
    const selection = elementSelection.value
    if (!selection) return
    displayValue.value = selection.styles.display || 'block'
    gapValue.value = selection.styles.gap || 'normal'
    paddingValue.value = selection.styles.padding || '0px'
    fontSizeValue.value = selection.styles['font-size'] || '16px'
    styleBaseline.value = styleDraftSignature.value
  },
  { immediate: true }
)

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

function applyElementStyle() {
  const selection = elementSelection.value
  if (!board.value || !selection || !styleDirty.value) return
  const declarations = {
    display: displayValue.value,
    'font-size': fontSizeValue.value,
    gap: gapValue.value,
    padding: paddingValue.value
  }
  if (
    !updateHtmlBoardStyleOverride(
      store,
      board.value.id,
      selection.selector,
      declarations,
      styleScope.value
    )
  ) {
    return
  }
  htmlBoardElementSelection.value = {
    ...selection,
    styles: { ...selection.styles, ...declarations }
  }
  styleBaseline.value = styleDraftSignature.value
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
            Browser runtime · responsive · schema v{{ HTML_BOARD_SCHEMA_VERSION }}
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

    <div
      v-if="elementSelection"
      class="border-b border-border px-3 py-2.5"
      data-test-id="html-board-element-selection"
    >
      <div class="flex items-baseline justify-between gap-2">
        <div class="min-w-0 truncate font-mono text-[11px] font-semibold text-accent">
          &lt;{{ elementSelection.tagName }}&gt;
          <span v-if="elementSelection.id" class="font-normal text-muted">#{{ elementSelection.id }}</span>
        </div>
        <span class="shrink-0 text-[10px] text-muted">Selected element</span>
      </div>
      <div class="mt-1 truncate font-mono text-[10px] text-muted" :title="elementSelection.selector">
        {{ elementSelection.selector }}
      </div>
      <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div v-for="row in selectedStyleRows" :key="row.label" class="min-w-0">
          <dt class="text-[9px] uppercase tracking-wide text-muted/70">{{ row.label }}</dt>
          <dd class="truncate text-[10px] text-surface" :title="row.value">{{ row.value }}</dd>
        </div>
      </dl>
      <div class="mt-3 border-t border-border pt-2.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-medium text-surface">Visual styles</span>
          <span class="text-[9px] text-muted">{{ styleScopeName }}</span>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-x-2 gap-y-2">
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Layout
            <select
              v-model="displayValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-display"
            >
              <option value="block">Block</option>
              <option value="flex">Flex</option>
              <option value="grid">Grid</option>
              <option value="inline-flex">Inline flex</option>
            </select>
          </label>
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Gap
            <input
              v-model="gapValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-gap"
              spellcheck="false"
            />
          </label>
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Padding
            <input
              v-model="paddingValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-padding"
              spellcheck="false"
            />
          </label>
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Type size
            <input
              v-model="fontSizeValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-font-size"
              spellcheck="false"
            />
          </label>
        </div>
        <div class="mt-2.5 flex justify-end">
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-[10px] font-medium transition"
            :class="
              styleDirty
                ? 'bg-accent text-black hover:bg-accent/90'
                : 'cursor-not-allowed bg-white/5 text-muted/50'
            "
            data-test-id="html-board-apply-style"
            :disabled="!styleDirty"
            @click="applyElementStyle"
          >
            Apply visual style
          </button>
        </div>
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
