<script setup lang="ts">
import { useEventListener, useTimeoutFn } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref, type ComponentPublicInstance } from 'vue'

import { readContentSource } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'
import {
  cancelEditorPresentationFrame,
  scheduleEditorPresentationFrame,
  type EditorPresentationFrame
} from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { forwardFrameSurfaceWheel } from '@/app/editor/canvas/embedded-surface-wheel'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import {
  codeObjectDocument,
  createCodeObjectBoardClient,
  dispatchCodeObjectBoardAction,
  isCodeObjectFrame,
  updateCodeObjectState,
  type CodeObjectState
} from '@/app/code-object/model'
import {
  codeObjectDesignGestureDragged,
  createCodeObjectDesignGesture,
  moveCodeObjectDesignGesture,
  reconcileCodeObjectInteractionModes,
  type CodeObjectDesignGesture,
  type CodeObjectInteractionMode
} from '@/app/code-object/interaction'
import { codeObjectFramesForOverlay } from '@/app/code-object/overlays'
import { notifyCodeObjectInspectorChanged } from '@/app/code-object/inspector'
import { reconcileTrustedWebAppResidency } from '@/app/code-object/trusted-web-app-runtime'
import { toast } from '@/app/shell/ui'
import {
  attachCodeObject,
  disposeAllCodeObjects,
  disposeCodeObject,
  disposeCodeObjectsExcept,
  focusCodeObject,
  parkCodeObject,
  renderCodeObject
} from '@/app/code-object/runtime'
import { placeExtractedPdfPage } from '@/app/media-evidence/extraction'
import type { PdfPageImage } from '@/app/media-evidence/pdf'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import {
  CODE_OBJECT_RESIZE_HANDLE_STYLE,
  CODE_OBJECT_ROTATE_HANDLE_STYLE,
  applyCodeObjectViewportPreset,
  codeObjectCanvasStyle,
  codeObjectResizeHandles,
  codeObjectRotationHandles,
  codeObjectScreenOverlayStyle,
  createCodeObjectTransformController,
  type CodeObjectPresentationViewport,
  type CodeObjectViewportPresetId
} from '@/app/code-object/transform'
import {
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'
import { readOpenPencilWorkspaceIdentity } from '@/app/workspace-document/identity'
import CodeObjectHeader from '@/components/code-object/CodeObjectHeader.vue'
import SmylrTrustedWebApp from '@/components/code-object/SmylrTrustedWebApp.vue'

const SMYLR_DOUBLE_CLICK_WINDOW_MS = 300

const store = useEditorStore()
const syncTick = ref(0)
const modeByFrame = ref<Record<string, CodeObjectInteractionMode>>({})
const residentSmylrFrameIds = ref<Set<string>>(new Set())
const smylrInteractionOrder = ref<Record<string, number>>({})
const moveDrag = ref<CodeObjectDesignGesture | null>(null)
let pendingSmylrInteractionFrameId: string | null = null
const presentationViewport = ref<CodeObjectPresentationViewport>({
  panX: store.state.panX,
  panY: store.state.panY,
  zoom: store.state.zoom
})
let interactionSequence = 0
let unsubscribe: Array<() => void> = []
const { start: startSmylrInteraction, stop: stopSmylrInteraction } = useTimeoutFn(
  () => {
    const frameId = pendingSmylrInteractionFrameId
    pendingSmylrInteractionFrameId = null
    const frame = frameId ? store.graph.getNode(frameId) : null
    if (!frameId || !frame || !isSelected(frameId) || modeFor(frameId) !== 'design') return
    if (isSmylrProductionFrame(frame)) activateSmylrMode(frameId, 'interact')
  },
  SMYLR_DOUBLE_CLICK_WINDOW_MS,
  { immediate: false }
)

const shapes = computed(() => {
  void syncTick.value
  void store.state.currentPageId
  return codeObjectFramesForOverlay(store.graph, store.state.currentPageId)
})

const frameTransform = createCodeObjectTransformController(store, scheduleSync)

function sync() {
  syncTick.value += 1
}

function syncPresentationFrame(presentation: EditorPresentationFrame) {
  presentationViewport.value = {
    panX: presentation.viewport.x,
    panY: presentation.viewport.y,
    zoom: presentation.viewport.zoom
  }
  sync()
}

function scheduleSync() {
  scheduleEditorPresentationFrame(store, syncPresentationFrame)
}

function modeFor(frameId: string): CodeObjectInteractionMode {
  return modeByFrame.value[frameId] ?? 'design'
}

function isSmylrProductionFrame(frame: SceneNode) {
  return isSmylrProductionAppCodeObjectFrame(frame)
}

function smylrProductionRoute(frame: SceneNode) {
  const document = codeObjectDocument(frame)
  return document?.component === 'smylr-production-app' ? document.route : '/'
}

function smylrRuntimeKey(frameId: string) {
  const workspaceId = readOpenPencilWorkspaceIdentity(store.graph)?.workspaceId ?? 'local-document'
  return `${workspaceId}:${frameId}`
}

function selectedSmylrFrameId() {
  if (store.state.selectedIds.size !== 1) return null
  const [selectedId] = store.state.selectedIds
  const selected = selectedId ? store.graph.getNode(selectedId) : null
  return selected && isSmylrProductionFrame(selected) ? selected.id : null
}

function reconcileSmylrRuntimes(activeFrameId = selectedSmylrFrameId()) {
  const frameIds = shapes.value
    .filter((frame) => isSmylrProductionFrame(frame))
    .map((frame) => frame.id)
  residentSmylrFrameIds.value = reconcileTrustedWebAppResidency({
    activeFrameId,
    frameIds,
    interactedAtByFrame: smylrInteractionOrder.value,
    residentFrameIds: residentSmylrFrameIds.value
  })
}

function promoteSmylrRuntime(frameId: string) {
  interactionSequence += 1
  smylrInteractionOrder.value = {
    ...smylrInteractionOrder.value,
    [frameId]: interactionSequence
  }
  reconcileSmylrRuntimes(frameId)
}

function isSmylrRuntimeResident(frameId: string) {
  return residentSmylrFrameIds.value.has(frameId)
}

function codeObjectTitle(frame: SceneNode) {
  return codeObjectDocument(frame)?.name ?? frame.name
}

function isSmylrContainerMode(frame: SceneNode) {
  return (
    isSmylrProductionFrame(frame) &&
    liveInspectorActiveFrameId.value === frame.id &&
    liveInspectorInteractionMode.value === 'select'
  )
}

function surfaceAcceptsPointer(frame: SceneNode) {
  return modeFor(frame.id) === 'interact' || isSmylrContainerMode(frame)
}

function isSelected(frameId: string) {
  return store.state.selectedIds.has(frameId)
}

function setMode(frameId: string, mode: CodeObjectInteractionMode) {
  const frame = store.graph.getNode(frameId)
  if (frame && isSmylrProductionFrame(frame)) promoteSmylrRuntime(frameId)
  store.select([frameId])
  modeByFrame.value = { ...modeByFrame.value, [frameId]: mode }
  if (frame && isSmylrProductionFrame(frame)) {
    setLiveInspectorActiveFrame(frameId)
    setLiveInspectorInteractionMode(mode === 'interact' ? 'interact' : 'frame')
  }
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

function surfaceCanvasStyle(frame: SceneNode) {
  return codeObjectCanvasStyle(store, frame, presentationViewport.value)
}

function surfaceOverlayStyle(frame: SceneNode) {
  return codeObjectScreenOverlayStyle(store, frame, presentationViewport.value)
}

function resizeHandles(frame: SceneNode) {
  return codeObjectResizeHandles(frame, presentationViewport.value.zoom)
}

function rotationHandles(frame: SceneNode) {
  return codeObjectRotationHandles(frame, presentationViewport.value.zoom)
}

function renderFrame(frame: SceneNode) {
  const shape = codeObjectDocument(frame)
  if (!shape) return
  if (shape.component === 'smylr-production-app') {
    disposeCodeObject(frame.id)
    return
  }
  const contentSource = readContentSource(frame)
  const assetHash = contentSource ? assetHashFromReference(contentSource.source) : null
  const dispatchBoardAction = async (action: Parameters<typeof dispatchCodeObjectBoardAction>[2]) =>
    dispatchCodeObjectBoardAction(store, frame.id, action, {
      interactionEnabled: modeFor(frame.id) === 'interact'
    })
  renderCodeObject(frame.id, shape, (state) => commitShapeState(frame.id, state), {
    board: createCodeObjectBoardClient(store, frame.id, dispatchBoardAction),
    bytes: assetHash ? store.graph.images.get(assetHash) : undefined,
    dispatchBoardAction,
    fileName: contentSource?.fileName ?? undefined,
    interactionEnabled: modeFor(frame.id) === 'interact',
    onExtractPdfPage: (pageNumber, image) => extractPdfPage(frame.id, pageNumber, image)
  })
  requestAnimationFrame(notifyCodeObjectInspectorChanged)
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

function reconcileCurrentBoardRuntimes() {
  const currentFrameIds = new Set(shapes.value.map((frame) => frame.id))
  const reactRuntimeFrameIds = new Set(
    shapes.value.flatMap((frame) =>
      codeObjectDocument(frame)?.component === 'smylr-production-app' ? [] : [frame.id]
    )
  )
  disposeCodeObjectsExcept(reactRuntimeFrameIds)
  modeByFrame.value = Object.fromEntries(
    Object.entries(modeByFrame.value).filter(([frameId]) => currentFrameIds.has(frameId))
  )
  smylrInteractionOrder.value = Object.fromEntries(
    Object.entries(smylrInteractionOrder.value).filter(([frameId]) => currentFrameIds.has(frameId))
  )
  reconcileSmylrRuntimes()
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
  const frame = store.graph.getNode(frameId)
  if (frame && isSmylrProductionFrame(frame)) {
    promoteSmylrRuntime(frameId)
    setLiveInspectorActiveFrame(frameId)
  }
  if (!isSelected(frameId)) store.select([frameId])
}

function activateSmylrMode(frameId: string, mode: 'frame' | 'select' | 'interact') {
  promoteSmylrRuntime(frameId)
  store.select([frameId])
  setLiveInspectorActiveFrame(frameId)
  setLiveInspectorInteractionMode(mode)
  modeByFrame.value = {
    ...modeByFrame.value,
    [frameId]: mode === 'interact' ? 'interact' : 'design'
  }
  if (mode === 'interact') requestAnimationFrame(() => focusCodeObject(frameId))
  sync()
}

function activatePassiveSmylrFrame(frameId: string) {
  promoteSmylrRuntime(frameId)
  store.select([frameId])
  setLiveInspectorActiveFrame(frameId)
  setLiveInspectorInteractionMode(modeFor(frameId) === 'interact' ? 'interact' : 'frame')
  sync()
}

function duplicateObject(frameId: string) {
  store.select([frameId])
  store.duplicateSelected()
  const [duplicateId] = [...store.state.selectedIds]
  const duplicate = duplicateId ? store.graph.getNode(duplicateId) : null
  if (duplicateId && isSmylrProductionAppCodeObjectFrame(duplicate)) {
    activateSmylrMode(duplicateId, 'frame')
  }
  toast.info('Code Object duplicated')
}

function resizeObjectViewport(frameId: string, presetId: CodeObjectViewportPresetId) {
  if (!applyCodeObjectViewportPreset(store, frameId, presetId)) return
  store.select([frameId])
  sync()
}

function beginSurfacePointerInteraction(frame: SceneNode, event: PointerEvent) {
  beginShapeMove(frame.id, event)
}

function cancelPendingSmylrInteraction() {
  stopSmylrInteraction()
  pendingSmylrInteractionFrameId = null
}

function scheduleSmylrInteraction(frameId: string) {
  stopSmylrInteraction()
  pendingSmylrInteractionFrameId = frameId
  startSmylrInteraction()
}

function enterSurfaceInteraction(frame: SceneNode) {
  cancelPendingSmylrInteraction()
  store.zoomToNode(frame.id, editorViewportInsets())
  if (isSmylrProductionFrame(frame)) {
    activateSmylrMode(frame.id, 'interact')
    return
  }
  enterInteraction(frame.id)
}

function beginShapeMove(frameId: string, event: PointerEvent) {
  const frame = store.graph.getNode(frameId)
  if (!frame || event.button !== 0) return
  cancelPendingSmylrInteraction()
  selectShape(frameId)
  moveDrag.value = createCodeObjectDesignGesture({
    frameId,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: frame.x,
    startY: frame.y
  })
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId)
}

function moveShape(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  const movement = moveCodeObjectDesignGesture(drag, event.clientX, event.clientY)
  moveDrag.value = movement.gesture
  if (!codeObjectDesignGestureDragged(movement.gesture)) return
  const zoom = Math.max(store.state.zoom, 0.01)
  store.graph.updateNodePreview(drag.frameId, {
    x: drag.startX + movement.dx / zoom,
    y: drag.startY + movement.dy / zoom
  })
  store.requestRepaint()
}

function endShapeMove(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  moveDrag.value = null
  const frame = store.graph.getNode(drag.frameId)
  if (!frame) return
  if (!codeObjectDesignGestureDragged(drag)) {
    if (isSmylrProductionFrame(frame)) scheduleSmylrInteraction(frame.id)
    return
  }
  const next = { x: frame.x, y: frame.y }
  store.graph.updateNodePreview(frame.id, { x: drag.startX, y: drag.startY })
  if (next.x !== drag.startX || next.y !== drag.startY) {
    store.updateNodeWithUndo(frame.id, next, 'Move code object')
  }
  scheduleSync()
}

function cancelShapeMove(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  moveDrag.value = null
  if (codeObjectDesignGestureDragged(drag)) {
    store.graph.updateNodePreview(drag.frameId, { x: drag.startX, y: drag.startY })
    store.requestRepaint()
  }
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
      if (!active && liveInspectorInteractionMode.value !== 'select') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (active) exitInteraction(active[0])
      else if (liveInspectorActiveFrameId.value) {
        activateSmylrMode(liveInspectorActiveFrameId.value, 'frame')
      }
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
      reconcileCurrentBoardRuntimes()
    }),
    store.onEditorEvent('page:changed', () => {
      sync()
      reconcileCurrentBoardRuntimes()
      renderVisibleFrames()
    }),
    store.onEditorEvent('node:created', () => {
      sync()
      renderVisibleFrames()
      reconcileSmylrRuntimes()
    }),
    store.onEditorEvent('node:deleted', (id) => {
      disposeCodeObject(id)
      sync()
      renderVisibleFrames()
      reconcileCurrentBoardRuntimes()
    }),
    store.onEditorEvent('node:reparented', sync),
    store.onEditorEvent('node:reordered', sync),
    store.onEditorEvent('node:previewUpdated', scheduleSync),
    store.onEditorEvent('node:updated', () => {
      sync()
      renderVisibleFrames()
    }),
    store.onEditorEvent('selection:changed', () => {
      if (
        pendingSmylrInteractionFrameId &&
        !store.state.selectedIds.has(pendingSmylrInteractionFrameId)
      ) {
        cancelPendingSmylrInteraction()
      }
      const selectedCodeObjectFrameId =
        store.state.selectedIds.size === 1 ? ([...store.state.selectedIds][0] ?? null) : null
      const interactionModes = reconcileCodeObjectInteractionModes(
        modeByFrame.value,
        selectedCodeObjectFrameId
      )
      modeByFrame.value = interactionModes.modes
      for (const frameId of interactionModes.deactivatedFrameIds) {
        const frame = store.graph.getNode(frameId)
        if (frame) renderFrame(frame)
      }

      const selectedSmylrId = selectedSmylrFrameId()
      if (selectedSmylrId) promoteSmylrRuntime(selectedSmylrId)
      else {
        setLiveInspectorActiveFrame(null)
        reconcileSmylrRuntimes()
      }
      sync()
    }),
    store.onEditorEvent('viewport:changed', scheduleSync),
    store.onEditorEvent('overlay:requested', scheduleSync),
    store.onEditorEvent('repaint:requested', scheduleSync)
  ]
  reconcileSmylrRuntimes()
  renderVisibleFrames()
})

