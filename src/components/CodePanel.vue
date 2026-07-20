<script setup lang="ts">
import Prism from 'prismjs'
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { useClipboard } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { selectionToJSX } from '@open-pencil/core/design-jsx'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  HTML_BOARD_STARTER_CSS,
  HTML_BOARD_STARTER_HTML,
  HTML_BOARD_STARTER_JS,
  createStarterHtmlBoard,
  htmlBoardComposerRequest
} from '@/app/html-board/starter'
import {
  createHtmlBoardFrame,
  htmlBoardViewportInsets,
  isHtmlBoardFrame
} from '@/app/html-board/workspace'
import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'
import { selectedSourceDocument } from '@/app/source-document/workspace'
import HtmlBoardCodePanel from '@/components/HtmlBoardCodePanel.vue'
import SourceDocumentCodePanel from '@/components/SourceDocumentCodePanel.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import SmylrLiveCodePanel from '@/components/SmylrLiveCodePanel.vue'

import type { JSXFormat } from '@open-pencil/core/design-jsx'

const store = useEditorStore()
const { copy, copied } = useClipboard({ copiedDuring: 2000 })
const { dialogs } = useI18n()
const jsxFormat = ref<JSXFormat>('openpencil')
const showImporter = ref(false)
const importHTML = ref('')
const importCSS = ref('')
const importJS = ref('')
const importError = ref('')
const importing = ref(false)
const placing = ref(false)
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

const canImport = computed(() => importHTML.value.trim().length > 0)

const isSmylrLiveFrameSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length !== 1) return false
  const node = store.graph.getNode(ids[0])
  return isSmylrLiveAppFrameNode(node)
})

const isHtmlBoardSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length !== 1) return false
  return isHtmlBoardFrame(store.graph.getNode(ids[0]))
})

const isSourceDocumentSelected = useSceneComputed(() => {
  void store.state.sceneVersion
  return Boolean(selectedSourceDocument(store))
})

watch([importHTML, importCSS, importJS], () => {
  importError.value = ''
})

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return 'Import failed. Check the HTML and CSS, then try again.'
}

function toggleImporter() {
  showImporter.value = !showImporter.value
}

function useStarter() {
  importHTML.value = HTML_BOARD_STARTER_HTML
  importCSS.value = HTML_BOARD_STARTER_CSS
  importJS.value = HTML_BOARD_STARTER_JS
}

function createStarterBoard() {
  createStarterHtmlBoard(store)
  requestAnimationFrame(() => store.zoomToSelection(htmlBoardViewportInsets()))
}

watch(htmlBoardComposerRequest, () => {
  showImporter.value = true
})

async function pasteImportHTML() {
  try {
    importError.value = ''
    importHTML.value = await navigator.clipboard.readText()
  } catch (e) {
    importError.value = errorMessage(e)
  }
}

async function importCode() {
  if (!canImport.value || importing.value) return
  try {
    importing.value = true
    importError.value = ''
    await store.importDOMText(importHTML.value, {
      cssText: importCSS.value.trim() || undefined
    })
  } catch (e) {
    importError.value = errorMessage(e)
  } finally {
    importing.value = false
  }
}

async function placeHtmlBoard() {
  if (!canImport.value || importing.value || placing.value) return
  try {
    placing.value = true
    importError.value = ''
    createHtmlBoardFrame(store, importHTML.value, importCSS.value, importJS.value)
    requestAnimationFrame(() => store.zoomToSelection(htmlBoardViewportInsets()))
  } catch (e) {
    importError.value = errorMessage(e)
  } finally {
    placing.value = false
  }
}

function copyCode() {
  copy(jsxCode.value)
}
</script>

