<script setup lang="ts">
import { computed, ref } from 'vue'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  captureNarratedTraceDisplayEvidence,
  type NarratedTraceEvidenceAnnotation,
  type NarratedTracePoint,
  type NarratedTraceTarget
} from '@/app/narrated-trace'
import {
  closeContextComment,
  contextCommentBoardCapture,
  contextCommentCropContainsLiveIframe,
  contextCommentState,
  contextCommentSourceCropBounds,
  prepareContextCommentScreenCapture,
  setContextCommentCapture,
  stopContextCommentCapture
} from '@/app/context-comment'
import { useEditorStore } from '@/app/editor/active-store'

type CropDrag = {
  pointerId: number
  start: NarratedTracePoint
  current: NarratedTracePoint
}

const root = ref<HTMLElement | null>(null)
const store = useEditorStore()
const drag = ref<CropDrag | null>(null)
const capturing = ref(false)

const crop = computed<Rect | null>(() => {
  const value = drag.value
  if (!value) return null
  const x = Math.min(value.start.x, value.current.x)
  const y = Math.min(value.start.y, value.current.y)
  return {
    height: Math.abs(value.current.y - value.start.y),
    width: Math.abs(value.current.x - value.start.x),
    x,
    y
  }
})

const cropStyle = computed(() => {
  const value = crop.value
  return value
    ? {
        height: `${value.height}px`,
        left: `${value.x}px`,
        top: `${value.y}px`,
        width: `${value.width}px`
      }
    : {}
})

function point(event: PointerEvent): NarratedTracePoint {
  const bounds = root.value?.getBoundingClientRect()
  return { x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) }
}

function begin(event: PointerEvent) {
  if (
    event.button !== 0 ||
    capturing.value ||
    contextCommentState.capturePreparing ||
    !contextCommentState.draft?.captureSource
  ) {
    return
  }
  contextCommentState.error = null
  const start = point(event)
  drag.value = { current: start, pointerId: event.pointerId, start }
}

function move(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId) return
  drag.value = { ...drag.value, current: point(event) }
}

function captureTarget(): NarratedTraceTarget | undefined {
  const target = contextCommentState.draft?.target
  const stableId = target?.stableIds[0]
  if (!target || !stableId) return undefined
  return {
    bounds: target.bounds,
    ...(target.frameId ? { frameId: target.frameId } : {}),
    name: target.label,
    path: target.path,
    ...(target.route ? { route: target.route } : {}),
    stableId
  }
}

async function finish(event: PointerEvent) {
  if (drag.value?.pointerId !== event.pointerId) return
  const region = crop.value
  const area = root.value?.parentElement
  const draft = contextCommentState.draft
  drag.value = null
  const source = draft?.captureSource
  if (!region || region.width < 12 || region.height < 12 || !area || !draft || !source) return
  capturing.value = true
  try {
    if (contextCommentCropContainsLiveIframe(region)) {
      throw new Error(
        'Live embedded app pixels cannot be included without system screen capture. Select Board content outside the embedded app.'
      )
    }
    const annotation: NarratedTraceEvidenceAnnotation = {
      bounds: region,
      color: '#3b82f6',
      kind: 'focus',
      points: [],
      strokeWidth: 2
    }
    const evidence = await captureNarratedTraceDisplayEvidence({
      annotation,
      capturedAtMs: performance.now(),
      cropBounds: region,
      imageUrl: source.imageUrl,
      maxEdge: 1_600,
      sessionId: draft.id,
      source: source.source,
      sourceCropBounds: contextCommentSourceCropBounds(source, region),
      target: captureTarget()
    })
    if (!evidence) throw new Error('The selected region could not be captured.')
    setContextCommentCapture(evidence, contextCommentBoardCapture(source, region))
    stopContextCommentCapture()
  } catch (error) {
    contextCommentState.error =
      error instanceof Error ? error.message : 'Screenshot capture failed.'
  } finally {
    capturing.value = false
  }
}

function retryCapture() {
  void prepareContextCommentScreenCapture(store)
}

function cancelCapture() {
  closeContextComment()
}
</script>

<template>
  <div
    v-if="contextCommentState.captureMode"
    ref="root"
    data-test-id="context-comment-crop-overlay"
    data-narrated-trace-overlay="true"
    class="absolute inset-0 z-[70] touch-none bg-black/15"
    :class="
      contextCommentState.capturePreparing || !contextCommentState.draft?.captureSource
        ? 'cursor-default'
        : 'cursor-crosshair'
    "
    @pointercancel="drag = null"
    @pointerdown.stop.prevent="begin"
    @pointermove.stop.prevent="move"
    @pointerup.stop.prevent="finish"
  >
    <div
      v-if="contextCommentState.capturePreparing || !contextCommentState.draft?.captureSource"
      class="border-chrome-border bg-chrome-raised absolute top-1/2 left-1/2 flex w-[min(420px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 rounded-2xl border p-5 text-center text-surface shadow-2xl"
      @pointerdown.stop
    >
      <icon-lucide-monitor-up class="size-7 text-blue-400" />
      <div>
        <p class="text-[14px] font-medium">
          {{
            contextCommentState.capturePreparing
              ? 'Preparing Board capture'
              : 'Board capture unavailable'
          }}
        </p>
        <p class="mt-1 text-[12px] leading-5 text-muted">
          {{
            contextCommentState.capturePreparing
              ? 'OpenPencil is composing the visible Board directly. No screen sharing is needed.'
              : contextCommentState.error
          }}
        </p>
      </div>
      <div v-if="!contextCommentState.capturePreparing" class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg bg-blue-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-blue-400"
          @click="retryCapture"
        >
          Try again
        </button>
        <button
          type="button"
          class="rounded-lg px-3 py-1.5 text-[12px] font-medium text-muted hover:bg-hover hover:text-surface"
          @click="cancelCapture"
        >
          Cancel
        </button>
      </div>
    </div>
    <div
      v-else
      class="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg backdrop-blur"
    >
      {{
        capturing
          ? 'Capturing…'
          : contextCommentState.error || 'Drag over the region to attach · Esc to cancel'
      }}
    </div>
    <div
      v-if="crop"
      data-test-id="context-comment-crop-region"
      class="pointer-events-none absolute border-2 border-blue-500 bg-blue-500/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]"
      :style="cropStyle"
    />
  </div>
</template>
