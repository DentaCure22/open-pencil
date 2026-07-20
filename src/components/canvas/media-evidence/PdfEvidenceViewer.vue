<script setup lang="ts">
import { refAutoReset } from '@vueuse/core'
import { nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'

import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import { placeExtractedPdfPage } from '@/app/media-evidence/extraction'
import {
  extractPdfPageImage,
  startPdfDocumentLoad,
  startPdfPageRender
} from '@/app/media-evidence/pdf'
import type { MediaEvidenceSource } from '@/app/media-evidence/source'

type PdfViewerState = 'error' | 'loading' | 'ready'

const { assetBytes, node, selected, source, sourceUrl } = defineProps<{
  assetBytes: Uint8Array
  node: SceneNode
  selected: boolean
  source: MediaEvidenceSource
  sourceUrl: string
}>()

const store = useEditorStore()
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const pdf = shallowRef<PDFDocumentProxy>()
const pageCount = ref(0)
const pageNumber = ref(1)
const state = ref<PdfViewerState>('loading')
const errorMessage = ref('')
const isExtracting = ref(false)
const extracted = refAutoReset(false, 1800)
const extractionError = refAutoReset(false, 2400)

let loadingTask: PDFDocumentLoadingTask | null = null
let renderTask: RenderTask | null = null
let loadEpoch = 0
let renderEpoch = 0

function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException'
}

async function disposePdf() {
  loadEpoch += 1
  renderEpoch += 1
  renderTask?.cancel()
  renderTask = null
  const activePdf = pdf.value
  const activeLoadingTask = loadingTask
  pdf.value = undefined
  loadingTask = null
  if (activePdf) await activePdf.destroy()
  else if (activeLoadingTask) await activeLoadingTask.destroy()
}

async function renderPage() {
  const activePdf = pdf.value
  if (!activePdf) return
  const currentEpoch = ++renderEpoch
  renderTask?.cancel()
  renderTask = null
  state.value = 'loading'
  errorMessage.value = ''
  await nextTick()
  const target = canvas.value
  if (!target || currentEpoch !== renderEpoch) return

  try {
    const task = await startPdfPageRender(activePdf, pageNumber.value, target)
    if (currentEpoch !== renderEpoch) {
      task.cancel()
      return
    }
    renderTask = task
    await task.promise
    if (currentEpoch === renderEpoch) state.value = 'ready'
  } catch (error) {
    if (currentEpoch !== renderEpoch || isCancelled(error)) return
    state.value = 'error'
    errorMessage.value = 'This page could not be rendered.'
  } finally {
    if (currentEpoch === renderEpoch) renderTask = null
  }
}

async function loadSource() {
  await disposePdf()
  const currentEpoch = ++loadEpoch
  pageCount.value = 0
  pageNumber.value = 1
  state.value = 'loading'
  errorMessage.value = ''

  try {
    const task = startPdfDocumentLoad(assetBytes)
    loadingTask = task
    const loadedPdf = await task.promise
    if (currentEpoch !== loadEpoch) {
      await loadedPdf.destroy()
      return
    }
    pdf.value = loadedPdf
    pageCount.value = loadedPdf.numPages
    await renderPage()
  } catch {
    if (currentEpoch !== loadEpoch) return
    state.value = 'error'
    errorMessage.value =
      assetBytes.byteLength === 0
        ? 'This PDF has no source data.'
        : 'This PDF could not be decoded.'
  }
}

function goToPage(nextPage: number) {
  if (!Number.isFinite(nextPage) || pageCount.value === 0) return
  const clamped = Math.min(pageCount.value, Math.max(1, Math.round(nextPage)))
  if (clamped === pageNumber.value) return
  pageNumber.value = clamped
  void renderPage()
}

function handlePageInput(event: Event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  goToPage(Number(input.value))
  input.value = String(pageNumber.value)
}

async function extractPage() {
  const activePdf = pdf.value
  if (!activePdf || isExtracting.value || state.value !== 'ready') return
  isExtracting.value = true
  extractionError.value = false
  try {
    const image = await extractPdfPageImage(activePdf, pageNumber.value, source.fileName)
    const sourceNode = store.graph.getNode(node.id)
    if (!sourceNode) return
    placeExtractedPdfPage(store, sourceNode, source, pageNumber.value, image)
    extracted.value = true
  } catch {
    extractionError.value = true
  } finally {
    isExtracting.value = false
  }
}

watch(
  () => source.assetHash,
  () => void loadSource(),
  { immediate: true }
)

onBeforeUnmount(() => {
  void disposePdf()
})
</script>

