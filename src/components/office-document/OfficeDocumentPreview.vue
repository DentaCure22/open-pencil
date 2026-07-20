<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import { parseOfficeDocumentPreview } from '@/app/office-document/preview'
import type {
  DocxPreview,
  OfficeDocumentKind,
  OfficePreviewResult,
  PptxPreview,
  PresentationShape,
  SpreadsheetSheet,
  XlsxPreview
} from '@/app/office-document/types'

const { assetBytes, kind, selected } = defineProps<{
  assetBytes: Uint8Array
  kind: OfficeDocumentKind
  selected: boolean
}>()

type PreviewState = OfficePreviewResult | { status: 'loading' }

const state = shallowRef<PreviewState>({ status: 'loading' })
const activeSheetIndex = ref(0)
const activeSlideIndex = ref(0)
let previewEpoch = 0

watch(
  () => [assetBytes, kind] as const,
  async ([bytes, kind]) => {
    const epoch = ++previewEpoch
    state.value = { status: 'loading' }
    activeSheetIndex.value = 0
    activeSlideIndex.value = 0
    await nextTick()
    const result = parseOfficeDocumentPreview(bytes, kind)
    if (epoch === previewEpoch) state.value = result
  },
  { immediate: true }
)

const docx = computed<DocxPreview | null>(() => {
  const preview = state.value.status === 'ready' ? state.value.preview : null
  return preview?.kind === 'docx' ? preview : null
})

const xlsx = computed<XlsxPreview | null>(() => {
  const preview = state.value.status === 'ready' ? state.value.preview : null
  return preview?.kind === 'xlsx' ? preview : null
})

const pptx = computed<PptxPreview | null>(() => {
  const preview = state.value.status === 'ready' ? state.value.preview : null
  return preview?.kind === 'pptx' ? preview : null
})

const activeSheet = computed<SpreadsheetSheet | null>(
  () => xlsx.value?.sheets[activeSheetIndex.value] ?? null
)
const visibleRows = computed(() =>
  Array.from({ length: Math.min(activeSheet.value?.rowCount ?? 0, 40) }, (_, index) => index)
)
const visibleColumns = computed(() =>
  Array.from({ length: Math.min(activeSheet.value?.columnCount ?? 0, 18) }, (_, index) => index)
)
const activeCells = computed(() => {
  const result = new Map<string, string>()
  for (const cell of activeSheet.value?.cells ?? []) {
    result.set(`${cell.row}:${cell.column}`, cell.value)
  }
  return result
})
const activeSlide = computed(() => pptx.value?.slides[activeSlideIndex.value] ?? null)

