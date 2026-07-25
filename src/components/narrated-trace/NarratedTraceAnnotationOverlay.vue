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
  findNarratedTraceLiveTarget,
  findNarratedTraceSceneTarget,
  finishNarratedTraceSession,
  markNarratedTraceEvidenceFailed,
  narratedTraceAnchorForScreenPoints,
  narratedTraceAnnotationTool,
  narratedTraceCanvasInkProjections,
  narratedTraceElapsedMs,
  narratedTracePointsPath,
  narratedTraceScopeForStore,
  narratedTraceSmoothPointsPath,
  narratedTraceSession,
  narratedTraceStatus,
  setNarratedTraceAnnotationTool
} from '@/app/narrated-trace'
import { useEditorStore } from '@/app/editor/active-store'
import type {
  NarratedTraceInk,
  NarratedTraceFocusTrailPoint,
  NarratedTracePoint,
  NarratedTraceTarget
} from '@/app/narrated-trace'
import {
  findLiveInspectorNode,
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorRoute,
  liveInspectorSelectedId,
  liveInspectorSelectedRect
} from '@/app/smylr-live-inspector/session'

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

function intersects(first: Rect, second: Rect) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  )
}

function intersectionArea(first: Rect, second: Rect) {
  const width = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  )
  const height = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  )
  return width * height
}

function containsCenter(bounds: Rect, region: Rect) {
  const centerX = region.x + region.width / 2
  const centerY = region.y + region.height / 2
  return (
    centerX >= bounds.x &&
    centerX <= bounds.x + bounds.width &&
    centerY >= bounds.y &&
    centerY <= bounds.y + bounds.height
  )
}

type LiveFrameElementHit = {
  bounds: Rect
  element: HTMLElement
  frameId: string
}

function liveFrameElementForRegion(region: Rect, area: HTMLElement): LiveFrameElementHit | null {
  const areaBounds = area.getBoundingClientRect()
  const hits = [...area.querySelectorAll<HTMLElement>('[data-live-frame-id]')]
    .flatMap((element) => {
      const frameId = element.dataset.liveFrameId
      const rect = element.getBoundingClientRect()
      if (!frameId || rect.width <= 0 || rect.height <= 0) return []
      const bounds = {
        height: rect.height,
        width: rect.width,
        x: rect.left - areaBounds.left,
        y: rect.top - areaBounds.top
      }
      const overlap = intersectionArea(bounds, region)
      return overlap > 0 ? [{ bounds, element, frameId, overlap }] : []
    })
    .sort((first, second) => {
      const firstContainsCenter = containsCenter(first.bounds, region)
      const secondContainsCenter = containsCenter(second.bounds, region)
      if (firstContainsCenter !== secondContainsCenter) return firstContainsCenter ? -1 : 1
      if (first.overlap !== second.overlap) return second.overlap - first.overlap
      return first.bounds.width * first.bounds.height - second.bounds.width * second.bounds.height
    })
  return hits[0] ?? null
}

function sceneNodePath(nodeId: string) {
  const path: string[] = []
  let node = store.graph.getNode(nodeId)
  let depth = 0
  while (node && depth < 32) {
    path.unshift(node.name || node.type)
    node = node.parentId ? store.graph.getNode(node.parentId) : undefined
    depth += 1
  }
  return path
}

function routeForFrame(frameId: string, element: HTMLElement) {
  const frame = store.graph.getNode(frameId)
  return (
    element.dataset.liveFrameRoute ??
    frame?.pluginData.find((entry) => entry.key === 'route')?.value
  )
}

function selectedTargetBounds(area: HTMLElement) {
  const selected = liveInspectorSelectedRect.value
  if (!selected) return null
  const frameId = liveInspectorActiveFrameId.value
  const iframe =
    (frameId
      ? area.querySelector<HTMLIFrameElement>(`iframe[data-live-frame-id="${CSS.escape(frameId)}"]`)
      : null) ?? area.querySelector<HTMLIFrameElement>('iframe')
  if (!iframe) return null
  const areaBounds = area.getBoundingClientRect()
  const frameBounds = iframe.getBoundingClientRect()
  const scaleX = frameBounds.width / Math.max(iframe.clientWidth, 1)
  const scaleY = frameBounds.height / Math.max(iframe.clientHeight, 1)
  return {
    height: selected.height * scaleY,
    width: selected.width * scaleX,
    x: frameBounds.left - areaBounds.left + selected.x * scaleX,
    y: frameBounds.top - areaBounds.top + selected.y * scaleY
  }
}

