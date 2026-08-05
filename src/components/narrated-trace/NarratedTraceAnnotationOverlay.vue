<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onUnmounted, ref } from 'vue'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  appendNarratedTraceEvent,
  attachNarratedTraceEvidence,
  beginNarratedTraceSession,
  captureNarratedTraceEvidence,
  createNarratedTraceCanvasInk,
  finishNarratedTraceSession,
  markNarratedTraceEvidenceFailed,
  narratedTraceAnchorForScreenPoints,
  narratedTraceAnnotationTool,
  narratedTraceCanvasInkProjections,
  narratedTraceElapsedMs,
  narratedTracePointsPath,
  readNarratedTraceRuntimeTabIdentity,
  narratedTraceScopeForStore,
  narratedTraceSmoothPointsPath,
  narratedTraceSession,
  narratedTraceStatus,
  resolveNarratedTraceSceneTargets,
  setNarratedTraceAnnotationTool
} from '@/app/narrated-trace'
import { useEditorStore } from '@/app/editor/active-store'
import type {
  NarratedTraceInk,
  NarratedTraceFocusTrailPoint,
  NarratedTracePoint,
  NarratedTraceTarget
} from '@/app/narrated-trace'

type FocusDraft = {
  pointerId: number
  points: NarratedTraceFocusTrailPoint[]
}

type FocusTrail = {
  id: string
  points: NarratedTraceFocusTrailPoint[]
}

type VisibleFocusTrail = FocusTrail & {
  marker: NarratedTraceFocusTrailPoint | null
  opacity: number
  path: string
}

const INK_COLOR = '#f43f5e'
const INK_WIDTH = 4
const FOCUS_COLOR = '#8b5cf6'
const FOCUS_TRAIL_LIFETIME_MS = 520
const FOCUS_WIDTH = 3
const FOCUS_AURA_WIDTH = 9
const FOCUS_AURA_OPACITY = 0.2

const root = ref<HTMLElement | null>(null)
const store = useEditorStore()
const currentStroke = ref<NarratedTraceInk | null>(null)
const currentFocus = ref<FocusDraft | null>(null)
const focusTrails = ref<FocusTrail[]>([])
const focusClock = ref(0)
let focusAnimationFrame = 0

const canAnnotate = computed(() => narratedTraceAnnotationTool.value !== 'none')
const canvasInkProjections = computed(() => narratedTraceCanvasInkProjections(store))
const canSelectCanvasInk = computed(
  () => narratedTraceAnnotationTool.value === 'none' && store.state.activeTool === 'SELECT'
)

function pointForEvent(event: PointerEvent): NarratedTracePoint {
  const bounds = root.value?.getBoundingClientRect()
  return {
    pressure: event.pressure || undefined,
    x: event.clientX - (bounds?.left ?? 0),
    y: event.clientY - (bounds?.top ?? 0)
  }
}

function distance(first: NarratedTracePoint, second: NarratedTracePoint) {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

const visibleFocusTrails = computed<VisibleFocusTrail[]>(() => {
  const trails = currentFocus.value
    ? [...focusTrails.value, { id: 'current', points: currentFocus.value.points }]
    : focusTrails.value
  return trails.flatMap((trail) => {
    const marker = trail.points.length === 1 ? (trail.points[0] ?? null) : null
    const path = marker ? '' : narratedTraceSmoothPointsPath(trail.points)
    if (!marker && !path) return []
    const lastAtMs = trail.points.at(-1)?.atMs ?? 0
    const opacity =
      trail.id === 'current'
        ? 1
        : Math.max(0, Math.min(1, 1 - (focusClock.value - lastAtMs) / FOCUS_TRAIL_LIFETIME_MS))
    return opacity > 0 ? [{ ...trail, marker, opacity, path }] : []
  })
})

function focusAuraOpacity(opacity: number) {
  return opacity * FOCUS_AURA_OPACITY
}

function scheduleFocusAnimation() {
  if (focusAnimationFrame) return
  const animate = (now: number) => {
    focusClock.value = now
    focusTrails.value = focusTrails.value.filter(
      (trail) => (trail.points.at(-1)?.atMs ?? 0) + FOCUS_TRAIL_LIFETIME_MS > now
    )
    if (currentFocus.value || focusTrails.value.length > 0) {
      focusAnimationFrame = requestAnimationFrame(animate)
    } else {
      focusAnimationFrame = 0
    }
  }
  focusAnimationFrame = requestAnimationFrame(animate)
}

function boundsForPoints(points: NarratedTracePoint[], padding = 0) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs) - padding
  const minY = Math.min(...ys) - padding
  return {
    height: Math.max(1, Math.max(...ys) - Math.min(...ys) + padding * 2),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs) + padding * 2),
    x: minX,
    y: minY
  }
}

