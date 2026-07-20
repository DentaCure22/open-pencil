<script setup lang="ts">
import { useEditorStore } from '@/app/editor/active-store'
import { fadeOutGlobalLoader } from '@/app/editor/canvas/loader-overlay'
import {
  liveInspectorInteractionMode,
  liveInspectorSelectedId,
  liveInspectorSelectionEpoch
} from '@/app/smylr-live-inspector/session'
import { findCurrentSmylrLiveAppFrame } from '@/app/smylr-production/workspace'
import { liveFrameCornerStyle } from '@/app/smylr-production/frame-corners'
import type { SceneNode } from '@open-pencil/scene-graph'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import SmylrLiveAppEmbed from './canvas/SmylrLiveAppEmbed.vue'
import SmylrLiveWorkspaceCanvas from './SmylrLiveWorkspaceCanvas.vue'

type ResizeHandle = 'ne' | 'se' | 'sw' | 'nw'

type FrameSnapshot = Pick<SceneNode, 'x' | 'y' | 'width' | 'height'>

type DragState =
  | {
      kind: 'pan'
      pointerId: number
      startClientX: number
      startClientY: number
    }
  | {
      kind: 'move'
      pointerId: number
      startCanvasX: number
      startCanvasY: number
      startNode: FrameSnapshot
    }
  | {
      handle: ResizeHandle
      kind: 'resize'
      pointerId: number
      startCanvasX: number
      startCanvasY: number
      startNode: FrameSnapshot
    }
  | {
      centerX: number
      centerY: number
      kind: 'rotate'
      pointerId: number
      startAngle: number
      startRotation: number
    }

const MIN_FRAME_HEIGHT = 320
const MIN_FRAME_WIDTH = 320

const RESIZE_HANDLES: Array<{
  className: string
  handle: ResizeHandle
  label: string
}> = [
  {
    className: 'left-0 top-0 cursor-nwse-resize',
    handle: 'nw',
    label: 'Resize top left'
  },
  {
    className: 'right-0 top-0 cursor-nesw-resize',
    handle: 'ne',
    label: 'Resize top right'
  },
  {
    className: 'right-0 bottom-0 cursor-nwse-resize',
    handle: 'se',
    label: 'Resize bottom right'
  },
  {
    className: 'bottom-0 left-0 cursor-nesw-resize',
    handle: 'sw',
    label: 'Resize bottom left'
  }
]

const ROTATE_HANDLES = [
  { className: '-left-7 -top-7', corner: 'nw', label: 'Rotate from top left' },
  { className: '-right-7 -top-7', corner: 'ne', label: 'Rotate from top right' },
  { className: '-right-7 -bottom-7', corner: 'se', label: 'Rotate from bottom right' },
  { className: '-left-7 -bottom-7', corner: 'sw', label: 'Rotate from bottom left' }
] as const

const store = useEditorStore()
const rootRef = ref<HTMLElement | null>(null)
const syncTick = ref(0)
const dragState = ref<DragState | null>(null)
let unsubscribe: Array<() => void> = []

function bumpOverlaySync() {
  syncTick.value += 1
}

onMounted(() => {
  unsubscribe = [
    store.onEditorEvent('graph:replaced', bumpOverlaySync),
    store.onEditorEvent('page:changed', bumpOverlaySync),
    store.onEditorEvent('node:updated', bumpOverlaySync),
    store.onEditorEvent('render:requested', bumpOverlaySync),
    store.onEditorEvent('repaint:requested', bumpOverlaySync),
    store.onEditorEvent('selection:changed', bumpOverlaySync)
  ]
  requestAnimationFrame(() => fadeOutGlobalLoader())
})

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
})

const liveFrame = computed(() => {
  void syncTick.value
  return findCurrentSmylrLiveAppFrame(store)
})

const isFrameMode = computed(() => liveInspectorInteractionMode.value === 'frame')

const isFrameSelected = computed(() => {
  const frame = liveFrame.value
  return Boolean(frame && store.state.selectedIds.has(frame.id))
})

const frameOverlayStyle = computed(() => {
  void syncTick.value
  const frame = liveFrame.value
  if (!frame) return {}

  const abs = store.graph.getAbsolutePosition(frame.id)
  const zoom = store.state.zoom
  return {
    ...liveFrameCornerStyle(frame),
    height: `${Math.max(1, frame.height)}px`,
    transform: `translate3d(${abs.x * zoom + store.state.panX}px, ${
      abs.y * zoom + store.state.panY
    }px, 0) scale(${zoom})`,
    transformOrigin: 'top left',
    width: `${Math.max(1, frame.width)}px`
  }
})

function focusCanvas() {
  rootRef.value?.focus({ preventScroll: true })
}

