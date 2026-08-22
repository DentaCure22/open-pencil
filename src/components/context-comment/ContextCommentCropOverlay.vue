<script setup lang="ts">
import { computed, ref } from 'vue'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  captureNarratedTraceEvidence,
  type NarratedTraceEvidenceAnnotation,
  type NarratedTracePoint,
  type NarratedTraceTarget
} from '@/app/narrated-trace'
import {
  contextCommentState,
  setContextCommentCapture,
  stopContextCommentCapture
} from '@/app/context-comment'

type CropDrag = {
  pointerId: number
  start: NarratedTracePoint
  current: NarratedTracePoint
}

const root = ref<HTMLElement | null>(null)
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
  if (event.button !== 0 || capturing.value) return
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
  if (!region || region.width < 12 || region.height < 12 || !area || !draft) return
  capturing.value = true
  try {
    const annotation: NarratedTraceEvidenceAnnotation = {
      bounds: region,
      color: '#8b5cf6',
      kind: 'focus',
      points: [
        { x: region.x, y: region.y },
        { x: region.x + region.width, y: region.y },
        { x: region.x + region.width, y: region.y + region.height },
        { x: region.x, y: region.y + region.height },
        { x: region.x, y: region.y }
      ],
      strokeWidth: 2
    }
    const evidence = await captureNarratedTraceEvidence({
      annotation,
      area,
      capturedAtMs: performance.now(),
      cropBounds: region,
      sessionId: draft.id,
      target: captureTarget()
    })
    if (!evidence) throw new Error('The selected region could not be captured.')
    setContextCommentCapture(evidence)
    stopContextCommentCapture()
  } catch (error) {
    contextCommentState.error =
      error instanceof Error ? error.message : 'Screenshot capture failed.'
    stopContextCommentCapture()
  } finally {
    capturing.value = false
  }
}
</script>

<template>
  <div
    v-if="contextCommentState.captureMode"
    ref="root"
    data-test-id="context-comment-crop-overlay"
    class="absolute inset-0 z-[70] cursor-crosshair touch-none bg-black/15"
    @pointercancel="drag = null"
    @pointerdown.stop.prevent="begin"
    @pointermove.stop.prevent="move"
    @pointerup.stop.prevent="finish"
  >
    <div
      class="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg backdrop-blur"
    >
      {{ capturing ? 'Capturing…' : 'Drag over the region to attach · Esc to cancel' }}
    </div>
    <div
      v-if="crop"
      data-test-id="context-comment-crop-region"
      class="pointer-events-none absolute border-2 border-violet-500 bg-violet-500/10 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]"
      :style="cropStyle"
    />
  </div>
</template>