function paddedCaptureBounds(bounds: Rect, padding: number, area: HTMLElement) {
  const areaBounds = area.getBoundingClientRect()
  const x = Math.max(0, bounds.x - padding)
  const y = Math.max(0, bounds.y - padding)
  return {
    height: Math.max(1, Math.min(areaBounds.height, bounds.y + bounds.height + padding) - y),
    width: Math.max(1, Math.min(areaBounds.width, bounds.x + bounds.width + padding) - x),
    x,
    y
  }
}

function targetForRegion(region: Rect) {
  const resolution = resolveNarratedTraceSceneTargets(store, region)
  const target: NarratedTraceTarget = resolution.target ?? {
    bounds: region,
    name: 'Canvas area',
    path: ['Canvas', 'Intent annotation'],
    stableId: `canvas:${Math.round(region.x)}:${Math.round(region.y)}`
  }
  return { ...resolution, target }
}

function onPointerDown(event: PointerEvent) {
  if (!canAnnotate.value || event.button !== 0) return
  const point = pointForEvent(event)
  root.value?.setPointerCapture(event.pointerId)
  if (narratedTraceAnnotationTool.value === 'ink') {
    currentStroke.value = {
      bounds: { height: 1, width: 1, x: point.x, y: point.y },
      color: INK_COLOR,
      points: [point],
      strokeWidth: INK_WIDTH
    }
    return
  }
  const atMs = performance.now()
  focusClock.value = atMs
  currentFocus.value = { pointerId: event.pointerId, points: [{ ...point, atMs }] }
  scheduleFocusAnimation()
}

function onPointerMove(event: PointerEvent) {
  const point = pointForEvent(event)
  if (currentStroke.value) {
    const previous = currentStroke.value.points.at(-1)
    if (previous && distance(previous, point) < 2) return
    const points = [...currentStroke.value.points, point]
    currentStroke.value = {
      ...currentStroke.value,
      bounds: boundsForPoints(points, INK_WIDTH / 2),
      points
    }
    return
  }
  if (!currentFocus.value || currentFocus.value.pointerId !== event.pointerId) return
  const previous = currentFocus.value.points.at(-1)
  if (previous && distance(previous, point) < 4) return
  const atMs = performance.now()
  focusClock.value = atMs
  currentFocus.value = {
    ...currentFocus.value,
    points: [...currentFocus.value.points, { ...point, atMs }].slice(-320)
  }
  scheduleFocusAnimation()
}

function beginGestureTrace() {
  if (narratedTraceStatus.value === 'recording') return false
  if (narratedTraceStatus.value === 'paused') return false
  beginNarratedTraceSession(narratedTraceScopeForStore(store))
  return true
}