function localPoint(event: PointerEvent | WheelEvent) {
  const rect = rootRef.value?.getBoundingClientRect()
  return {
    x: event.clientX - (rect?.left ?? 0),
    y: event.clientY - (rect?.top ?? 0)
  }
}

function canvasPoint(event: PointerEvent) {
  const point = localPoint(event)
  return {
    x: (point.x - store.state.panX) / store.state.zoom,
    y: (point.y - store.state.panY) / store.state.zoom
  }
}

function frameSnapshot(frame: SceneNode): FrameSnapshot {
  return {
    height: frame.height,
    width: frame.width,
    x: frame.x,
    y: frame.y
  }
}

function selectLiveFrame() {
  const frame = liveFrame.value
  if (!frame) return null
  if (!store.state.selectedIds.has(frame.id)) store.select([frame.id])
  return frame
}

watch([liveInspectorSelectedId, liveInspectorSelectionEpoch], () => {
  if (!liveInspectorSelectedId.value) return
  // Force-select even when the same live id is re-claimed after a native paste.
  const frame = liveFrame.value
  if (frame) store.select([frame.id])
  requestAnimationFrame(focusCanvas)
})

function beginPan(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 1) return
  focusCanvas()
  dragState.value = {
    kind: 'pan',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY
  }
  rootRef.value?.setPointerCapture(event.pointerId)
}

function beginFrameMove(event: PointerEvent) {
  if (!isFrameMode.value || event.button !== 0) return
  const frame = selectLiveFrame()
  if (!frame) return
  focusCanvas()
  const point = canvasPoint(event)
  dragState.value = {
    kind: 'move',
    pointerId: event.pointerId,
    startCanvasX: point.x,
    startCanvasY: point.y,
    startNode: frameSnapshot(frame)
  }
  rootRef.value?.setPointerCapture(event.pointerId)
}

function beginFrameResize(handle: ResizeHandle, event: PointerEvent) {
  if (!isFrameMode.value || event.button !== 0) return
  const frame = selectLiveFrame()
  if (!frame) return
  focusCanvas()
  const point = canvasPoint(event)
  dragState.value = {
    handle,
    kind: 'resize',
    pointerId: event.pointerId,
    startCanvasX: point.x,
    startCanvasY: point.y,
    startNode: frameSnapshot(frame)
  }
  rootRef.value?.setPointerCapture(event.pointerId)
}

function beginFrameRotate(event: PointerEvent) {
  if (!isFrameMode.value || event.button !== 0) return
  const frame = selectLiveFrame()
  if (!frame) return
  focusCanvas()
  const abs = store.graph.getAbsolutePosition(frame.id)
  const centerX = abs.x + frame.width / 2
  const centerY = abs.y + frame.height / 2
  const point = canvasPoint(event)
  dragState.value = {
    centerX,
    centerY,
    kind: 'rotate',
    pointerId: event.pointerId,
    startAngle: Math.atan2(point.y - centerY, point.x - centerX) * (180 / Math.PI),
    startRotation: frame.rotation
  }
  rootRef.value?.setPointerCapture(event.pointerId)
}

function updateFrame(changes: Partial<SceneNode>) {
  const frame = liveFrame.value
  if (!frame) return
  store.updateNode(frame.id, changes)
  store.requestRender()
  bumpOverlaySync()
}

function moveFrame(event: PointerEvent, drag: Extract<DragState, { kind: 'move' }>) {
  const point = canvasPoint(event)
  updateFrame({
    x: drag.startNode.x + point.x - drag.startCanvasX,
    y: drag.startNode.y + point.y - drag.startCanvasY
  })
}

function resizedFrame(
  drag: Extract<DragState, { kind: 'resize' }>,
  dx: number,
  dy: number
): FrameSnapshot {
  const next = { ...drag.startNode }
  const hasNorth = drag.handle.includes('n')
  const hasSouth = drag.handle.includes('s')
  const hasWest = drag.handle.includes('w')
  const hasEast = drag.handle.includes('e')

  if (hasEast) next.width = Math.max(MIN_FRAME_WIDTH, drag.startNode.width + dx)
  if (hasSouth) next.height = Math.max(MIN_FRAME_HEIGHT, drag.startNode.height + dy)

  if (hasWest) {
    const width = Math.max(MIN_FRAME_WIDTH, drag.startNode.width - dx)
    next.x = drag.startNode.x + (drag.startNode.width - width)
    next.width = width
  }

  if (hasNorth) {
    const height = Math.max(MIN_FRAME_HEIGHT, drag.startNode.height - dy)
    next.y = drag.startNode.y + (drag.startNode.height - height)
    next.height = height
  }

  return next
}

function resizeFrame(event: PointerEvent, drag: Extract<DragState, { kind: 'resize' }>) {
  const point = canvasPoint(event)
  const dx = point.x - drag.startCanvasX
  const dy = point.y - drag.startCanvasY
  updateFrame(resizedFrame(drag, dx, dy))
}