onUnmounted(() => {
  cancelPendingSmylrInteraction()
  cancelEditorPresentationFrame(store, syncPresentationFrame)
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  disposeAllCodeObjects()
})
</script>

<template>
  <template v-for="frame in shapes" :key="frame.id">
    <div
      class="absolute top-0 left-0 overflow-hidden [&_[data-code-object-inspector-selected=true]]:outline [&_[data-code-object-inspector-selected=true]]:outline-2 [&_[data-code-object-inspector-selected=true]]:outline-violet-400 [&_[data-code-object-inspector-selected=true]]:outline-offset-[-2px]"
      :class="[
        surfaceAcceptsPointer(frame) ? 'pointer-events-auto' : 'pointer-events-none',
        modeFor(frame.id) === 'interact' ? 'z-[13]' : 'z-[4]'
      ]"
      :data-code-object-mode="modeFor(frame.id)"
      :data-code-object-id="frame.id"
      :data-test-id="`code-object-${frame.id}`"
      :style="surfaceCanvasStyle(frame)"
      @pointerdown.stop="selectShape(frame.id)"
      @wheel.prevent="handleSurfaceWheel"
    >
      <SmylrTrustedWebApp
        v-if="
          codeObjectDocument(frame)?.component === 'smylr-production-app' &&
          isSmylrRuntimeResident(frame.id)
        "
        :active="isSelected(frame.id)"
        :frame-id="frame.id"
        :interaction-enabled="modeFor(frame.id) === 'interact'"
        :route="smylrProductionRoute(frame)"
        :runtime-key="smylrRuntimeKey(frame.id)"
        @exit-interaction="exitInteraction(frame.id)"
        @interaction-start="activatePassiveSmylrFrame(frame.id)"
      />
      <div
        v-else-if="codeObjectDocument(frame)?.component === 'smylr-production-app'"
        class="flex size-full items-center justify-center bg-neutral-950 text-xs text-neutral-400"
        data-test-id="smylr-trusted-web-app-paused"
      >
        Paused · select to resume
      </div>
      <div v-else :ref="(value) => bindHost(frame.id, value)" class="size-full" />
    </div>

    <div
      class="pointer-events-none absolute top-0 left-0 z-[7]"
      :data-test-id="`code-object-overlay-${frame.id}`"
      :style="surfaceOverlayStyle(frame)"
    >
      <div
        v-if="modeFor(frame.id) === 'design' && !isSmylrContainerMode(frame)"
        class="pointer-events-auto absolute inset-0 z-[1]"
        :class="
          isSmylrProductionFrame(frame)
            ? 'cursor-pointer'
            : isSelected(frame.id)
              ? 'cursor-move'
              : 'cursor-default'
        "
        :aria-label="
          isSmylrProductionFrame(frame)
            ? `${frame.name}. Click to use app.`
            : `${frame.name}. Double-click to interact.`
        "
        data-test-id="code-object-design-hit-target"
        @dblclick.stop.prevent="enterSurfaceInteraction(frame)"
        @pointercancel.stop="cancelShapeMove"
        @pointerdown.stop="beginSurfacePointerInteraction(frame, $event)"
        @pointermove.stop.prevent="moveShape"
        @pointerup.stop.prevent="endShapeMove"
        @wheel.stop.prevent="handleSurfaceWheel"
      />
    </div>

    <div
      v-if="isSelected(frame.id) && modeFor(frame.id) === 'design' && !isSmylrContainerMode(frame)"
      class="pointer-events-none absolute top-0 left-0 z-[14] ring-1 ring-inset ring-violet-400/35"
      :data-test-id="`code-object-controls-${frame.id}`"
      :style="surfaceOverlayStyle(frame)"
    >
      <div class="pointer-events-auto absolute -top-9 left-0 z-30">
        <CodeObjectHeader
          :height="frame.height"
          :label="codeObjectTitle(frame)"
          :width="frame.width"
          @duplicate-object="duplicateObject(frame.id)"
          @resize-viewport="resizeObjectViewport(frame.id, $event)"
        />
      </div>

      <span
        v-for="handle in resizeHandles(frame)"
        :key="handle.id"
        class="pointer-events-auto absolute z-20 rounded-full border border-violet-400 bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.72)]"
        :class="
          handle.id === 'nw' || handle.id === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
        "
        :data-test-id="`code-object-resize-${handle.id}`"
        :style="{
          ...CODE_OBJECT_RESIZE_HANDLE_STYLE,
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
        :key="`rotate-${handle.id}`"
        class="pointer-events-auto absolute z-10 cursor-crosshair"
        :data-test-id="`code-object-rotate-${handle.id}`"
        :style="{
          ...CODE_OBJECT_ROTATE_HANDLE_STYLE,
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
