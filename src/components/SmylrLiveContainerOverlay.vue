<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onUnmounted, ref, watch } from 'vue'

import type { Vector } from '@open-pencil/scene-graph/primitives'
import { useEditorStore } from '@/app/editor/active-store'
import { resolveLiveDropLayer } from '@/app/smylr-live-inspector/drop-layer'
import {
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  liveInspectorCanRedoSelectedDraft,
  liveInspectorCanUndoSelectedDraft,
  liveInspectorDocument,
  liveInspectorPatchDraft,
  liveInspectorSelectedId,
  liveInspectorSelectedRect,
  hoveredLiveInspectorNode,
  hoveredLiveInspectorRect,
  previewLiveInspectorDraft,
  redoLiveInspectorDraft,
  selectedLiveInspectorNode,
  undoLiveInspectorDraft
} from '@/app/smylr-live-inspector/session'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'
import SmylrLiveSpacingMeasurements from '@/components/smylr-live-container-overlay/SmylrLiveSpacingMeasurements.vue'
import Tip from '@/components/ui/Tip.vue'

type CornerHandle = 'nw' | 'ne' | 'se' | 'sw'
type ResizeDrag = {
  baseX: number
  baseY: number
  handle: CornerHandle
  pointerId: number
  startClientX: number
  startClientY: number
  startHeight: number
  startWidth: number
}
type RotateDrag = {
  centerClientX: number
  centerClientY: number
  pointerId: number
  startAngle: number
  startRotation: number
}
type MoveDrag = {
  baseX: number
  baseY: number
  pointerId: number
  selectOnClick: boolean
  startClientX: number
  startClientY: number
  startRectX: number
  startRectY: number
}

const MIN_CONTAINER_SIZE = 24
const CORNER_HANDLES = ['nw', 'ne', 'se', 'sw'] as const
const emit = defineEmits<{
  'select-at-point': [event: PointerEvent]
}>()
const store = useEditorStore()
const syncTick = ref(0)
const overlayRef = ref<HTMLElement | null>(null)
const resizeDrag = ref<ResizeDrag | null>(null)
const rotateDrag = ref<RotateDrag | null>(null)
const moveDrag = ref<MoveDrag | null>(null)
const previewSize = ref<{ height: number; width: number } | null>(null)
const previewPosition = ref<Vector | null>(null)

let unsubscribe: Array<() => void> = []

function bumpOverlaySync() {
  syncTick.value += 1
}

unsubscribe = [
  store.onEditorEvent('graph:replaced', bumpOverlaySync),
  store.onEditorEvent('page:changed', bumpOverlaySync),
  store.onEditorEvent('node:updated', bumpOverlaySync),
  store.onEditorEvent('render:requested', bumpOverlaySync),
  store.onEditorEvent('repaint:requested', bumpOverlaySync)
]