function liveTargetForRegion(region: Rect, area: HTMLElement): NarratedTraceTarget | null {
  const frameHit = liveFrameElementForRegion(region, area)
  if (!frameHit) return null
  const { bounds: frameRegion, element, frameId } = frameHit
  const frameNode = store.graph.getNode(frameId)
  const document = liveInspectorDocument.value
  const ownsLiveDocument = document && liveInspectorActiveFrameId.value === frameId
  if (!ownsLiveDocument) {
    return {
      bounds: frameRegion,
      frameId,
      name: frameNode?.name || element.dataset.liveFrameRoute || 'App screen',
      path: sceneNodePath(frameId),
      route: routeForFrame(frameId, element),
      stableId: frameId
    }
  }

  const scaleX = frameRegion.width / Math.max(element.clientWidth, 1)
  const scaleY = frameRegion.height / Math.max(element.clientHeight, 1)
  const frameLocalRegion = {
    height: region.height / Math.max(scaleY, 0.01),
    width: region.width / Math.max(scaleX, 0.01),
    x: (region.x - frameRegion.x) / Math.max(scaleX, 0.01),
    y: (region.y - frameRegion.y) / Math.max(scaleY, 0.01)
  }
  const hit = findNarratedTraceLiveTarget(document.tree, frameLocalRegion)
  if (!hit) {
    return {
      bounds: frameRegion,
      frameId,
      name: frameNode?.name || document.title || 'Live app',
      path: [document.title || 'Live app'],
      route: liveInspectorRoute.value ?? document.route,
      stableId: frameId
    }
  }

  return {
    bounds: {
      height: hit.rect.height * scaleY,
      width: hit.rect.width * scaleX,
      x: frameRegion.x + hit.rect.x * scaleX,
      y: frameRegion.y + hit.rect.y * scaleY
    },
    frameId,
    name: hit.node.label,
    path: hit.path,
    route: liveInspectorRoute.value ?? document.route,
    stableId: hit.node.id
  }
}

function targetForRegion(region: Rect, area: HTMLElement): NarratedTraceTarget {
  const document = liveInspectorDocument.value
  const selectedId = liveInspectorSelectedId.value
  const node = selectedId ? findLiveInspectorNode(document?.tree, selectedId) : null
  const selectedBounds = selectedTargetBounds(area)
  const hitsSelected = Boolean(selectedBounds && intersects(region, selectedBounds))
  if (document && selectedId && node && selectedBounds && hitsSelected) {
    return {
      bounds: selectedBounds,
      frameId: liveInspectorActiveFrameId.value ?? undefined,
      name: node.label,
      path: [document.title, node.label],
      route: liveInspectorRoute.value ?? document.route,
      stableId: node.id
    }
  }
  const liveTarget = liveTargetForRegion(region, area)
  if (liveTarget) return liveTarget
  const sceneTarget = findNarratedTraceSceneTarget(store, region)
  if (sceneTarget) return sceneTarget
  return {
    bounds: region,
    name: 'Canvas area',
    path: ['Canvas', 'Intent annotation'],
    stableId: `canvas:${Math.round(region.x)}:${Math.round(region.y)}`
  }
}

function evidenceBoundsForTarget(
  target: NarratedTraceTarget,
  fallbackRegion: Rect,
  area: HTMLElement
) {
  if (!target.bounds || target.stableId.startsWith('canvas:')) return fallbackRegion
  const left = Math.min(target.bounds.x, fallbackRegion.x)
  const top = Math.min(target.bounds.y, fallbackRegion.y)
  const right = Math.max(
    target.bounds.x + target.bounds.width,
    fallbackRegion.x + fallbackRegion.width
  )
  const bottom = Math.max(
    target.bounds.y + target.bounds.height,
    fallbackRegion.y + fallbackRegion.height
  )
  return paddedCaptureBounds(
    { height: bottom - top, width: right - left, x: left, y: top },
    36,
    area
  )
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
  const eventId = appendNarratedTraceEvent({
    anchor,
    atMs,
    evidenceStatus: 'pending',
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
  const target = targetForRegion(region, area)
  const anchor = narratedTraceAnchorForScreenPoints(
    store,
    points,
    target.stableId.startsWith('canvas:') ? undefined : target.bounds
  )
  const cropBounds = evidenceBoundsForTarget(target, region, area)
  const ownsGestureTrace = beginGestureTrace()
  const atMs = narratedTraceElapsedMs.value
  const eventId = appendNarratedTraceEvent(
    {
      anchor,
      atMs,
      evidenceStatus: 'pending',
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
