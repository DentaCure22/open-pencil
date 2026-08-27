<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onUnmounted, ref, watch } from 'vue'

import type { Vector } from '@open-pencil/scene-graph/primitives'
import {
  closeLiveInspectorContextComment,
  openContextCommentForLiveInspector,
  reconcileLiveInspectorContextComment
} from '@/app/context-comment'
import { useEditorStore } from '@/app/editor/active-store'
import { resolveLiveDropLayer } from '@/app/smylr-live-inspector/drop-layer'
import {
  beginLiveInspectorOverlayTransform,
  LIVE_INSPECTOR_CORNER_HANDLES,
  liveInspectorTransformDistance,
  type LiveInspectorMoveTransform,
  type LiveInspectorOverlayTransform,
  updateLiveInspectorOverlayTransform
} from '@/app/smylr-live-inspector/overlay-transform'
import {
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  liveInspectorCanRedoSelectedDraft,
  liveInspectorCanUndoSelectedDraft,
  liveInspectorDocument,
  liveInspectorPatchDraft,
  liveInspectorSelectedId,
  liveInspectorSelectedRect,
  liveInspectorSelectionEpoch,
  hoveredLiveInspectorNode,
  hoveredLiveInspectorRect,
  previewLiveInspectorDraft,
  redoLiveInspectorDraft,
  selectedLiveInspectorNode,
  undoLiveInspectorDraft
} from '@/app/smylr-live-inspector/session'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'
import { getContainerLabelPlacement } from '@/components/smylr-live-container-overlay/label-placement'
import SmylrLiveSpacingMeasurements from '@/components/smylr-live-container-overlay/SmylrLiveSpacingMeasurements.vue'
import Tip from '@/components/ui/Tip.vue'

const emit = defineEmits<{
  'select-at-point': [event: PointerEvent]
}>()
const store = useEditorStore()
const syncTick = ref(0)
const overlayRef = ref<HTMLElement | null>(null)
const activeTransform = ref<LiveInspectorOverlayTransform | null>(null)
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
const overlayLabelStyle = computed(() => {
  const zoom = Math.max(store.state.zoom, 0.01)
  return {
    borderRadius: `${2 / zoom}px`,
    fontSize: `${10 / zoom}px`,
    gap: `${4 / zoom}px`,
    padding: `${2 / zoom}px ${6 / zoom}px`
  }
})
const selectedLabelPlacement = computed(() => {
  const frame = liveFrame.value
  const rect = displayedRect.value
  return frame && rect
    ? getContainerLabelPlacement(rect, frame, store.state.zoom)
    : { horizontal: 'left' as const, maxWidth: 360, vertical: 'above' as const }
})
const hoverLabelPlacement = computed(() => {
  const frame = liveFrame.value
  const rect = hoveredLiveInspectorRect.value
  return frame && rect
    ? getContainerLabelPlacement(rect, frame, store.state.zoom)
    : { horizontal: 'left' as const, maxWidth: 360, vertical: 'above' as const }
})
const selectedLabelStyle = computed(() => ({
  ...overlayLabelStyle.value,
  maxWidth: `${selectedLabelPlacement.value.maxWidth}px`
}))
const hoverLabelStyle = computed(() => ({
  ...overlayLabelStyle.value,
  maxWidth: `${hoverLabelPlacement.value.maxWidth}px`
}))
function verticalLabelClass(vertical: 'above' | 'below' | 'inside-top') {
  if (vertical === 'below') return 'top-full mt-1'
  if (vertical === 'inside-top') return 'top-0 mt-1'
  return 'bottom-full mb-1'
}
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

function currentTransformStyles() {
  return {
    ...selectedLiveInspectorNode.value?.computedStyle,
    ...liveInspectorPatchDraft.value?.styles
  }
}

