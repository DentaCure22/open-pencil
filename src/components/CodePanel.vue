<script setup lang="ts">
import Prism from 'prismjs'
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { useClipboard } from '@vueuse/core'
import { computed, ref } from 'vue'

import { selectionToJSX } from '@open-pencil/core/design-jsx'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import {
  codeObjectViewportInsets,
  createCodeObjectFromPreset,
  isCodeObjectFrame
} from '@/app/code-object/model'
import { useEditorStore } from '@/app/editor/active-store'
import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'
import { selectedSourceDocument } from '@/app/source-document/workspace'
import CodeObjectCodePanel from '@/components/CodeObjectCodePanel.vue'
import SourceDocumentCodePanel from '@/components/SourceDocumentCodePanel.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import SmylrLiveCodePanel from '@/components/SmylrLiveCodePanel.vue'

import type { JSXFormat } from '@open-pencil/core/design-jsx'

const store = useEditorStore()
const { copy, copied } = useClipboard({ copiedDuring: 2000 })
const { dialogs } = useI18n()
const jsxFormat = ref<JSXFormat>('openpencil')
const prismJsxLoaded = ref(false)

;(globalThis as typeof globalThis & { Prism?: typeof Prism }).Prism = Prism
void import('prismjs/components/prism-jsx').then((): void => {
  prismJsxLoaded.value = true
  return undefined
})

function toggleFormat() {
  jsxFormat.value = jsxFormat.value === 'openpencil' ? 'tailwind' : 'openpencil'
}

const jsxCode = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length === 0) return ''
  return selectionToJSX(ids, store.graph, jsxFormat.value)
})

const highlightedLines = computed(() => {
  if (!jsxCode.value) return []
  void prismJsxLoaded.value
  const grammar = Prism.languages.jsx ?? Prism.languages.javascript
  return jsxCode.value.split('\n').map((line) => Prism.highlight(line, grammar, 'jsx'))
})
const codeLineCount = computed(() => highlightedLines.value.length)
const selectionLabel = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length === 0) return 'No selection'
  if (ids.length > 1) return `${ids.length} layers`
  const node = store.graph.getNode(ids[0])
  return node?.name || node?.type || 'Selection'
})

const isSmylrLiveFrameSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length !== 1) return false
  const node = store.graph.getNode(ids[0])
  return isSmylrLiveAppFrameNode(node)
})

const isSourceDocumentSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  return Boolean(selectedSourceDocument(store))
})

const isCodeObjectSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length !== 1) return false
  const node = store.graph.getNode(ids[0])
  return isCodeObjectFrame(node)
})

function addCodeObject() {
  const frame = createCodeObjectFromPreset(store, 'user-code')
  if (!frame) return
  requestAnimationFrame(() => store.zoomToSelection(codeObjectViewportInsets()))
}

function copyCode() {
  copy(jsxCode.value)
}
</script>

<template>
  <CodeObjectCodePanel v-if="isCodeObjectSelected" />

  <SourceDocumentCodePanel v-else-if="isSourceDocumentSelected" />

  <SmylrLiveCodePanel v-else-if="isSmylrLiveFrameSelected" />

  <div v-else data-test-id="code-panel-root" class="flex min-h-0 flex-1 flex-col">
    <div
      v-if="jsxCode"
      data-test-id="code-panel-header"
      class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.055] px-3 py-2.5"
    >
      <div class="min-w-0">
        <div class="text-[12px] leading-4 font-semibold text-surface">Selection code</div>
        <div class="truncate text-[9.5px] leading-3.5 text-muted/70">{{ selectionLabel }}</div>
      </div>
      <AppTextButton
        data-test-id="code-panel-copy"
        :ui="{
          base: 'flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] bg-white/[0.055] px-2 text-[10px] font-medium text-muted hover:bg-white/[0.085] hover:text-surface'
        }"
        @click="copyCode"
      >
        <icon-lucide-check v-if="copied" class="size-3 text-[var(--color-success)]" />
        <icon-lucide-copy v-else class="size-3" />
        {{ copied ? dialogs.copied : dialogs.copy }}
      </AppTextButton>
    </div>

    <div
      v-if="jsxCode"
      class="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.045] px-3"
    >
      <div class="flex items-center gap-1.5">
        <span class="border-b-2 border-accent px-1 py-2 text-[10px] font-medium text-surface"
          >JSX</span
        >
        <AppTextButton
          data-test-id="code-panel-format-toggle"
          :ui="{
            base: 'rounded px-1.5 py-1 text-[9.5px] text-muted hover:bg-hover hover:text-surface'
          }"
          @click="toggleFormat"
        >
          {{ jsxFormat === 'openpencil' ? 'OpenPencil' : 'Tailwind' }}
        </AppTextButton>
      </div>
      <AppTextButton
        data-test-id="code-panel-add-code-object"
        :ui="{
          base: 'flex items-center gap-1 rounded px-1.5 py-1 text-[9.5px] text-muted hover:bg-hover hover:text-surface'
        }"
        @click="addCodeObject"
      >
        <icon-lucide-plus class="size-3" />
        Add Code Object
      </AppTextButton>
    </div>

    <div v-if="!jsxCode" data-test-id="code-panel-empty" class="flex flex-1 flex-col px-3 py-3">
      <div class="flex items-start gap-2.5 border-b border-white/[0.055] pb-3">
        <div
          class="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-400/10 text-violet-200"
        >
          <icon-lucide-code-xml class="size-4" />
        </div>
        <div class="min-w-0">
          <div class="text-[11.5px] leading-4 font-medium text-surface">Code Objects</div>
          <div class="mt-0.5 text-[9.5px] leading-3.5 text-muted/70">
            TSX components rendered by OpenPencil inside ordinary board frames.
          </div>
        </div>
      </div>
      <AppTextButton
        data-test-id="code-panel-create-code-object"
        :ui="{
          base: 'mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-[7px] bg-violet-300 px-2 text-[10px] font-semibold text-[#17171a] hover:bg-violet-200'
        }"
        @click="addCodeObject"
      >
        <icon-lucide-plus class="size-3" />
        New Code Object
      </AppTextButton>
    </div>

    <ScrollAreaRoot
      v-else-if="jsxCode"
      data-test-id="code-panel"
      class="m-2.5 min-h-0 flex-1 overflow-hidden rounded-[9px] border border-white/[0.07] bg-black/15"
    >
      <ScrollAreaViewport class="code-highlight size-full">
        <div class="p-3.5">
          <div v-for="(html, i) in highlightedLines" :key="i" class="flex text-xs leading-5">
            <span
              class="mr-3 shrink-0 text-right text-muted/40 select-none"
              style="min-width: 1.5em"
              >{{ i + 1 }}</span
            >
            <pre
              class="m-0 min-w-0 flex-1 break-words whitespace-pre-wrap"
            ><code v-html="html" /></pre>
          </div>
        </div>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical" class="flex w-1.5 touch-none p-px select-none">
        <ScrollAreaThumb class="relative flex-1 rounded-full bg-white/10" />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>

    <div
      v-if="jsxCode"
      class="flex h-8 shrink-0 items-center justify-between px-3 pb-2 text-[9.5px] text-muted/65"
    >
      <span>{{ codeLineCount }} {{ codeLineCount === 1 ? 'line' : 'lines' }} · JSX</span>
      <span>{{ jsxFormat === 'openpencil' ? 'OpenPencil' : 'Tailwind' }}</span>
    </div>
  </div>
</template>