async function finishStroke() {
  const stroke = currentStroke.value
  const area = root.value?.parentElement
  currentStroke.value = null
  if (!stroke || stroke.points.length < 2 || !area) return
  const canvasInk = createNarratedTraceCanvasInk(store, stroke)
  if (!canvasInk) return
  const ownsGestureTrace = beginGestureTrace()
  const atMs = narratedTraceElapsedMs.value
  const cropBounds = paddedCaptureBounds(stroke.bounds, 20, area)
  const target = canvasInk.target
  const anchor = narratedTraceAnchorForScreenPoints(store, stroke.points)
  const resolution = resolveNarratedTraceSceneTargets(store, cropBounds)
  const runtimeIdentity = readNarratedTraceRuntimeTabIdentity(store)
  const eventId = appendNarratedTraceEvent({
    anchor,
    atMs,
    evidenceStatus: 'pending',
    gesture: {
      candidateCount: resolution.candidateCount,
      candidates: resolution.candidates,
      candidatesTruncated: resolution.candidatesTruncated,
      ...(runtimeIdentity ? { documentTabId: runtimeIdentity.documentTabId } : {}),
      kind: 'ink',
      pagePoints: stroke.points.map((point) => store.screenToCanvas(point.x, point.y)),
      ...(resolution.target ? { primaryTargetId: resolution.target.stableId } : {}),
      ...(runtimeIdentity ? { runtimeInstanceId: runtimeIdentity.runtimeInstanceId } : {}),
      screenBounds: structuredClone(stroke.bounds),
      screenPoints: structuredClone(stroke.points)
    },
    ink: stroke,
    kind: 'ink',
    label: 'Drew an editable intent stroke',
    target
  })
  const sessionId = narratedTraceSession.value?.id
  try {
    if (!eventId || !sessionId) return
    const evidence = await captureNarratedTraceEvidence({
      annotation: { ...stroke, kind: 'ink' },
      area,
      capturedAtMs: atMs,
      cropBounds,
      sessionId,
      target
    })
    if (evidence) attachNarratedTraceEvidence(eventId, evidence)
    else markNarratedTraceEvidenceFailed(eventId)
  } finally {
    if (ownsGestureTrace) finishNarratedTraceSession()
  }
}

async function finishFocus() {
  const focus = currentFocus.value
  const area = root.value?.parentElement
  currentFocus.value = null
  if (!focus || !area) {
    setNarratedTraceAnnotationTool('none')
    return
  }
  const points = focus.points.map(({ pressure, x, y }) => ({ pressure, x, y }))
  const bounds = boundsForPoints(points, FOCUS_AURA_WIDTH / 2)
  const region = paddedCaptureBounds(bounds, 24, area)
  const resolution = targetForRegion(region)
  const target = resolution.target
  const anchor = narratedTraceAnchorForScreenPoints(
    store,
    points,
    target.stableId.startsWith('canvas:') ? undefined : target.bounds
  )
  const cropBounds = region
  const ownsGestureTrace = beginGestureTrace()
  const atMs = narratedTraceElapsedMs.value
  const runtimeIdentity = readNarratedTraceRuntimeTabIdentity(store)
  const eventId = appendNarratedTraceEvent(
    {
      anchor,
      atMs,
      evidenceStatus: 'pending',
      gesture: {
        candidateCount: resolution.candidateCount,
        candidates: resolution.candidates,
        candidatesTruncated: resolution.candidatesTruncated,
        ...(runtimeIdentity ? { documentTabId: runtimeIdentity.documentTabId } : {}),
        kind: 'focus',
        pagePoints: points.map((point) => store.screenToCanvas(point.x, point.y)),
        ...(resolution.target.stableId.startsWith('canvas:')
          ? {}
          : { primaryTargetId: resolution.target.stableId }),
        ...(runtimeIdentity ? { runtimeInstanceId: runtimeIdentity.runtimeInstanceId } : {}),
        screenBounds: bounds,
        screenPoints: points
      },
      kind: 'screenshot',
      label: `Highlighted ${target.name}`,
      target
    },
    { coalesceKey: `focus:${target.stableId}`, coalesceWindowMs: 1200 }
  )
  const sessionId = narratedTraceSession.value?.id

  const evidencePromise =
    eventId && sessionId
      ? captureNarratedTraceEvidence({
          annotation: {
            bounds,
            color: FOCUS_COLOR,
            kind: 'focus',
            points,
            strokeWidth: FOCUS_WIDTH
          },
          area,
          capturedAtMs: atMs,
          cropBounds,
          sessionId,
          target
        })
      : null

  focusTrails.value = [
    ...focusTrails.value,
    { id: `focus-${Math.round(focus.points[0]?.atMs ?? focusClock.value)}`, points: focus.points }
  ]
  scheduleFocusAnimation()

  try {
    if (!eventId || !evidencePromise) return
    const evidence = await evidencePromise
    if (evidence) attachNarratedTraceEvidence(eventId, evidence)
    else markNarratedTraceEvidenceFailed(eventId)
  } finally {
    if (ownsGestureTrace) finishNarratedTraceSession()
  }
}

