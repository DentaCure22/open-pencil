<script setup lang="ts">
import Prism from 'prismjs'
import 'prismjs/components/prism-jsx'
import { ScrollAreaRoot, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaViewport } from 'reka-ui'
import { useClipboard } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { selectionToJSX } from '@open-pencil/core/design-jsx'
import { useI18n, useSceneComputed } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { createHtmlBoardFrame, isHtmlBoardFrame } from '@/app/html-board/workspace'
import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'
import HtmlBoardCodePanel from '@/components/HtmlBoardCodePanel.vue'
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

const STARTER_HTML = `<main class="site" data-openpencil-component="LandingPage" data-openpencil-width="1440" data-openpencil-height="900">
  <nav data-openpencil-component="Navigation"><strong>New project</strong><a href="#content">Explore</a></nav>
  <section id="content" data-openpencil-component="Hero">
    <p class="eyebrow">HTML-first canvas</p>
    <h1>Design the real interface.</h1>
    <p class="lede">Edit standard HTML and CSS, then interact with the result directly on the board.</p>
    <button type="button" aria-pressed="false" data-openpencil-component="PrimaryAction" data-openpencil-prop-label="Start here" data-openpencil-variant="primary">Start here</button>
  </section>
</main>`

const STARTER_CSS = `:root {
  color-scheme: light;
  --op-surface: #f5f5f2;
  --op-text: #171717;
  --op-muted: #666666;
  --op-accent: #3159d9;
  --op-control-radius: 10px;
  --op-page-x: 64px;
  --op-font: Inter, system-ui, sans-serif;
  font-family: var(--op-font);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--op-surface); color: var(--op-text); }
.site { width: 100%; min-height: 100vh; padding: 48px var(--op-page-x); }
nav { display: flex; justify-content: space-between; align-items: center; }
nav a { color: inherit; text-decoration: none; }
section { max-width: 760px; margin-top: 190px; }
.eyebrow { color: var(--op-accent); font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
h1 { margin: 12px 0; font-size: 72px; line-height: .98; letter-spacing: -.05em; }
.lede { max-width: 620px; color: var(--op-muted); font-size: 20px; line-height: 1.5; }
button { margin-top: 24px; border: 0; border-radius: var(--op-control-radius); padding: 14px 20px; background: var(--op-text); color: white; font-weight: 650; }
button[aria-pressed="true"] { background: var(--op-accent); }
@media (max-width: 600px) {
  .site { padding: 28px 22px; }
  section { margin-top: 120px; }
  h1 { font-size: 48px; }
  .lede { font-size: 17px; }
}`

const STARTER_JS = `const action = document.querySelector('[data-openpencil-component="PrimaryAction"]')
action?.addEventListener('click', () => {
  const isActive = action.getAttribute('aria-pressed') === 'true'
  action.setAttribute('aria-pressed', String(!isActive))
  action.textContent = isActive ? 'Start here' : 'Started'
})`

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
  importHTML.value = STARTER_HTML
  importCSS.value = STARTER_CSS
  importJS.value = STARTER_JS
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
    createHtmlBoardFrame(store, importHTML.value, importCSS.value, importJS.value)
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
</script>

<template>
  <HtmlBoardCodePanel v-if="isHtmlBoardSelected" />

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
      class="flex flex-1 flex-col items-start px-3 py-3"
    >
      <div class="flex items-start gap-2.5">
        <icon-lucide-code-xml class="mt-0.5 size-4 shrink-0 text-muted/75" />
        <div class="min-w-0">
          <div class="text-[11.5px] leading-4 font-medium text-surface">Select a layer</div>
          <div class="mt-0.5 text-[9.5px] leading-3.5 text-muted/70">
            Inspect and copy its source representation here.
          </div>
        </div>
      </div>
      <AppTextButton
        data-test-id="code-panel-import-toggle"
        :ui="{
          base: 'mt-3 flex h-8 w-full items-center justify-start gap-1.5 rounded-[7px] bg-white/[0.055] px-2 text-[10px] font-medium text-muted hover:bg-white/[0.085] hover:text-surface'
        }"
        @click="toggleImporter"
      >
        <icon-lucide-plus class="size-3 text-violet-200" />
        New HTML board
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