<template>
  <div
    class="relative flex size-full items-center justify-center overflow-hidden bg-[#d8d7d3] p-3 pb-14"
    data-test-id="media-evidence-pdf-viewer"
  >
    <canvas
      ref="canvas"
      :aria-label="`PDF page ${pageNumber} of ${pageCount}: ${source.fileName}`"
      class="max-h-full max-w-full bg-white shadow-[0_2px_14px_rgba(0,0,0,0.16)]"
      data-test-id="media-evidence-pdf-canvas"
      role="img"
    />

    <div
      v-if="state !== 'ready'"
      :role="state === 'error' ? 'alert' : 'status'"
      aria-live="polite"
      class="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#111218]/94 px-6 text-center text-[11px] text-[#d7d4e2]"
      data-test-id="media-evidence-pdf-status"
    >
      <icon-lucide-circle-alert v-if="state === 'error'" class="size-5 text-[#f0a7a7]" />
      <icon-lucide-loader-circle v-else class="size-5 animate-spin text-[#a995f1]" />
      <span>{{ state === 'error' ? errorMessage : 'Loading PDF preview' }}</span>
      <a
        v-if="state === 'error'"
        :href="sourceUrl"
        :aria-label="`Open source PDF: ${source.fileName}`"
        class="pointer-events-auto mt-1 text-[10px] font-medium text-[#c8bdf5] underline underline-offset-2"
        rel="noopener noreferrer"
        target="_blank"
      >
        Open source PDF
      </a>
    </div>

    <div
      v-if="pageCount > 0"
      class="absolute right-3 bottom-3 left-3 z-20 flex h-9 items-center justify-between gap-2 rounded-md border border-black/10 bg-[#17181d]/94 px-2 text-[10px] text-white shadow-sm backdrop-blur-sm"
      data-test-id="media-evidence-pdf-controls"
    >
      <div class="flex items-center gap-1">
        <button
          :disabled="pageNumber <= 1 || state === 'loading'"
          :aria-label="`Previous PDF page, currently page ${pageNumber} of ${pageCount}`"
          class="flex size-7 items-center justify-center rounded text-[#d8d6df] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
          type="button"
          @click="goToPage(pageNumber - 1)"
          @keydown.enter.stop.prevent="goToPage(pageNumber - 1)"
          @keydown.space.stop.prevent="goToPage(pageNumber - 1)"
        >
          <icon-lucide-chevron-left class="size-3.5" />
        </button>
        <label class="flex items-center gap-1 text-[#bcb9c5]">
          <span class="sr-only">PDF page</span>
          <input
            :aria-label="`PDF page, ${pageCount} pages total`"
            :max="pageCount"
            :min="1"
            :value="pageNumber"
            class="h-6 w-9 rounded border border-white/10 bg-white/7 px-1 text-center font-medium text-white outline-none focus:border-[#9a88ef]"
            inputmode="numeric"
            type="number"
            @change="handlePageInput"
          />
          <span aria-hidden="true">/ {{ pageCount }}</span>
        </label>
        <button
          :disabled="pageNumber >= pageCount || state === 'loading'"
          :aria-label="`Next PDF page, currently page ${pageNumber} of ${pageCount}`"
          class="flex size-7 items-center justify-center rounded text-[#d8d6df] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
          type="button"
          @click="goToPage(pageNumber + 1)"
          @keydown.enter.stop.prevent="goToPage(pageNumber + 1)"
          @keydown.space.stop.prevent="goToPage(pageNumber + 1)"
        >
          <icon-lucide-chevron-right class="size-3.5" />
        </button>
      </div>

      <div class="flex min-w-0 items-center gap-1.5">
        <span v-if="extractionError" class="truncate text-[#f0a7a7]" role="alert">
          Extraction failed
        </span>
        <span v-else-if="extracted" class="truncate text-[#a9dccb]" role="status">
          Page extracted
        </span>
        <button
          v-if="selected"
          :disabled="isExtracting || state !== 'ready'"
          class="flex h-7 items-center gap-1.5 rounded bg-[#7567d9] px-2.5 font-medium text-white hover:bg-[#8476e6] disabled:cursor-not-allowed disabled:opacity-45"
          type="button"
          @click="extractPage"
          @keydown.enter.stop.prevent="extractPage"
          @keydown.space.stop.prevent="extractPage"
        >
          <icon-lucide-scan-text class="size-3" />
          {{ isExtracting ? 'Extracting…' : `Extract page ${pageNumber}` }}
        </button>
        <a
          :href="sourceUrl"
          :aria-label="`Open source PDF: ${source.fileName}`"
          class="flex size-7 items-center justify-center rounded text-[#d8d6df] hover:bg-white/10"
          rel="noopener noreferrer"
          target="_blank"
        >
          <icon-lucide-external-link class="size-3.5" />
        </a>
      </div>
    </div>
  </div>
</template>
