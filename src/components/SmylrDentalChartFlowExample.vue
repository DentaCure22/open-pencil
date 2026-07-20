<script setup lang="ts">
import { computed } from 'vue'
import { useEventListener, useUrlSearchParams } from '@vueuse/core'

import { useEditorStore } from '@/app/editor/active-store'
import { selectedDentalFlowFrameId } from '@/app/smylr-live-inspector/flow-frames'
import { smylrFrameBaseUrlFor } from '@/app/smylr-live-inspector/frame-origin'
import {
  liveInspectorInteractionMode,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import {
  findCurrentSmylrLiveAppFrame,
  smylrLiveAppFrameRoute
} from '@/app/smylr-production/workspace'
import Tip from './ui/Tip.vue'

// The primary Current iframe is always live, so two alternate runtimes keeps
// the whole canvas capped at three active production apps.
const MAX_LIVE_IFRAMES = 2
const GAP = 100

const store = useEditorStore()
const params = useUrlSearchParams('history')
const steps = [
  { id: 'exam-setup', label: 'Exam setup', note: 'Patient context ready' },
  { id: 'active-charting', label: 'Active charting', note: 'Odontogram editing state' },
  { id: 'review', label: 'Review', note: 'Findings ready for treatment' }
]

const liveFrame = computed(() => findCurrentSmylrLiveAppFrame(store))
const isDentalChart = computed(() => {
  const frame = liveFrame.value
  if (!frame) return false
  const route = smylrLiveAppFrameRoute(frame).replace(/\/+$/, '')
  return route === '/dental-chart' || params['smylr-page'] === 'dental-chart'
})
const baseUrl = computed(() => smylrFrameBaseUrlFor(window.location.href))

function worldPosition(index: number) {
  const frame = liveFrame.value
  return frame ? { x: frame.x + (index + 1) * (frame.width + GAP), y: frame.y } : { x: 0, y: 0 }
}

const liveStepIds = computed(() => {
  // Keep the selected frame live, then assign the remaining pool slots to the
  // frames nearest the viewport center. The pool size never grows with canvas size.
  const zoom = store.state.zoom
  const viewportX = (-store.state.panX + window.innerWidth / 2) / zoom
  const viewportY = (-store.state.panY + window.innerHeight / 2) / zoom
  const ranked = steps
    .filter((step) => step.id !== selectedDentalFlowFrameId.value)
    .map((step, index) => {
      const actualIndex = steps.findIndex((candidate) => candidate.id === step.id)
      const position = worldPosition(actualIndex)
      const dx = position.x + (liveFrame.value?.width ?? 0) / 2 - viewportX
      const dy = position.y + (liveFrame.value?.height ?? 0) / 2 - viewportY
      return { id: step.id, distance: dx * dx + dy * dy + index / 100 }
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.max(0, MAX_LIVE_IFRAMES - 1))
    .map((entry) => entry.id)
  return new Set([selectedDentalFlowFrameId.value, ...ranked])
})

function stepSrc(id: string) {
  return `${baseUrl.value}/dental-chart?smylr-openpencil=1&smylr-flow-state=${id}`
}

function stepStyle(index: number) {
  const position = worldPosition(index)
  const zoom = store.state.zoom
  return {
    height: `${liveFrame.value?.height ?? 900}px`,
    transform: `translate3d(${position.x * zoom + store.state.panX}px, ${position.y * zoom + store.state.panY}px, 0) scale(${zoom})`,
    transformOrigin: 'top left',
    width: `${liveFrame.value?.width ?? 1280}px`
  }
}

function activateStep(id: string) {
  selectedDentalFlowFrameId.value = id
}

function selectContainers(id: string) {
  activateStep(id)
  setLiveInspectorInteractionMode('select')
}

function interactWithFrame(id: string) {
  activateStep(id)
  setLiveInspectorInteractionMode('interact')
}

function focusStep(event: Event) {
  const stepId = (event as CustomEvent<{ stepId?: string }>).detail?.stepId
  const frame = liveFrame.value
  if (!frame) return
  if (stepId === 'all') {
    const last = worldPosition(steps.length - 1)
    store.zoomToBounds(frame.x, frame.y, last.x + frame.width, last.y + frame.height)
    return
  }
  const index = steps.findIndex((step) => step.id === stepId)
  if (index < 0) return
  selectedDentalFlowFrameId.value = steps[index]!.id
  const position = worldPosition(index)
  store.zoomToBounds(position.x, position.y, position.x + frame.width, position.y + frame.height)
}

useEventListener(window, 'smylr:dental-flow-focus', focusStep)
</script>

<template>
  <div
    v-if="isDentalChart"
    data-test-id="dental-chart-flow-example"
    class="pointer-events-none absolute inset-0 z-10"
  >
    <article
      v-for="(step, index) in steps"
      :key="step.id"
      :data-flow-step="step.id"
      :data-runtime-state="liveStepIds.has(step.id) ? 'live' : 'frozen'"
      class="bg-panel pointer-events-auto absolute overflow-visible rounded-lg shadow-lg"
      :class="selectedDentalFlowFrameId === step.id ? 'outline outline-1 outline-violet-500' : ''"
      :style="stepStyle(index)"
      @pointerdown="activateStep(step.id)"
      @click="activateStep(step.id)"
    >
      <header
        class="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-0.5 whitespace-nowrap rounded-md border border-border bg-panel px-1 py-0.5 text-surface shadow-sm transition-colors hover:border-violet-500 hover:bg-hover"
        :class="selectedDentalFlowFrameId === step.id ? 'border-violet-500 bg-hover' : ''"
        @click.stop="activateStep(step.id)"
        @pointerdown.stop
      >
        <Tip :label="liveStepIds.has(step.id) ? 'Live production runtime' : 'Frozen preview'">
          <span
            class="ml-1 size-1.5 rounded-full"
            :class="liveStepIds.has(step.id) ? 'bg-green-500' : 'bg-muted'"
          />
        </Tip>
        <strong class="max-w-36 truncate px-1 text-[10px] font-medium">{{ step.label }}</strong>
        <span class="mx-0.5 h-3.5 w-px bg-border" />
        <Tip label="Select containers">
          <button
            type="button"
            :data-flow-select="step.id"
            class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            :class="
              selectedDentalFlowFrameId === step.id && liveInspectorInteractionMode === 'select'
                ? 'bg-hover text-surface'
                : ''
            "
            @click.stop="selectContainers(step.id)"
            @pointerdown.stop
          >
            <icon-lucide-mouse-pointer-2 class="size-4" />
          </button>
        </Tip>
        <Tip label="Use live app">
          <button
            type="button"
            :data-flow-interact="step.id"
            class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
            :class="
              selectedDentalFlowFrameId === step.id && liveInspectorInteractionMode === 'interact'
                ? 'bg-hover text-surface'
                : ''
            "
            @click.stop="interactWithFrame(step.id)"
            @pointerdown.stop
          >
            <icon-lucide-mouse-pointer-click class="size-4" />
          </button>
        </Tip>
      </header>
      <template v-if="selectedDentalFlowFrameId === step.id">
        <span
          class="pointer-events-none absolute -top-1 -left-1 size-2 rounded-full border border-violet-500 bg-white"
        />
        <span
          class="pointer-events-none absolute -top-1 -right-1 size-2 rounded-full border border-violet-500 bg-white"
        />
        <span
          class="pointer-events-none absolute -bottom-1 -left-1 size-2 rounded-full border border-violet-500 bg-white"
        />
        <span
          class="pointer-events-none absolute -right-1 -bottom-1 size-2 rounded-full border border-violet-500 bg-white"
        />
      </template>
      <iframe
        v-if="liveStepIds.has(step.id)"
        :src="stepSrc(step.id)"
        class="size-full rounded-lg border-0 bg-white"
        :title="`Dental Chart flow — ${step.label}`"
      />
      <div
        v-else
        class="flex size-full items-center justify-center rounded-lg bg-white text-center text-slate-500"
      >
        <div>
          <icon-lucide-pause class="mx-auto mb-2 size-6" />
          <p class="text-xs font-medium">Runtime paused</p>
          <p class="mt-1 text-[10px]">Select this frame to wake it</p>
        </div>
      </div>
    </article>
  </div>
</template>
