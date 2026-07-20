<script setup lang="ts">
import { templateRef, useElementVisibility, useObjectUrl } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import type { CadDrawing, CadDrawingPath, CadDrawingSource } from '@/app/cad/types'

type ViewerState = 'error' | 'idle' | 'loading' | 'ready'

const { interactive, source } = defineProps<{
  interactive: boolean
  source: CadDrawingSource
}>()

const store = useEditorStore()
const rootRef = templateRef<HTMLElement>('rootRef')
const visible = useElementVisibility(rootRef)
const drawing = shallowRef<CadDrawing | null>(null)
const viewerState = ref<ViewerState>('idle')
const errorMessage = ref('')
const zoom = ref(1)
let generation = 0

const active = computed(() => interactive && visible.value)
const retainedBytes = computed(() => store.graph.images.get(source.assetHash) ?? null)
const sourceBlob = computed(() => {
  const bytes = retainedBytes.value
  return bytes
    ? new Blob([bytes.slice().buffer], { type: source.metadata.mimeType || 'image/vnd.dxf' })
    : null
})
const sourceUrl = useObjectUrl(sourceBlob)

const viewBox = computed(() => {
  const bounds = drawing.value?.bounds
  if (!bounds) return '-1 -1 2 2'
  const basePadding = Math.max(bounds.width, bounds.height) * 0.06
  const fullWidth = bounds.width + basePadding * 2
  const fullHeight = bounds.height + basePadding * 2
  const width = fullWidth / zoom.value
  const height = fullHeight / zoom.value
  const centerX = bounds.minX + bounds.width / 2
  const centerY = bounds.minY + bounds.height / 2
  return `${centerX - width / 2} ${centerY - height / 2} ${width} ${height}`
})

const statusMessage = computed(() => {
  if (viewerState.value === 'error') return errorMessage.value
  if (viewerState.value === 'loading') return `Reading ${source.fileName}`
  return 'Select the source object to load its read-only DXF drawing.'
})

function pathPoints(path: CadDrawingPath): string {
  return path.points.map((point) => `${point.x},${point.y}`).join(' ')
}

function fitDrawing(): void {
  zoom.value = 1
}

function zoomDrawing(factor: number): void {
  zoom.value = Math.min(8, Math.max(0.5, zoom.value * factor))
}

async function loadDrawing(): Promise<void> {
  const expectedGeneration = ++generation
  const bytes = retainedBytes.value
  drawing.value = null
  zoom.value = 1
  if (!bytes) {
    viewerState.value = 'error'
    errorMessage.value = 'The retained DXF source bytes are unavailable.'
    return
  }
  viewerState.value = 'loading'
  errorMessage.value = ''
  try {
    const { parseDxfDrawing } = await import('@/app/cad/runtime/dxf')
    const next = parseDxfDrawing(bytes)
    if (expectedGeneration !== generation || !active.value) return
    drawing.value = next
    viewerState.value = 'ready'
  } catch (error) {
    if (expectedGeneration !== generation) return
    viewerState.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : 'DXF could not be rendered.'
  }
}

watch(
  [active, () => source.assetHash],
  ([shouldLoad]) => {
    if (shouldLoad) void loadDrawing()
    else {
      generation += 1
      drawing.value = null
      viewerState.value = 'idle'
      errorMessage.value = ''
      zoom.value = 1
    }
  },
  { immediate: true }
)
</script>

