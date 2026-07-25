<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref, type ComponentPublicInstance } from 'vue'

import { readContentSource } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import { useEditorStore } from '@/app/editor/active-store'
import { forwardFrameSurfaceWheel } from '@/app/editor/canvas/embedded-surface-wheel'
import {
  codeObjectDocument,
  dispatchCodeObjectBoardAction,
  isCodeObjectFrame,
  updateCodeObjectState,
  type CodeObjectState
} from '@/app/code-object/model'
import {
  attachCodeObject,
  disposeAllCodeObjects,
  disposeCodeObject,
  focusCodeObject,
  parkCodeObject,
  renderCodeObject
} from '@/app/code-object/runtime'
import { placeExtractedPdfPage } from '@/app/media-evidence/extraction'
import type { PdfPageImage } from '@/app/media-evidence/pdf'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import {
  createLiveFrameTransformController,
  LIVE_FRAME_RESIZE_HANDLE_STYLE,
  LIVE_FRAME_ROTATE_HANDLE_STYLE,
  liveFrameCanvasStyle,
  liveFrameResizeHandles,
  liveFrameRotationHandles,
  liveFrameScreenOverlayStyle
} from '@/app/smylr-production/frame-transform'

type ShapeMode = 'design' | 'interact'
type ShapeMoveDrag = {
  frameId: string
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

const store = useEditorStore()
const syncTick = ref(0)
const modeByFrame = ref<Record<string, ShapeMode>>({})
const moveDrag = ref<ShapeMoveDrag | null>(null)
let unsubscribe: Array<() => void> = []

const shapes = computed(() => {
  void syncTick.value
  void store.state.currentPageId
  void store.state.renderVersion
  return store.graph
    .getChildren(store.state.currentPageId)
    .filter((node) => isCodeObjectFrame(node) && node.visible)
})

const activeInteractionFrameId = computed(
  () => Object.entries(modeByFrame.value).find(([, mode]) => mode === 'interact')?.[0] ?? null
)

const frameTransform = createLiveFrameTransformController(store, sync)

function sync() {
  syncTick.value += 1
}

function modeFor(frameId: string): ShapeMode {
  return modeByFrame.value[frameId] ?? 'design'
}

function isSelected(frameId: string) {
  return store.state.selectedIds.has(frameId)
}

function setMode(frameId: string, mode: ShapeMode) {
  store.select([frameId])
  modeByFrame.value = { ...modeByFrame.value, [frameId]: mode }
  const frame = store.graph.getNode(frameId)
  if (frame) renderFrame(frame)
  if (mode === 'interact') requestAnimationFrame(() => focusCodeObject(frameId))
  sync()
}

function enterInteraction(frameId: string) {
  setMode(frameId, 'interact')
}

function exitInteraction(frameId: string) {
  setMode(frameId, 'design')
}

function exitUnselectedInteractions() {
  let changed = false
  const next = { ...modeByFrame.value }
  for (const [frameId, mode] of Object.entries(next)) {
    if (mode === 'interact' && !isSelected(frameId)) {
      next[frameId] = 'design'
      changed = true
    }
  }
  if (changed) modeByFrame.value = next
}

function surfaceCanvasStyle(frame: SceneNode) {
  return liveFrameCanvasStyle(store, frame)
}

function surfaceOverlayStyle(frame: SceneNode) {
  return liveFrameScreenOverlayStyle(store, frame)
}

function resizeHandles(frame: SceneNode) {
  return liveFrameResizeHandles(frame, store.state.zoom)
}

function rotationHandles(frame: SceneNode) {
  return liveFrameRotationHandles(frame, store.state.zoom)
}

function renderFrame(frame: SceneNode) {
  const shape = codeObjectDocument(frame)
  if (!shape) return
  const contentSource = readContentSource(frame)
  const assetHash = contentSource ? assetHashFromReference(contentSource.source) : null
  renderCodeObject(frame.id, shape, (state) => commitShapeState(frame.id, state), {
    bytes: assetHash ? store.graph.images.get(assetHash) : undefined,
    dispatchBoardAction: async (action) =>
      dispatchCodeObjectBoardAction(store, frame.id, action, {
        interactionEnabled: modeFor(frame.id) === 'interact'
      }),
    fileName: contentSource?.fileName ?? undefined,
    interactionEnabled: modeFor(frame.id) === 'interact',
    onExtractPdfPage: (pageNumber, image) => extractPdfPage(frame.id, pageNumber, image)
  })
}

function extractPdfPage(frameId: string, pageNumber: number, image: PdfPageImage) {
  const frame = store.graph.getNode(frameId)
  const source = frame ? mediaEvidenceSource(frame) : null
  if (!frame || source?.kind !== 'pdf') return
  placeExtractedPdfPage(store, frame, source, pageNumber, image)
}

function renderVisibleFrames() {
  for (const frame of shapes.value) renderFrame(frame)
}

function bindHost(frameId: string, value: Element | ComponentPublicInstance | null) {
  if (!(value instanceof HTMLElement)) {
    parkCodeObject(frameId)
    return
  }
  attachCodeObject(frameId, value)
  const frame = store.graph.getNode(frameId)
  if (frame) renderFrame(frame)
}

function commitShapeState(frameId: string, state: CodeObjectState) {
  updateCodeObjectState(store, frameId, state)
}

function handleSurfaceWheel(event: WheelEvent) {
  const source = event.currentTarget
  if (source instanceof HTMLElement) forwardFrameSurfaceWheel(source, event)
}

function selectShape(frameId: string) {
  if (!isSelected(frameId)) store.select([frameId])
}

function beginShapeMove(frameId: string, event: PointerEvent) {
  const frame = store.graph.getNode(frameId)
  if (!frame || event.button !== 0) return
  selectShape(frameId)
  moveDrag.value = {
    frameId,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: frame.x,
    startY: frame.y
  }
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId)
}