function rotateFrame(event: PointerEvent, drag: Extract<DragState, { kind: 'rotate' }>) {
  const point = canvasPoint(event)
  const angle = Math.atan2(point.y - drag.centerY, point.x - drag.centerX) * (180 / Math.PI)
  updateFrame({ rotation: drag.startRotation + angle - drag.startAngle })
}

function onCanvasPointerDown(event: PointerEvent) {
  if (!isFrameMode.value || event.target !== event.currentTarget) return
  beginPan(event)
}

function onCanvasPointerMove(event: PointerEvent) {
  const drag = dragState.value
  if (!drag || drag.pointerId !== event.pointerId) return

  if (drag.kind === 'pan') {
    store.pan(event.clientX - drag.startClientX, event.clientY - drag.startClientY)
    drag.startClientX = event.clientX
    drag.startClientY = event.clientY
    bumpOverlaySync()
    return
  }

  if (drag.kind === 'move') {
    moveFrame(event, drag)
    return
  }

  if (drag.kind === 'rotate') {
    rotateFrame(event, drag)
    return
  }

  resizeFrame(event, drag)
}

function endDrag(event: PointerEvent) {
  const drag = dragState.value
  if (!drag || drag.pointerId !== event.pointerId) return
  const frame = liveFrame.value

  if (frame && drag.kind !== 'pan') {
    store.commitNodeUpdate(
      frame.id,
      drag.kind === 'rotate' ? { rotation: drag.startRotation } : drag.startNode,
      drag.kind === 'move'
        ? 'Move live app frame'
        : drag.kind === 'rotate'
          ? 'Rotate live app frame'
          : 'Resize live app frame'
    )
  }

  rootRef.value?.releasePointerCapture(event.pointerId)
  dragState.value = null
  store.requestRender()
  bumpOverlaySync()
}

function onWheel(event: WheelEvent) {
  focusCanvas()
  const point = localPoint(event)
  if (event.ctrlKey || event.metaKey || event.altKey) {
    store.applyZoom(event.deltaY, point.x, point.y)
  } else {
    store.pan(-event.deltaX, -event.deltaY)
  }
  bumpOverlaySync()
}

function onKeyDown(event: KeyboardEvent) {
  if (!isFrameMode.value) return
  const frame = liveFrame.value
  if (!frame || !store.state.selectedIds.has(frame.id)) return

  const step = event.shiftKey ? 10 : 1
  const changes: Partial<SceneNode> = {}
  if (event.key === 'ArrowLeft') changes.x = frame.x - step
  else if (event.key === 'ArrowRight') changes.x = frame.x + step
  else if (event.key === 'ArrowUp') changes.y = frame.y - step
  else if (event.key === 'ArrowDown') changes.y = frame.y + step
  else return

  event.preventDefault()
  store.updateNodeWithUndo(frame.id, changes, 'Nudge live app frame')
  store.requestRender()
  bumpOverlaySync()
}
</script>

<template>
  <div
    ref="rootRef"
    data-test-id="smylr-production-canvas"
    class="canvas-area bg-canvas relative isolate min-h-0 min-w-0 flex-1 overflow-hidden outline-none"
    :class="isFrameMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'"
    tabindex="0"
    @contextmenu.prevent
    @keydown="onKeyDown"
    @pointercancel="endDrag"
    @pointerdown="onCanvasPointerDown"
    @pointermove="onCanvasPointerMove"
    @pointerup="endDrag"
    @wheel.prevent="onWheel"
  >
    <SmylrLiveAppEmbed />
    <SmylrLiveWorkspaceCanvas />
    <div
      v-if="liveFrame"
      data-test-id="smylr-live-frame-controls"
      class="absolute top-0 left-0 z-10"
      :class="isFrameMode ? 'pointer-events-auto' : 'pointer-events-none'"
      :style="frameOverlayStyle"
      @pointerdown.stop.prevent="beginFrameMove"
    >
      <div
        class="absolute inset-0 border transition-colors"
        :class="isFrameSelected ? 'border-accent shadow-sm' : 'border-accent/70'"
      />
      <button
        v-for="handle in RESIZE_HANDLES"
        :key="handle.handle"
        :aria-label="handle.label"
        class="ring-panel/70 absolute size-2.5 rounded-full border border-violet-500 bg-white shadow-sm ring-1"
        :class="handle.className"
        type="button"
        @pointerdown.stop.prevent="beginFrameResize(handle.handle, $event)"
      />
      <button
        v-for="handle in ROTATE_HANDLES"
        :key="`rotate-${handle.corner}`"
        :aria-label="handle.label"
        class="absolute size-3.5 cursor-crosshair border-0 bg-transparent"
        :class="handle.className"
        type="button"
        @pointerdown.stop.prevent="beginFrameRotate($event)"
      />
    </div>
  </div>
</template>