function columnLabel(index: number): string {
  let value = index + 1
  let label = ''
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

function cellValue(row: number, column: number): string {
  return activeCells.value.get(`${row}:${column}`) ?? ''
}

function shapeStyle(shape: PresentationShape) {
  return {
    height: `${shape.height}%`,
    left: `${shape.x}%`,
    top: `${shape.y}%`,
    width: `${shape.width}%`
  }
}

function previousSlide() {
  activeSlideIndex.value = Math.max(0, activeSlideIndex.value - 1)
}

function nextSlide() {
  const lastIndex = Math.max(0, (pptx.value?.slides.length ?? 1) - 1)
  activeSlideIndex.value = Math.min(lastIndex, activeSlideIndex.value + 1)
}
</script>

<template>
  <div
    class="relative size-full overflow-hidden bg-[#18191d]"
    :class="selected ? 'pointer-events-auto' : 'pointer-events-none'"
    data-test-id="office-document-preview"
  >
    <div
      v-if="state.status === 'loading'"
      class="flex size-full flex-col items-center justify-center gap-2 text-[11px] text-[#c8c5cf]"
      data-test-id="office-document-loading"
      role="status"
    >
      <icon-lucide-loader-circle class="size-5 animate-spin text-[#9f8cdf]" />
      <span>Preparing read-only preview</span>
    </div>

    <div
      v-else-if="state.status === 'error'"
      class="flex size-full flex-col items-center justify-center gap-3 px-10 text-center"
      data-test-id="office-document-fallback"
      role="status"
    >
      <div class="flex size-11 items-center justify-center rounded-xl bg-[#2a2634] text-[#b9a7ef]">
        <icon-lucide-file-warning class="size-5" />
      </div>
      <div>
        <p class="text-[12px] font-semibold text-[#eceaf0]">Preview unavailable</p>
        <p class="mt-1 max-w-[380px] text-[10px] leading-4 text-[#aaa7b1]">
          {{ state.message }} Original file remains preserved and downloadable.
        </p>
      </div>
    </div>

    <div
      v-else-if="docx"
      class="flex size-full flex-col bg-[#d9dadd]"
      data-test-id="office-docx-preview"
    >
      <div
        class="flex h-8 shrink-0 items-center justify-between border-b border-black/10 bg-[#f2f2f3] px-3 text-[9px] text-[#5d5e63]"
      >
        <span class="truncate">{{ docx.title }}</span>
        <span class="font-semibold tracking-[0.06em] text-[#67616f]">TEXT-FLOW PREVIEW</span>
      </div>
      <div class="min-h-0 flex-1 overflow-auto px-8 py-5">
        <article class="mx-auto min-h-full max-w-[520px] bg-white px-12 py-10 shadow-sm">
          <template v-for="(block, index) in docx.blocks" :key="`${index}:${block.text}`">
            <h1
              v-if="block.kind === 'title'"
              class="mb-5 text-[25px] leading-8 font-semibold tracking-[-0.02em] text-[#202124]"
            >
              {{ block.text }}
            </h1>
            <h2
              v-else-if="block.kind === 'heading'"
              class="mt-5 mb-2 font-semibold text-[#28292d]"
              :class="block.level <= 1 ? 'text-[19px] leading-6' : 'text-[15px] leading-5'"
            >
              {{ block.text }}
            </h2>
            <p
              v-else-if="block.kind === 'list-item'"
              class="mb-2 text-[11px] leading-[1.7] text-[#35363a]"
              :class="block.level > 0 ? 'pl-6' : 'pl-3'"
            >
              <span class="mr-2 text-[#716884]">•</span>{{ block.text }}
            </p>
            <p v-else class="mb-3 text-[11px] leading-[1.75] text-[#35363a]">
              {{ block.text }}
            </p>
          </template>
          <p v-if="docx.truncated" class="mt-6 border-t pt-3 text-[9px] text-[#777980]">
            Preview shortened. The original document remains complete.
          </p>
        </article>
      </div>
    </div>

    <div
      v-else-if="xlsx && activeSheet"
      class="flex size-full flex-col bg-[#f7f7f7]"
      data-test-id="office-xlsx-preview"
    >
      <div
        class="flex h-8 shrink-0 items-center justify-between border-b border-[#dadce0] bg-white px-3 text-[9px] text-[#5f6368]"
      >
        <span>Read-only sheet preview</span>
        <span>{{ activeSheet.cells.length }} populated cells</span>
      </div>
      <div class="min-h-0 flex-1 overflow-auto bg-white">
        <table class="border-separate border-spacing-0 text-[10px] text-[#303134]">
          <thead class="sticky top-0 z-10 bg-[#f1f3f4]">
            <tr>
              <th class="sticky left-0 z-20 h-6 min-w-9 border-r border-b border-[#d5d7da]" />
              <th
                v-for="column in visibleColumns"
                :key="column"
                class="h-6 min-w-24 border-r border-b border-[#d5d7da] px-2 text-center font-medium text-[#666970]"
              >
                {{ columnLabel(column) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in visibleRows" :key="row">
              <th
                class="sticky left-0 h-7 border-r border-b border-[#dedfe2] bg-[#f1f3f4] px-2 text-right font-medium text-[#73767d]"
              >
                {{ row + 1 }}
              </th>
              <td
                v-for="column in visibleColumns"
                :key="column"
                class="h-7 max-w-40 min-w-24 truncate border-r border-b border-[#e3e4e7] px-2"
              >
                {{ cellValue(row, column) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        class="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-t border-[#d7d9dc] bg-[#f4f5f6] px-2"
      >
        <button
          v-for="(sheet, index) in xlsx.sheets"
          :key="`${index}:${sheet.name}`"
          type="button"
          class="h-7 shrink-0 border-b-2 px-3 text-[9px] font-medium"
          :class="
            index === activeSheetIndex
              ? 'border-[#6f5eb2] bg-white text-[#342d4a]'
              : 'border-transparent text-[#62656b] hover:bg-black/4'
          "
          :aria-pressed="index === activeSheetIndex"
          @click="activeSheetIndex = index"
        >
          {{ sheet.name }}
        </button>
        <span v-if="xlsx.truncated" class="ml-auto shrink-0 px-2 text-[8px] text-[#777980]">
          Preview shortened
        </span>
      </div>
    </div>

    <div
      v-else-if="pptx && activeSlide"
      class="flex size-full flex-col bg-[#232429]"
      data-test-id="office-pptx-preview"
    >
      <div
        class="flex h-9 shrink-0 items-center justify-between border-b border-white/8 bg-[#191a1e] px-3 text-[9px] text-[#c7c5cc]"
      >
        <span>Text-layout preview</span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            :disabled="activeSlideIndex === 0"
            class="rounded p-1 hover:bg-white/8 disabled:opacity-30"
            aria-label="Previous slide"
            @click="previousSlide"
          >
            <icon-lucide-chevron-left class="size-3" />
          </button>
          <span>{{ activeSlideIndex + 1 }} / {{ pptx.slides.length }}</span>
          <button
            type="button"
            :disabled="activeSlideIndex >= pptx.slides.length - 1"
            class="rounded p-1 hover:bg-white/8 disabled:opacity-30"
            aria-label="Next slide"
            @click="nextSlide"
          >
            <icon-lucide-chevron-right class="size-3" />
          </button>
        </div>
      </div>
      <div class="flex min-h-0 flex-1 items-center justify-center p-6">
        <section
          class="relative aspect-video max-h-full w-full max-w-[620px] overflow-hidden bg-white shadow-[0_16px_40px_rgba(0,0,0,0.28)]"
          :aria-label="activeSlide.name"
          data-test-id="office-pptx-slide"
        >
          <div
            v-for="(shape, index) in activeSlide.shapes"
            :key="`${index}:${shape.text}`"
            :style="shapeStyle(shape)"
            class="absolute overflow-hidden text-[#25262a]"
            :class="
              shape.role === 'title'
                ? 'text-[clamp(11px,2vw,22px)] leading-tight font-semibold tracking-[-0.02em]'
                : 'whitespace-pre-line text-[clamp(8px,1.25vw,14px)] leading-[1.35]'
            "
          >
            {{ shape.text }}
          </div>
          <div
            v-if="activeSlide.shapes.length === 0"
            class="flex size-full items-center justify-center text-[11px] text-[#85878d]"
          >
            No supported text on this slide
          </div>
        </section>
      </div>
      <div class="h-5 shrink-0 px-3 text-right text-[8px] text-[#918d9a]">
        Images, charts, transitions, and theme styling are not rendered
      </div>
    </div>
  </div>
</template>