function moveShape(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  const zoom = Math.max(store.state.zoom, 0.01)
  store.graph.updateNodePreview(drag.frameId, {
    x: drag.startX + (event.clientX - drag.startClientX) / zoom,
    y: drag.startY + (event.clientY - drag.startClientY) / zoom
  })
  store.requestRepaint()
  sync()
}

function endShapeMove(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  moveDrag.value = null
  const frame = store.graph.getNode(drag.frameId)
  if (!frame) return
  const next = { x: frame.x, y: frame.y }
  store.graph.updateNodePreview(frame.id, { x: drag.startX, y: drag.startY })
  if (next.x !== drag.startX || next.y !== drag.startY) {
    store.updateNodeWithUndo(frame.id, next, 'Move code object')
  }
  sync()
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

useEventListener(
  window,
  'keydown',
  (event) => {
    if (event.code === 'Escape') {
      const active = Object.entries(modeByFrame.value).find(([, mode]) => mode === 'interact')
      if (!active) return
      event.preventDefault()
      event.stopImmediatePropagation()
      exitInteraction(active[0])
      return
    }
    if (event.code !== 'Enter' || event.repeat || isTypingTarget(event.target)) return
    const selectedId = store.state.selectedIds.size === 1 ? [...store.state.selectedIds][0] : null
    const selected = selectedId ? store.graph.getNode(selectedId) : null
    if (!selectedId || !isCodeObjectFrame(selected) || modeFor(selectedId) === 'interact') return
    event.preventDefault()
    enterInteraction(selectedId)
  },
  { capture: true }
)

onMounted(() => {
  unsubscribe = [
    store.onEditorEvent('graph:replaced', () => {
      disposeAllCodeObjects()
      sync()
    }),
    store.onEditorEvent('page:changed', sync),
    store.onEditorEvent('node:created', sync),
    store.onEditorEvent('node:deleted', (id) => {
      disposeCodeObject(id)
      sync()
    }),
    store.onEditorEvent('node:reparented', sync),
    store.onEditorEvent('node:reordered', sync),
    store.onEditorEvent('node:updated', (id) => {
      const node = store.graph.getNode(id)
      if (node && isCodeObjectFrame(node)) renderFrame(node)
      sync()
    }),
    store.onEditorEvent('selection:changed', () => {
      exitUnselectedInteractions()
      sync()
    }),
    store.onEditorEvent('viewport:changed', sync),
    store.onEditorEvent('repaint:requested', sync)
  ]
  renderVisibleFrames()
})

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  disposeAllCodeObjects()
})
</script>