<template>
  <SourceDocumentCodePanel v-if="isSourceDocumentSelected" />

  <HtmlBoardCodePanel v-else-if="isHtmlBoardSelected" />

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
        data-test-id="code-panel-import-toggle"
        :ui="{
          base: 'flex items-center gap-1 rounded px-1.5 py-1 text-[9.5px] text-muted hover:bg-hover hover:text-surface'
        }"
        @click="toggleImporter"
      >
        <icon-lucide-plus class="size-3" />
        New board
      </AppTextButton>
    </div>

    <div
      v-if="showImporter"
      data-test-id="code-panel-importer"
      class="shrink-0 border-b border-white/[0.055] p-3"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-xs font-medium text-surface">New HTML board</div>
          <div class="text-[11px] text-muted">
            HTML, CSS, and JavaScript stay live on the canvas.
          </div>
        </div>
        <div class="flex items-center gap-1">
          <AppTextButton
            data-test-id="code-panel-starter"
            :ui="{ base: 'rounded px-1.5 py-0.5 text-[11px] hover:bg-hover' }"
            @click="useStarter"
          >
            Starter
          </AppTextButton>
          <AppTextButton
            data-test-id="code-panel-paste-import"
            :ui="{ base: 'rounded px-1.5 py-0.5 text-[11px] hover:bg-hover' }"
            @click="pasteImportHTML"
          >
            Paste
          </AppTextButton>
        </div>
      </div>
      <textarea
        v-model="importHTML"
        data-test-id="code-panel-import-html"
        class="mb-2 h-28 w-full resize-none rounded border border-border bg-panel px-2 py-1.5 font-mono text-xs text-surface outline-none placeholder:text-muted/50 focus:border-accent"
        placeholder='<div class="card">Hello</div>'
        spellcheck="false"
      />
      <textarea
        v-model="importCSS"
        data-test-id="code-panel-import-css"
        class="mb-2 h-20 w-full resize-none rounded border border-border bg-panel px-2 py-1.5 font-mono text-xs text-surface outline-none placeholder:text-muted/50 focus:border-accent"
        placeholder=".card { width: 240px; padding: 16px; border-radius: 12px; background: white; }"
        spellcheck="false"
      />
      <textarea
        v-model="importJS"
        data-test-id="code-panel-import-js"
        class="mb-2 h-16 w-full resize-none rounded border border-border bg-panel px-2 py-1.5 font-mono text-xs text-surface outline-none placeholder:text-muted/50 focus:border-accent"
        placeholder="document.querySelector('button')?.addEventListener('click', () => {})"
        spellcheck="false"
      />
      <div
        v-if="importError"
        data-test-id="code-panel-import-error"
        class="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200"
      >
        {{ importError }}
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-muted"
          >Live HTML/CSS/JS is canonical. Layer conversion is legacy.</span
        >
        <div class="flex items-center gap-1.5">
          <AppTextButton
            data-test-id="code-panel-place-html-board"
            :ui="{
              base: [
                'rounded px-2 py-1 text-[11px]',
                canImport && !importing && !placing
                  ? 'bg-accent text-black hover:bg-accent/90'
                  : 'cursor-not-allowed opacity-50'
              ].join(' ')
            }"
            @click="placeHtmlBoard"
          >
            {{ placing ? 'Creating…' : 'Create live board' }}
          </AppTextButton>
          <AppTextButton
            data-test-id="code-panel-import"
            :ui="{
              base: [
                'rounded px-2 py-1 text-[11px]',
                canImport && !importing && !placing
                  ? 'hover:bg-hover'
                  : 'cursor-not-allowed opacity-50'
              ].join(' ')
            }"
            @click="importCode"
          >
            {{ importing ? 'Converting…' : 'Legacy layers' }}
          </AppTextButton>
        </div>
      </div>
    </div>

    <div
      v-if="!jsxCode && !showImporter"
      data-test-id="code-panel-empty"
      class="flex flex-1 flex-col px-3 py-3"
    >
      <div class="flex items-start gap-2.5 border-b border-white/[0.055] pb-3">
        <div class="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-400/10 text-violet-200">
          <icon-lucide-code-xml class="size-4" />
        </div>
        <div class="min-w-0">
          <div class="text-[11.5px] leading-4 font-medium text-surface">Create a live HTML board</div>
          <div class="mt-0.5 text-[9.5px] leading-3.5 text-muted/70">
            Browser layout stays canonical and interactive on the canvas.
          </div>
        </div>
      </div>
      <AppTextButton
        data-test-id="code-panel-create-starter"
        :ui="{
          base: 'mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-[7px] bg-violet-300 px-2 text-[10px] font-semibold text-[#17171a] hover:bg-violet-200'
        }"
        @click="createStarterBoard"
      >
        <icon-lucide-plus class="size-3" />
        Start live board
      </AppTextButton>
      <AppTextButton
        data-test-id="code-panel-import-toggle"
        :ui="{
          base: 'mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium text-muted hover:bg-white/[0.055] hover:text-surface'
        }"
        @click="toggleImporter"
      >
        Paste or write code
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
