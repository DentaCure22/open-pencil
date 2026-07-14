<script setup lang="ts">
import Prism from 'prismjs'
import 'prismjs/components/prism-jsx'
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { useClipboard } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { JSX_REFERENCE, selectionToJSX } from '@open-pencil/core/design-jsx'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { createHtmlBoardFrame, isHtmlBoardFrame } from '@/app/html-board/workspace'
import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'
import HtmlBoardCodePanel from '@/components/HtmlBoardCodePanel.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import SmylrLiveCodePanel from '@/components/SmylrLiveCodePanel.vue'
import Tip from '@/components/ui/Tip.vue'

import type { JSXFormat } from '@open-pencil/core/design-jsx'

const store = useEditorStore()
const { copy, copied } = useClipboard({ copiedDuring: 2000 })
const { dialogs } = useI18n()
const jsxFormat = ref<JSXFormat>('openpencil')
const showImporter = ref(false)
const importHTML = ref('')
const importCSS = ref('')
const importError = ref('')
const importing = ref(false)
const placing = ref(false)

const STARTER_HTML = `<main class="site" data-openpencil-width="1440" data-openpencil-height="900">
  <nav><strong>New project</strong><a href="#content">Explore</a></nav>
  <section id="content">
    <p class="eyebrow">HTML-first canvas</p>
    <h1>Design the real interface.</h1>
    <p class="lede">Edit standard HTML and CSS, then interact with the result directly on the board.</p>
    <button type="button">Start here</button>
  </section>
</main>`

const STARTER_CSS = `:root { color-scheme: light; font-family: Inter, system-ui, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: #f5f5f2; color: #171717; }
.site { width: 1440px; height: 900px; padding: 48px 64px; }
nav { display: flex; justify-content: space-between; align-items: center; }
nav a { color: inherit; text-decoration: none; }
section { max-width: 760px; margin-top: 190px; }
.eyebrow { color: #3159d9; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
h1 { margin: 12px 0; font-size: 72px; line-height: .98; letter-spacing: -.05em; }
.lede { max-width: 620px; color: #666; font-size: 20px; line-height: 1.5; }
button { margin-top: 24px; border: 0; border-radius: 10px; padding: 14px 20px; background: #171717; color: white; font-weight: 650; }`

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
  const grammar = Prism.languages.jsx ?? Prism.languages.javascript
  return jsxCode.value.split('\n').map((line) => Prism.highlight(line, grammar, 'jsx'))
})

const { copy: copyRef, copied: copiedRef } = useClipboard({ copiedDuring: 2000 })

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

watch([importHTML, importCSS], () => {
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
  importHTML.value = STARTER_HTML
  importCSS.value = STARTER_CSS
}

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
    createHtmlBoardFrame(store, importHTML.value, importCSS.value)
    requestAnimationFrame(() => store.zoomToSelection())
  } catch (e) {
    importError.value = errorMessage(e)
  } finally {
    placing.value = false
  }
}

function copyCode() {
  copy(jsxCode.value)
}

function copyReference() {
  copyRef(JSX_REFERENCE)
}
</script>

<template>
  <HtmlBoardCodePanel v-if="isHtmlBoardSelected" />

  <SmylrLiveCodePanel v-else-if="isSmylrLiveFrameSelected" />

  <div v-else data-test-id="code-panel-root" class="flex min-h-0 flex-1 flex-col">
    <div
      v-if="jsxCode"
      data-test-id="code-panel-header"
      class="flex shrink-0 items-center justify-between px-3 py-1.5"
    >
      <div class="flex items-center gap-1.5">
        <span class="text-[11px] text-muted">JSX</span>
        <AppTextButton
          data-test-id="code-panel-format-toggle"
          :ui="{ base: 'rounded px-1.5 py-0.5 text-[11px] hover:bg-hover' }"
          @click="toggleFormat"
        >
          {{ jsxFormat === 'openpencil' ? 'OpenPencil' : 'Tailwind' }}
        </AppTextButton>
      </div>
      <div class="flex items-center gap-1">
        <AppTextButton
          data-test-id="code-panel-import-toggle"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-hover' }"
          @click="toggleImporter"
        >
          <icon-lucide-file-input class="size-3" />
          Import
        </AppTextButton>
        <Tip :label="dialogs.copyJSXReference">
          <AppTextButton
            data-test-id="code-panel-copy-ref"
            :ui="{
              base: 'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-hover'
            }"
            @click="copyReference"
          >
            <icon-lucide-check v-if="copiedRef" class="size-3 text-[var(--color-success)]" />
            <icon-lucide-book-open v-else class="size-3" />
          </AppTextButton>
        </Tip>
        <AppTextButton
          data-test-id="code-panel-copy"
          :ui="{ base: 'flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-hover' }"
          @click="copyCode"
        >
          <icon-lucide-check v-if="copied" class="size-3 text-[var(--color-success)]" />
          <icon-lucide-copy v-else class="size-3" />
          {{ copied ? dialogs.copied : dialogs.copy }}
        </AppTextButton>
      </div>
    </div>

    <div
      v-if="showImporter || !jsxCode"
      data-test-id="code-panel-importer"
      class="shrink-0 p-3"
    >
      <div class="mb-2 flex items-center justify-between gap-2">
        <div class="min-w-0">
          <div class="text-xs font-medium text-surface">New HTML board</div>
          <div class="text-[11px] text-muted">
            HTML is the primary design format. Paste, generate, or start from a clean page.
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
      <div
        v-if="importError"
        data-test-id="code-panel-import-error"
        class="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200"
      >
        {{ importError }}
      </div>
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] text-muted">Live HTML is canonical. Layer conversion is legacy.</span>
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
      v-if="!jsxCode"
      data-test-id="code-panel-empty"
      class="flex flex-1 items-center justify-center px-4 text-center"
    >
      <span class="text-xs text-muted">{{ dialogs.selectLayerForJSX }}</span>
    </div>

    <ScrollAreaRoot v-else data-test-id="code-panel" class="min-h-0 flex-1">
      <ScrollAreaViewport class="code-highlight size-full">
        <div class="p-3">
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
  </div>
</template>