function beginResize(handle: (typeof LIVE_INSPECTOR_CORNER_HANDLES)[number], event: PointerEvent) {
  if (!isSelectMode.value || event.button !== 0) return
  const rect = liveInspectorSelectedRect.value
  const node = selectedLiveInspectorNode.value
  if (!rect || !node) return

  event.preventDefault()
  event.stopPropagation()
  activeTransform.value = beginLiveInspectorOverlayTransform({
    action: { handle, kind: 'resize' },
    pointer: event,
    rect,
    styles: currentTransformStyles()
  })
  previewSize.value = { height: rect.height, width: rect.width }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function beginRotate(event: PointerEvent) {
  if (!isSelectMode.value || event.button !== 0) return
  const node = selectedLiveInspectorNode.value
  const bounds = overlayRef.value?.getBoundingClientRect()
  if (!node || !bounds) return
  event.preventDefault()
  event.stopPropagation()
  activeTransform.value = beginLiveInspectorOverlayTransform({
    action: { kind: 'rotate' },
    bounds,
    pointer: event,
    styles: currentTransformStyles()
  })
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function applyDropLayer(move: LiveInspectorMoveTransform, event: PointerEvent) {
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
  activeTransform.value = beginLiveInspectorOverlayTransform({
    action: { kind: 'move', selectOnClick },
    pointer: event,
    rect,
    styles: currentTransformStyles()
  })
  previewPosition.value = { x: rect.x, y: rect.y }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  const transform = activeTransform.value
  const node = selectedLiveInspectorNode.value
  if (!transform || !node) return
  const update = updateLiveInspectorOverlayTransform(transform, event, store.state.zoom)
  if (!update) return

  if (update.kind === 'move') previewPosition.value = update.position
  if (update.kind === 'resize') previewSize.value = update.size
  let actionLabel = 'Rotate'
  if (update.kind === 'move') actionLabel = 'Move'
  else if (update.kind === 'resize') actionLabel = 'Resize'
  previewLiveInspectorDraft(
    {
      add: liveInspectorPatchDraft.value?.add ?? [],
      nodeId: node.id,
      remove: liveInspectorPatchDraft.value?.remove ?? [],
      source: node.source,
      styles: { ...liveInspectorPatchDraft.value?.styles, ...update.styles }
    },
    {
      coalesceKey: `${node.id}:${update.kind}`,
      label: `${actionLabel} ${node.label}`
    }
  )
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
  const transform = activeTransform.value
  if (!transform || transform.pointerId !== event.pointerId) return
  if (transform.kind === 'move') {
    const distance = liveInspectorTransformDistance(transform, event)
    if (transform.selectOnClick && event.type === 'pointerup' && distance < 2) {
      emit('select-at-point', event)
    } else {
      applyDropLayer(transform, event)
    }
  }
  activeTransform.value = null
}

watch(liveInspectorSelectedId, () => {
  previewSize.value = null
  activeTransform.value = null
  previewPosition.value = null
})
watch(
  [
    isSelectMode,
    liveInspectorSelectedId,
    liveInspectorSelectionEpoch,
    () => Boolean(liveInspectorSelectedRect.value)
  ],
  ([selectMode, selectedId]) => {
    reconcileLiveInspectorContextComment({
      active: selectMode,
      open: () => openContextCommentForLiveInspector(store),
      selectedId
    })
  },
  { flush: 'post', immediate: true }
)
watch(liveInspectorSelectedRect, (rect) => {
  const target = previewPosition.value
  if (
    activeTransform.value?.kind !== 'move' &&
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
  closeLiveInspectorContextComment()
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
    <Tip :label="`${displayedNode.label} · Drag to move · drop above target · Shift-drop below`">
      <div
        data-test-id="smylr-live-container-label"
        class="pointer-events-auto absolute flex cursor-move items-center bg-accent font-medium text-white shadow-sm active:cursor-grabbing"
        :class="[
          selectedLabelPlacement.horizontal === 'right' ? 'right-0' : 'left-0',
          verticalLabelClass(selectedLabelPlacement.vertical)
        ]"
        :style="selectedLabelStyle"
        :title="displayedNode.label"
        @pointerdown="beginMove($event)"
      >
        <span class="min-w-0 flex-1 truncate">{{ displayedNode.label }}</span>
        <span
          v-if="liveInspectorPatchDraft || liveInspectorCanRedoSelectedDraft"
          class="ml-1 flex shrink-0 items-center gap-0.5 border-l border-white/25 pl-1"
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

    <template v-for="corner in LIVE_INSPECTOR_CORNER_HANDLES" :key="corner">
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
      class="pointer-events-none absolute flex items-center bg-accent/75 font-medium text-white shadow-sm"
      :class="[
        hoverLabelPlacement.horizontal === 'right' ? 'right-0' : 'left-0',
        verticalLabelClass(hoverLabelPlacement.vertical)
      ]"
      :style="hoverLabelStyle"
      :title="hoveredLiveInspectorNode.label"
    >
      <span class="min-w-0 flex-1 truncate">{{ hoveredLiveInspectorNode.label }}</span>
    </div>
  </div>
</template>