const isSelectMode = computed(() => liveInspectorInteractionMode.value === 'select')
const displayedNode = computed(() => selectedLiveInspectorNode.value)
const displayedRect = computed(() => liveInspectorSelectedRect.value)
const isHoverPreview = computed(() => Boolean(hoveredLiveInspectorNode.value))
const selectedSize = computed(() => previewSize.value ?? liveInspectorSelectedRect.value)
const displayedSize = computed(() => selectedSize.value)
const liveFrame = computed(() => {
  const activeFrameId = liveInspectorActiveFrameId.value
  const activeFrame = activeFrameId ? store.graph.getNode(activeFrameId) : null
  return activeFrame && isSmylrProductionAppCodeObjectFrame(activeFrame) ? activeFrame : null
})
const selectedCornerStyle = computed(() => {
  const draft = liveInspectorPatchDraft.value?.styles
  const computedStyle = displayedNode.value?.computedStyle
  const radius = (property: string) => draft?.[property] || computedStyle?.[property] || '0px'
  return {
    borderBottomLeftRadius: radius('border-bottom-left-radius'),
    borderBottomRightRadius: radius('border-bottom-right-radius'),
    borderTopLeftRadius: radius('border-top-left-radius'),
    borderTopRightRadius: radius('border-top-right-radius')
  }
})
const overlayStyle = computed<Record<string, string>>(() => {
  void syncTick.value
  const rect = displayedRect.value
  const size = displayedSize.value
  if (!rect || !size) return {} as Record<string, string>
  // Keep the visible stroke at one screen pixel regardless of canvas zoom.
  const strokeWidth = 1 / Math.max(store.state.zoom, 0.01)

  return {
    ...selectedCornerStyle.value,
    boxShadow: `inset 0 0 0 ${strokeWidth}px var(--color-accent)`,
    height: `${Math.max(1, size.height)}px`,
    left: `${previewPosition.value?.x ?? rect.x}px`,
    top: `${previewPosition.value?.y ?? rect.y}px`,
    width: `${Math.max(1, size.width)}px`
  }
})
const hoverCornerStyle = computed(() => {
  const computedStyle = hoveredLiveInspectorNode.value?.computedStyle
  const radius = (property: string) => computedStyle?.[property] || '0px'
  return {
    borderBottomLeftRadius: radius('border-bottom-left-radius'),
    borderBottomRightRadius: radius('border-bottom-right-radius'),
    borderTopLeftRadius: radius('border-top-left-radius'),
    borderTopRightRadius: radius('border-top-right-radius')
  }
})
const hoverOverlayStyle = computed<Record<string, string>>(() => {
  void syncTick.value
  const rect = hoveredLiveInspectorRect.value
  if (!rect) return {}
  const strokeWidth = 1 / Math.max(store.state.zoom, 0.01)
  return {
    ...hoverCornerStyle.value,
    boxShadow: `inset 0 0 0 ${strokeWidth}px color-mix(in srgb, var(--color-accent) 72%, transparent)`,
    height: `${Math.max(1, rect.height)}px`,
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${Math.max(1, rect.width)}px`
  }
})
const labelBelow = computed(
  () => Number.parseFloat(overlayStyle.value.top ?? '0') * Math.max(store.state.zoom, 0.01) < 32
)
const hoverLabelBelow = computed(
  () =>
    Number.parseFloat(hoverOverlayStyle.value.top ?? '0') * Math.max(store.state.zoom, 0.01) < 32
)
const overlayLabelStyle = computed(() => {
  const zoom = Math.max(store.state.zoom, 0.01)
  return {
    borderRadius: `${2 / zoom}px`,
    fontSize: `${10 / zoom}px`,
    gap: `${4 / zoom}px`,
    padding: `${2 / zoom}px ${6 / zoom}px`
  }
})
const cornerHandleStyle = computed(() => {
  const zoom = Math.max(store.state.zoom, 0.01)
  const size = 6 / zoom
  const offset = -size / 2
  return {
    borderWidth: `${1 / zoom}px`,
    height: `${size}px`,
    width: `${size}px`,
    offset: `${offset}px`
  }
})
const rotationHandleStyle = computed(() => {
  const zoom = Math.max(store.state.zoom, 0.01)
  const size = 18 / zoom
  const gap = 5 / zoom
  return {
    gap: `${gap}px`,
    height: `${size}px`,
    width: `${size}px`
  }
})

function beginResize(handle: CornerHandle, event: PointerEvent) {
  if (!isSelectMode.value || event.button !== 0) return
  const rect = liveInspectorSelectedRect.value
  const node = selectedLiveInspectorNode.value
  if (!rect || !node) return

  event.preventDefault()
  event.stopPropagation()
  const current = translatePair(
    liveInspectorPatchDraft.value?.styles?.translate ?? node.computedStyle?.translate
  )
  resizeDrag.value = {
    baseX: current.x,
    baseY: current.y,
    handle,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startHeight: rect.height,
    startWidth: rect.width
  }
  previewSize.value = { height: rect.height, width: rect.width }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function numericRotation(value: string | undefined) {
  if (!value || value === 'none') return 0
  return Number.parseFloat(value) || 0
}

function beginRotate(event: PointerEvent) {
  if (!isSelectMode.value || event.button !== 0) return
  const node = selectedLiveInspectorNode.value
  const bounds = overlayRef.value?.getBoundingClientRect()
  if (!node || !bounds) return
  event.preventDefault()
  event.stopPropagation()
  const centerClientX = bounds.left + bounds.width / 2
  const centerClientY = bounds.top + bounds.height / 2
  rotateDrag.value = {
    centerClientX,
    centerClientY,
    pointerId: event.pointerId,
    startAngle: Math.atan2(event.clientY - centerClientY, event.clientX - centerClientX),
    startRotation: numericRotation(
      liveInspectorPatchDraft.value?.styles?.rotate ?? node.computedStyle?.rotate
    )
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function translatePair(value: string | undefined) {
  if (!value || value === 'none') return { x: 0, y: 0 }
  const parts = value.trim().split(/\s+/)
  return {
    x: Number.parseFloat(parts[0] ?? '0') || 0,
    y: Number.parseFloat(parts[1] ?? '0') || 0
  }
}

function applyDropLayer(move: MoveDrag, event: PointerEvent) {
  if (
    event.type !== 'pointerup' ||
    Math.hypot(event.clientX - move.startClientX, event.clientY - move.startClientY) < 2
  ) {
    return
  }
  const document = liveInspectorDocument.value
  const selected = selectedLiveInspectorNode.value
  const rect = liveInspectorSelectedRect.value
  if (!document || !selected || !rect) return

  const zoom = Math.max(store.state.zoom, 0.01)
  const droppedX = move.startRectX + (event.clientX - move.startClientX) / zoom
  const droppedY = move.startRectY + (event.clientY - move.startClientY) / zoom
  const direction = event.shiftKey ? 'below' : 'above'
  const placement = resolveLiveDropLayer({
    currentStyles: liveInspectorPatchDraft.value?.styles,
    direction,
    selected,
    tree: document.tree,
    x: droppedX + rect.width / 2,
    y: droppedY + rect.height / 2
  })
  if (!placement) return

  previewLiveInspectorDraft(
    {
      add: liveInspectorPatchDraft.value?.add ?? [],
      nodeId: selected.id,
      note: `Placed ${direction} ${placement.target.label}`,
      remove: liveInspectorPatchDraft.value?.remove ?? [],
      source: selected.source,
      styles: placement.styles
    },
    { coalesceKey: `${selected.id}:move`, label: `Move ${selected.label} ${direction}` }
  )
}

function beginMove(event: PointerEvent, selectOnClick = false) {
  if (!isSelectMode.value || event.button !== 0) return
  const node = selectedLiveInspectorNode.value
  const rect = liveInspectorSelectedRect.value
  if (!node || !rect) return
  event.preventDefault()
  event.stopPropagation()
  const current = translatePair(
    liveInspectorPatchDraft.value?.styles?.translate ?? node.computedStyle?.translate
  )
  moveDrag.value = {
    baseX: current.x,
    baseY: current.y,
    pointerId: event.pointerId,
    selectOnClick,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startRectX: rect.x,
    startRectY: rect.y
  }
  previewPosition.value = { x: rect.x, y: rect.y }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function resizedDraft(drag: ResizeDrag, event: PointerEvent) {
  const zoom = Math.max(store.state.zoom, 0.01)
  const dx = (event.clientX - drag.startClientX) / zoom
  const dy = (event.clientY - drag.startClientY) / zoom
  const west = drag.handle.includes('w')
  const north = drag.handle.includes('n')
  const width = Math.max(MIN_CONTAINER_SIZE, Math.round(drag.startWidth + (west ? -dx : dx)))
  const height = Math.max(MIN_CONTAINER_SIZE, Math.round(drag.startHeight + (north ? -dy : dy)))
  const appliedX = west ? drag.startWidth - width : 0
  const appliedY = north ? drag.startHeight - height : 0
  const next = { height, width }
  const styles = { ...liveInspectorPatchDraft.value?.styles }
  styles.width = `${next.width}px`
  styles.height = `${next.height}px`
  if (west || north) {
    styles.translate = `${drag.baseX + appliedX}px ${drag.baseY + appliedY}px`
  }
  return { next, styles }
}

function previewRotationDrag(event: PointerEvent) {
  const rotation = rotateDrag.value
  const rotationNode = selectedLiveInspectorNode.value
  if (!rotation || rotation.pointerId !== event.pointerId || !rotationNode) return false
  const angle = Math.atan2(
    event.clientY - rotation.centerClientY,
    event.clientX - rotation.centerClientX
  )
  const degrees = rotation.startRotation + ((angle - rotation.startAngle) * 180) / Math.PI
  previewLiveInspectorDraft(
    {
      add: liveInspectorPatchDraft.value?.add ?? [],
      nodeId: rotationNode.id,
      remove: liveInspectorPatchDraft.value?.remove ?? [],
      source: rotationNode.source,
      styles: {
        ...liveInspectorPatchDraft.value?.styles,
        rotate: `${Math.round(degrees * 10) / 10}deg`
      }
    },
    { coalesceKey: `${rotationNode.id}:rotate`, label: `Rotate ${rotationNode.label}` }
  )
  return true
}

function previewMoveDrag(event: PointerEvent) {
  const move = moveDrag.value
  const selected = selectedLiveInspectorNode.value
  if (!move || move.pointerId !== event.pointerId || !selected) return false
  const zoom = Math.max(store.state.zoom, 0.01)
  const x = Math.round((event.clientX - move.startClientX) / zoom)
  const y = Math.round((event.clientY - move.startClientY) / zoom)
  previewPosition.value = { x: move.startRectX + x, y: move.startRectY + y }
  previewLiveInspectorDraft(
    {
      add: liveInspectorPatchDraft.value?.add ?? [],
      nodeId: selected.id,
      remove: liveInspectorPatchDraft.value?.remove ?? [],
      source: selected.source,
      styles: {
        ...liveInspectorPatchDraft.value?.styles,
        translate: `${move.baseX + x}px ${move.baseY + y}px`
      }
    },
    { coalesceKey: `${selected.id}:move`, label: `Move ${selected.label}` }
  )
  return true
}

function previewResizeDrag(event: PointerEvent) {
  const drag = resizeDrag.value
  const node = selectedLiveInspectorNode.value
  if (!drag || drag.pointerId !== event.pointerId || !node) return false

  const { next, styles } = resizedDraft(drag, event)
  previewSize.value = next
  previewLiveInspectorDraft(
    {
      add: liveInspectorPatchDraft.value?.add ?? [],
      nodeId: node.id,
      remove: liveInspectorPatchDraft.value?.remove ?? [],
      source: node.source,
      styles
    },
    { coalesceKey: `${node.id}:resize`, label: `Resize ${node.label}` }
  )
  return true
}

function onPointerMove(event: PointerEvent) {
  if (previewRotationDrag(event)) return
  if (previewMoveDrag(event)) return
  previewResizeDrag(event)
}

function undoSelectedEdit() {
  previewPosition.value = null
  previewSize.value = null
  undoLiveInspectorDraft()
}

function redoSelectedEdit() {
  previewPosition.value = null
  previewSize.value = null
  redoLiveInspectorDraft()
}

function endResize(event: PointerEvent) {
  if (rotateDrag.value?.pointerId === event.pointerId) {
    rotateDrag.value = null
    return
  }
  const move = moveDrag.value
  if (move?.pointerId === event.pointerId) {
    const distance = Math.hypot(
      event.clientX - move.startClientX,
      event.clientY - move.startClientY
    )
    if (move.selectOnClick && event.type === 'pointerup' && distance < 2) {
      emit('select-at-point', event)
    } else {
      applyDropLayer(move, event)
    }
    moveDrag.value = null
    return
  }
  const drag = resizeDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  resizeDrag.value = null
}

watch(liveInspectorSelectedId, () => {
  previewSize.value = null
  resizeDrag.value = null
  rotateDrag.value = null
  moveDrag.value = null
  previewPosition.value = null
})
watch(liveInspectorSelectedRect, (rect) => {
  const target = previewPosition.value
  if (
    !moveDrag.value &&
    rect &&
    target &&
    Math.abs(rect.x - target.x) <= 1 &&
    Math.abs(rect.y - target.y) <= 1
  ) {
    previewPosition.value = null
  }
})
watch(liveInspectorPatchDraft, (draft) => {
  if (!draft) previewSize.value = null
})

useEventListener(window, 'pointermove', onPointerMove)
useEventListener(window, 'pointerup', endResize)
useEventListener(window, 'pointercancel', endResize)

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
})
</script>

<template>
  <div
    v-if="isSelectMode && displayedRect && displayedNode"
    ref="overlayRef"
    data-test-id="smylr-live-container-overlay"
    class="pointer-events-none absolute z-10"
    :style="overlayStyle"
  >
    <SmylrLiveSpacingMeasurements
      v-if="liveFrame && displayedSize"
      :frame-height="liveFrame.height"
      :frame-width="liveFrame.width"
      :height="displayedSize.height"
      :node="displayedNode"
      :origin-x="previewPosition?.x ?? displayedRect.x"
      :origin-y="previewPosition?.y ?? displayedRect.y"
      :preview-style="liveInspectorPatchDraft?.styles"
      :width="displayedSize.width"
      :zoom="store.state.zoom"
    />
    <Tip label="Drag to move · drop above target · Shift-drop below">
      <div
        data-test-id="smylr-live-container-label"
        class="pointer-events-auto absolute left-0 flex cursor-move items-center bg-accent font-medium text-white shadow-sm active:cursor-grabbing"
        :class="labelBelow ? 'top-full mt-1' : 'bottom-full mb-1'"
        :style="overlayLabelStyle"
        @pointerdown="beginMove($event)"
      >
        <span class="max-w-36 truncate">{{ displayedNode.label }}</span>
        <span
          v-if="liveInspectorPatchDraft || liveInspectorCanRedoSelectedDraft"
          class="ml-1 flex items-center gap-0.5 border-l border-white/25 pl-1"
        >
          <button
            type="button"
            aria-label="Undo container edit"
            class="flex size-4 cursor-pointer items-center justify-center rounded hover:bg-white/20 disabled:cursor-default disabled:opacity-35"
            :disabled="!liveInspectorCanUndoSelectedDraft"
            @click.stop="undoSelectedEdit"
            @pointerdown.stop
          >
            <icon-lucide-undo-2 class="size-2.5" />
          </button>
          <button
            type="button"
            aria-label="Redo container edit"
            class="flex size-4 cursor-pointer items-center justify-center rounded hover:bg-white/20 disabled:cursor-default disabled:opacity-35"
            :disabled="!liveInspectorCanRedoSelectedDraft"
            @click.stop="redoSelectedEdit"
            @pointerdown.stop
          >
            <icon-lucide-redo-2 class="size-2.5" />
          </button>
        </span>
      </div>
    </Tip>

    <template v-for="corner in CORNER_HANDLES" :key="corner">
      <button
        :aria-label="`Resize selected container from ${corner}`"
        class="pointer-events-auto absolute rounded-full border border-violet-500 bg-white shadow-sm"
        :class="{
          'cursor-nwse-resize': corner === 'nw' || corner === 'se',
          'cursor-nesw-resize': corner === 'ne' || corner === 'sw'
        }"
        :style="{
          borderWidth: cornerHandleStyle.borderWidth,
          height: cornerHandleStyle.height,
          width: cornerHandleStyle.width,
          left: corner.includes('w') ? cornerHandleStyle.offset : undefined,
          right: corner.includes('e') ? cornerHandleStyle.offset : undefined,
          top: corner.includes('n') ? cornerHandleStyle.offset : undefined,
          bottom: corner.includes('s') ? cornerHandleStyle.offset : undefined
        }"
        type="button"
        @pointerdown="beginResize(corner, $event)"
      />
      <button
        :aria-label="`Rotate selected container from ${corner}`"
        class="pointer-events-auto absolute cursor-crosshair border-0 bg-transparent"
        :style="{
          height: rotationHandleStyle.height,
          width: rotationHandleStyle.width,
          left: corner.includes('w')
            ? `calc(-${rotationHandleStyle.width} - ${rotationHandleStyle.gap})`
            : undefined,
          right: corner.includes('e')
            ? `calc(-${rotationHandleStyle.width} - ${rotationHandleStyle.gap})`
            : undefined,
          top: corner.includes('n')
            ? `calc(-${rotationHandleStyle.height} - ${rotationHandleStyle.gap})`
            : undefined,
          bottom: corner.includes('s')
            ? `calc(-${rotationHandleStyle.height} - ${rotationHandleStyle.gap})`
            : undefined
        }"
        type="button"
        @pointerdown="beginRotate"
      />
    </template>
  </div>
  <div
    v-if="
      isHoverPreview &&
      hoveredLiveInspectorRect &&
      hoveredLiveInspectorNode &&
      hoveredLiveInspectorNode.id !== selectedLiveInspectorNode?.id
    "
    data-test-id="smylr-live-container-hover-overlay"
    class="pointer-events-none absolute z-20"
    :style="hoverOverlayStyle"
  >
    <div
      class="pointer-events-none absolute left-0 flex items-center bg-accent/75 font-medium text-white shadow-sm"
      :class="hoverLabelBelow ? 'top-full mt-1' : 'bottom-full mb-1'"
      :style="overlayLabelStyle"
    >
      <span class="max-w-36 truncate">{{ hoveredLiveInspectorNode.label }}</span>
    </div>
  </div>
</template>