function onPointerUp(event: PointerEvent) {
  if (root.value?.hasPointerCapture(event.pointerId))
    root.value.releasePointerCapture(event.pointerId)
  if (currentStroke.value) void finishStroke()
  else if (currentFocus.value?.pointerId === event.pointerId) void finishFocus()
}

function cancelCurrentGesture() {
  currentStroke.value = null
  currentFocus.value = null
}

function selectCanvasInk(nodeId: string) {
  if (!canSelectCanvasInk.value) return
  store.select([nodeId])
  store.requestRender()
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || narratedTraceAnnotationTool.value === 'none') return
  event.preventDefault()
  cancelCurrentGesture()
  setNarratedTraceAnnotationTool('none')
})

onUnmounted(() => {
  if (focusAnimationFrame) cancelAnimationFrame(focusAnimationFrame)
})
</script>

<template>
  <div
    ref="root"
    data-test-id="narrated-trace-annotation-overlay"
    data-narrated-trace-overlay="true"
    data-html2canvas-ignore="true"
    class="absolute inset-0 z-40 touch-none"
    :class="canAnnotate ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'"
    :data-tool="narratedTraceAnnotationTool"
    @pointercancel="cancelCurrentGesture"
    @pointerdown.stop.prevent="onPointerDown"
    @pointermove.stop.prevent="onPointerMove"
    @pointerup.stop.prevent="onPointerUp"
  >
    <svg class="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
      <defs>
        <filter id="narrated-trace-focus-aura" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
      </defs>
      <path
        v-for="projection in canvasInkProjections"
        :key="projection.id"
        :data-canvas-ink-id="projection.id"
        :d="projection.path"
        fill="none"
        :stroke="projection.color"
        :stroke-opacity="projection.opacity"
        :stroke-width="projection.strokeWidth"
        stroke-linecap="round"
        stroke-linejoin="round"
        :class="
          canSelectCanvasInk && !projection.selected
            ? 'pointer-events-auto cursor-pointer'
            : 'pointer-events-none'
        "
        @pointerdown.stop.prevent="selectCanvasInk(projection.id)"
      />
      <path
        v-if="currentStroke"
        :d="narratedTracePointsPath(currentStroke.points)"
        fill="none"
        :stroke="currentStroke.color"
        :stroke-width="currentStroke.strokeWidth"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <template v-for="trail in visibleFocusTrails" :key="trail.id">
        <circle
          v-if="trail.marker"
          data-test-id="narrated-trace-focus-aura"
          :cx="trail.marker.x"
          :cy="trail.marker.y"
          r="11"
          fill="none"
          :stroke="FOCUS_COLOR"
          :stroke-opacity="focusAuraOpacity(trail.opacity)"
          :stroke-width="FOCUS_AURA_WIDTH"
          filter="url(#narrated-trace-focus-aura)"
        />
        <path
          v-else
          data-test-id="narrated-trace-focus-aura"
          :d="trail.path"
          fill="none"
          :stroke="FOCUS_COLOR"
          :stroke-opacity="focusAuraOpacity(trail.opacity)"
          :stroke-width="FOCUS_AURA_WIDTH"
          stroke-linecap="round"
          stroke-linejoin="round"
          filter="url(#narrated-trace-focus-aura)"
        />
        <circle
          v-if="trail.marker"
          data-test-id="narrated-trace-focus-core"
          :cx="trail.marker.x"
          :cy="trail.marker.y"
          r="7"
          fill="none"
          :stroke="FOCUS_COLOR"
          :stroke-opacity="trail.opacity"
          :stroke-width="FOCUS_WIDTH"
        />
        <path
          v-else
          data-test-id="narrated-trace-focus-core"
          :d="trail.path"
          fill="none"
          :stroke="FOCUS_COLOR"
          :stroke-opacity="trail.opacity"
          :stroke-width="FOCUS_WIDTH"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </template>
    </svg>
  </div>
</template>