<template>
  <template v-for="frame in shapes" :key="frame.id">
    <div
      class="absolute top-0 left-0 z-[4] overflow-hidden"
      :class="modeFor(frame.id) === 'interact' ? 'pointer-events-auto' : 'pointer-events-none'"
      :data-code-object-mode="modeFor(frame.id)"
      :data-test-id="`code-object-${frame.id}`"
      :style="surfaceCanvasStyle(frame)"
      @pointerdown.stop="selectShape(frame.id)"
      @wheel.prevent="handleSurfaceWheel"
    >
      <div :ref="(value) => bindHost(frame.id, value)" class="size-full" />
    </div>

    <div
      class="pointer-events-none absolute top-0 left-0 z-[7]"
      :class="
        isSelected(frame.id) && modeFor(frame.id) === 'design' ? 'ring-1 ring-violet-500' : ''
      "
      :data-test-id="`code-object-overlay-${frame.id}`"
      :style="surfaceOverlayStyle(frame)"
    >
      <div
        v-if="modeFor(frame.id) === 'design' && !activeInteractionFrameId"
        class="pointer-events-auto absolute inset-0 z-[1]"
        :class="isSelected(frame.id) ? 'cursor-move' : 'cursor-default'"
        :aria-label="`${frame.name}. Double-click to interact.`"
        data-test-id="code-object-design-hit-target"
        @dblclick.stop.prevent="enterInteraction(frame.id)"
        @pointercancel.stop="endShapeMove"
        @pointerdown.stop="beginShapeMove(frame.id, $event)"
        @pointermove.stop.prevent="moveShape"
        @pointerup.stop.prevent="endShapeMove"
      />

      <span
        v-for="handle in resizeHandles(frame)"
        v-show="isSelected(frame.id) && modeFor(frame.id) === 'design'"
        :key="handle.id"
        class="pointer-events-auto absolute z-20 rounded-full border border-violet-500 bg-white"
        :class="
          handle.id === 'nw' || handle.id === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
        "
        :data-test-id="`code-object-resize-${handle.id}`"
        :style="{
          ...LIVE_FRAME_RESIZE_HANDLE_STYLE,
          left: `${handle.x}px`,
          top: `${handle.y}px`,
          transform: handle.transform
        }"
        @pointercancel.stop="frameTransform.end"
        @pointerdown.stop.prevent="frameTransform.beginResize(frame.id, handle.id, $event)"
        @pointermove.stop.prevent="frameTransform.move"
        @pointerup.stop.prevent="frameTransform.end"
      />
      <span
        v-for="handle in rotationHandles(frame)"
        v-show="isSelected(frame.id) && modeFor(frame.id) === 'design'"
        :key="`rotate-${handle.id}`"
        class="pointer-events-auto absolute z-10 cursor-crosshair"
        :data-test-id="`code-object-rotate-${handle.id}`"
        :style="{
          ...LIVE_FRAME_ROTATE_HANDLE_STYLE,
          left: `${handle.x}px`,
          top: `${handle.y}px`,
          transform: handle.transform
        }"
        @pointercancel.stop="frameTransform.end"
        @pointerdown.stop.prevent="frameTransform.beginRotate(frame.id, $event)"
        @pointermove.stop.prevent="frameTransform.move"
        @pointerup.stop.prevent="frameTransform.end"
      />
    </div>
  </template>
</template>