<template>
  <article
    ref="rootRef"
    class="relative size-full overflow-hidden bg-[#0b0f0e]"
    data-test-id="cad-dxf-viewer"
    :data-interactive="interactive"
    :data-runtime-state="viewerState"
    @contextmenu.stop.prevent
  >
    <header
      class="absolute inset-x-0 top-0 z-20 flex h-8 items-center justify-between gap-3 border-b border-white/10 bg-[#111715]/94 px-3 backdrop-blur-sm"
    >
      <div class="flex min-w-0 items-center gap-2">
        <span class="min-w-0 truncate text-[11px] font-medium text-[#eef5f1]">
          {{ source.fileName }}
        </span>
        <span
          class="shrink-0 rounded-full border border-[#6fc4a5]/30 px-1.5 py-0.5 text-[8px] font-bold tracking-[0.08em] text-[#83cfb4]"
        >
          DXF · READ ONLY
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="rounded-md px-1.5 py-1 text-[9px] font-semibold text-[#c8d8d1] hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-[#73c9aa]"
          aria-label="Zoom out of DXF drawing"
          data-test-id="cad-zoom-out"
          @click.stop="zoomDrawing(0.8)"
        >
          <icon-lucide-minus class="size-3" />
        </button>
        <button
          type="button"
          class="rounded-md px-1.5 py-1 text-[9px] font-semibold text-[#c8d8d1] hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-[#73c9aa]"
          aria-label="Fit DXF drawing in view"
          data-test-id="cad-fit"
          @click.stop="fitDrawing"
        >
          Fit
        </button>
        <button
          type="button"
          class="rounded-md px-1.5 py-1 text-[9px] font-semibold text-[#c8d8d1] hover:bg-white/8 hover:text-white focus-visible:outline-2 focus-visible:outline-[#73c9aa]"
          aria-label="Zoom into DXF drawing"
          data-test-id="cad-zoom-in"
          @click.stop="zoomDrawing(1.25)"
        >
          <icon-lucide-plus class="size-3" />
        </button>
        <a
          v-if="sourceUrl"
          :aria-label="`Download exact DXF source: ${source.fileName}`"
          :download="source.fileName"
          :href="sourceUrl"
          class="ml-1 rounded-md border border-white/10 px-2 py-1 text-[9px] font-semibold text-[#dce9e3] hover:bg-white/8"
          @click.stop
        >
          Source
        </a>
      </div>
    </header>

    <svg
      v-if="drawing && viewerState === 'ready'"
      :viewBox="viewBox"
      class="absolute inset-x-0 top-8 h-[calc(100%-2rem)] w-full bg-[#09100d]"
      aria-label="Read-only DXF drawing preview"
      data-test-id="cad-dxf-geometry"
      preserveAspectRatio="xMidYMid meet"
    >
      <polyline
        v-for="(path, index) in drawing.paths"
        :key="`${path.layer}-${index}`"
        :points="pathPoints(path)"
        :stroke="path.color"
        :data-cad-layer="path.layer"
        :fill="path.closed ? `${path.color}18` : 'none'"
        stroke-linecap="round"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
        stroke-width="1.15"
      />
      <text
        v-for="(text, index) in drawing.texts"
        :key="`${text.layer}-text-${index}`"
        :x="text.x"
        :y="text.y"
        :fill="text.color"
        :font-size="text.height"
        :transform="`rotate(${text.rotation} ${text.x} ${text.y})`"
        font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
      >
        {{ text.content }}
      </text>
    </svg>

    <div
      v-if="viewerState !== 'ready'"
      class="pointer-events-none absolute inset-x-0 top-8 bottom-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#0b100e]/92 px-8 text-center"
      :role="viewerState === 'error' ? 'alert' : 'status'"
      aria-live="polite"
      data-test-id="cad-status"
    >
      <icon-lucide-triangle-alert v-if="viewerState === 'error'" class="size-5 text-[#e7a3a3]" />
      <icon-lucide-loader-circle
        v-else-if="viewerState === 'loading'"
        class="size-5 animate-spin text-[#73c9aa]"
      />
      <icon-lucide-ruler v-else class="size-5 text-[#73c9aa]" />
      <span class="max-w-[420px] text-[10px] leading-4 text-[#c3d0ca]">{{ statusMessage }}</span>
    </div>

    <div
      v-if="drawing && viewerState === 'ready'"
      class="pointer-events-none absolute bottom-2 left-2 z-10 rounded-md border border-white/8 bg-[#09100d]/82 px-2 py-1 text-[8px] tracking-[0.04em] text-[#a9bbb3] backdrop-blur-sm"
      data-test-id="cad-dxf-stats"
    >
      {{ drawing.renderedEntityCount.toLocaleString() }} /
      {{ drawing.entityCount.toLocaleString() }} ENTITIES · {{ drawing.layerCount }} LAYERS ·
      {{ drawing.units.toUpperCase() }}
      <span v-if="drawing.omittedEntityCount"> · {{ drawing.omittedEntityCount }} OMITTED</span>
    </div>
    <div
      v-if="drawing && viewerState === 'ready'"
      class="pointer-events-none absolute right-2 bottom-2 z-10 rounded-md border border-[#73c9aa]/18 bg-[#09100d]/82 px-2 py-1 text-[8px] text-[#9fc5b6] backdrop-blur-sm"
    >
      Visual reference only · exact source retained
    </div>
  </article>
</template>
