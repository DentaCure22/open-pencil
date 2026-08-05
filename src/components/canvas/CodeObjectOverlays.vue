<script setup lang="ts">
import { useEventListener, useTimeoutFn } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from 'vue'

import {
  DOUBLE_CLICK_FOCUS_MAX_ZOOM,
  DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
} from '@open-pencil/core/constants'
import { readContentSource } from '@open-pencil/core/io'
import { objectGraphEndpointVisualScale, type SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'
import {
  applyMoveSnap,
  cancelEditorPresentationFrame,
  scheduleEditorPresentationFrame
} from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { forwardFrameSurfaceWheel } from '@/app/editor/canvas/embedded-surface-wheel'
import { useEditorPresentationViewport } from '@/app/editor/presentation'
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
  createCodeObjectMoveDrag,
  moveCodeObjectDesignGesture,
  reconcileCodeObjectInteractionModes,
  type CodeObjectMoveDrag,
  type CodeObjectInteractionMode
} from '@/app/code-object/interaction'
import { codeObjectFramesForOverlay } from '@/app/code-object/overlays'
import { notifyCodeObjectInspectorChanged } from '@/app/code-object/inspector'
import { toast } from '@/app/shell/ui'
import {
  attachCodeObject,
  disposeAllCodeObjects,
  disposeCodeObject,
  focusCodeObject,
  refreshCodeObjectRuntimePortPresentation,
  renderCodeObject
} from '@/app/code-object/runtime'
import { placeExtractedPdfPage } from '@/app/media-evidence/extraction'
import type { PdfPageImage } from '@/app/media-evidence/pdf'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import { subscribeObjectGraphPortInvalidation } from '@/app/object-graph/port-presentation'
import {
  CODE_OBJECT_RESIZE_HANDLE_STYLE,
  CODE_OBJECT_ROTATE_HANDLE_STYLE,
  applyCodeObjectViewportPreset,
  codeObjectCanvasStyle,
  codeObjectResizeHandles,
  codeObjectRotationHandles,
  codeObjectScreenOverlayStyle,
  createCodeObjectTransformController,
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

import { useCodeObjectRuntimeResidency } from './useCodeObjectRuntimeResidency'
import { useTrustedWebAppRuntimeResidency } from './useTrustedWebAppRuntimeResidency'

const SMYLR_DOUBLE_CLICK_WINDOW_MS = 300
const CODE_OBJECT_HEADER_BOARD_HEIGHT = 32
const CODE_OBJECT_HEADER_BOARD_GAP = 4
const CODE_OBJECT_HEADER_VISUAL_SCALE = 0.8

type TemplateRefValue = Element | ComponentPublicInstance | null
type TemplateRefHandler = (value: TemplateRefValue) => void
type TemplateRefBinder = (frameId: string, value: TemplateRefValue) => void

const store = useEditorStore()
const syncTick = ref(0)
const modeByFrame = ref<Record<string, CodeObjectInteractionMode>>({})
const moveDrag = ref<CodeObjectMoveDrag | null>(null)
const pendingSmylrInteractionFrameId = ref<string | null>(null)
const smylrClickCandidateFrameId = ref<string | null>(null)
const presentationViewport = useEditorPresentationViewport(store)
let unsubscribe: Array<() => void> = []
let unsubscribePortInvalidation: (() => void) | null = null
let inspectorNotificationFrame: number | null = null
const boundRuntimeHosts = new Map<string, HTMLElement>()
const pendingPortPresentationFrameIds = new Set<string>()
const runtimeHostRefs = new Map<string, TemplateRefHandler>()
const surfaceHostRefs = new Map<string, TemplateRefHandler>()
const { start: startSmylrInteraction, stop: stopSmylrInteraction } = useTimeoutFn(
  () => {
    const frameId = pendingSmylrInteractionFrameId.value
    pendingSmylrInteractionFrameId.value = null
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
const documentByFrameId = computed(() => {
  void store.state.sceneVersion
  return new Map(shapes.value.map((frame) => [frame.id, codeObjectDocument(frame)]))
})

const frameTransform = createCodeObjectTransformController(store, scheduleSync)

function pinnedRuntimeFrameIds() {
  void syncTick.value
  const frameIds = new Set<string>()
  if (store.state.selectedIds.size === 1) {
    const [selectedId] = store.state.selectedIds
    if (selectedId) frameIds.add(selectedId)
  }
  if (moveDrag.value?.frameId) frameIds.add(moveDrag.value.frameId)
  if (frameTransform.drag.value?.frameId) frameIds.add(frameTransform.drag.value.frameId)
  for (const [frameId, mode] of Object.entries(modeByFrame.value)) {
    if (mode === 'interact') frameIds.add(frameId)
  }
  return frameIds
}

const runtimeResidency = useCodeObjectRuntimeResidency({
  frames: shapes,
  pinnedFrameIds: pinnedRuntimeFrameIds,
  store
})
const runtimeActiveFrameIds = runtimeResidency.activeFrameIds
const bindSurfaceHost = runtimeResidency.bindSurfaceHost
const smylrRuntimeResidency = useTrustedWebAppRuntimeResidency({
  activeFrameIds: runtimeActiveFrameIds,
  frames: shapes,
  store
})
const isSmylrRuntimeResident = smylrRuntimeResidency.isResident
const promoteSmylrRuntime = smylrRuntimeResidency.promote
const reconcileSmylrRuntimes = smylrRuntimeResidency.reconcile
const selectedSmylrFrameId = smylrRuntimeResidency.selectedFrameId

function sync() {
  syncTick.value += 1
}

function syncPresentationFrame() {
  const pendingFrameIds = [...pendingPortPresentationFrameIds]
  pendingPortPresentationFrameIds.clear()
  for (const frameId of pendingFrameIds) {
    if (isRuntimeActive(frameId)) refreshCodeObjectRuntimePortPresentation(frameId)
  }
}

function scheduleSync() {
  scheduleEditorPresentationFrame(store, syncPresentationFrame)
}

function cachedTemplateRef(
  refs: Map<string, TemplateRefHandler>,
  frameId: string,
  bind: TemplateRefBinder
): TemplateRefHandler {
  const existing = refs.get(frameId)
  if (existing) return existing
  const handler: TemplateRefHandler = (value) => bind(frameId, value)
  refs.set(frameId, handler)
  return handler
}

function surfaceHostRef(frameId: string): TemplateRefHandler {
  return cachedTemplateRef(surfaceHostRefs, frameId, bindSurfaceHost)
}

function runtimeHostRef(frameId: string): TemplateRefHandler {
  return cachedTemplateRef(runtimeHostRefs, frameId, bindHost)
}

function modeFor(frameId: string): CodeObjectInteractionMode {
  return modeByFrame.value[frameId] ?? 'design'
}

function isSmylrProductionFrame(frame: SceneNode) {
  return documentFor(frame)?.component === 'smylr-production-app'
}

function documentFor(frame: SceneNode) {
  return documentByFrameId.value.get(frame.id) ?? null
}

function smylrProductionRoute(frame: SceneNode) {
  const document = documentFor(frame)
  return document?.component === 'smylr-production-app' ? document.route : '/'
}

function smylrRuntimeKey(frameId: string) {
  const workspaceId = readOpenPencilWorkspaceIdentity(store.graph)?.workspaceId ?? 'local-document'
  return `${workspaceId}:${frameId}`
}

function isRuntimeActive(frameId: string) {
  return runtimeActiveFrameIds.value.has(frameId)
}

function codeObjectTitle(frame: SceneNode) {
  return documentFor(frame)?.name ?? frame.name
}

function isSmylrContainerMode(frame: SceneNode) {
  return (
    isSmylrProductionFrame(frame) &&
    liveInspectorActiveFrameId.value === frame.id &&
    liveInspectorInteractionMode.value === 'select'
  )
}

function surfaceAcceptsPointer(frame: SceneNode) {
  return (
    store.state.activeTool === 'SELECT' &&
    (modeFor(frame.id) === 'interact' || isSmylrContainerMode(frame))
  )
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

function headerScale(frame: SceneNode) {
  return (
    Math.max(0.01, presentationViewport.value.zoom) *
    objectGraphEndpointVisualScale(frame) *
    CODE_OBJECT_HEADER_VISUAL_SCALE
  )
}

function headerCanvasStyle(frame: SceneNode) {
  const scale = headerScale(frame)
  return {
    top: `${-(CODE_OBJECT_HEADER_BOARD_HEIGHT + CODE_OBJECT_HEADER_BOARD_GAP) * scale}px`,
    transform: `scale(${scale})`,
    transformOrigin: 'top left'
  }
}

function resizeHandles(frame: SceneNode) {
  return codeObjectResizeHandles(frame, presentationViewport.value.zoom)
}

function rotationHandles(frame: SceneNode) {
  return codeObjectRotationHandles(frame, presentationViewport.value.zoom)
}

function showsTransformControls(frame: SceneNode) {
  return (
    store.state.activeTool === 'SELECT' &&
    isSelected(frame.id) &&
    modeFor(frame.id) === 'design' &&
    !isSmylrContainerMode(frame) &&
    smylrClickCandidateFrameId.value !== frame.id &&
    pendingSmylrInteractionFrameId.value !== frame.id
  )
}

function renderFrame(frame: SceneNode) {
  if (!isRuntimeActive(frame.id)) {
    disposeCodeObject(frame.id)
    return
  }
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
  scheduleInspectorNotification()
}

function scheduleInspectorNotification() {
  if (inspectorNotificationFrame !== null) return
  inspectorNotificationFrame = requestAnimationFrame(() => {
    inspectorNotificationFrame = null
    notifyCodeObjectInspectorChanged()
  })
}

function extractPdfPage(frameId: string, pageNumber: number, image: PdfPageImage) {
  const frame = store.graph.getNode(frameId)
  const source = frame ? mediaEvidenceSource(frame) : null
  if (!frame || source?.kind !== 'pdf') return
  placeExtractedPdfPage(store, frame, source, pageNumber, image)
}

function renderActiveFrames() {
  for (const frame of shapes.value) {
    if (isRuntimeActive(frame.id)) renderFrame(frame)
  }
}

function reconcileCurrentBoardRuntimes() {
  const currentFrameIds = new Set(shapes.value.map((frame) => frame.id))
  modeByFrame.value = Object.fromEntries(
    Object.entries(modeByFrame.value).filter(([frameId]) => currentFrameIds.has(frameId))
  )
  for (const frameId of boundRuntimeHosts.keys()) {
    if (currentFrameIds.has(frameId)) continue
    boundRuntimeHosts.delete(frameId)
    pendingPortPresentationFrameIds.delete(frameId)
    disposeCodeObject(frameId)
  }
  for (const refs of [runtimeHostRefs, surfaceHostRefs]) {
    for (const frameId of refs.keys()) {
      if (!currentFrameIds.has(frameId)) refs.delete(frameId)
    }
  }
  smylrRuntimeResidency.retainCurrentFrames()
}

function bindHost(frameId: string, value: TemplateRefValue) {
  const host = value instanceof HTMLElement ? value : null
  const previous = boundRuntimeHosts.get(frameId)
  if (previous === host) return
  if (!host) {
    boundRuntimeHosts.delete(frameId)
    pendingPortPresentationFrameIds.delete(frameId)
    disposeCodeObject(frameId)
    return
  }
  boundRuntimeHosts.set(frameId, host)
  attachCodeObject(frameId, host)
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
  pendingSmylrInteractionFrameId.value = null
  smylrClickCandidateFrameId.value = null
}

function scheduleSmylrInteraction(frameId: string) {
  stopSmylrInteraction()
  pendingSmylrInteractionFrameId.value = frameId
  smylrClickCandidateFrameId.value = null
  startSmylrInteraction()
}

function enterSurfaceInteraction(frame: SceneNode) {
  cancelPendingSmylrInteraction()
  store.zoomToNode(frame.id, editorViewportInsets(), {
    maxZoom: DOUBLE_CLICK_FOCUS_MAX_ZOOM,
    zoomMultiplier: DOUBLE_CLICK_FOCUS_ZOOM_MULTIPLIER
  })
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
  if (isSmylrProductionFrame(frame)) smylrClickCandidateFrameId.value = frameId
  selectShape(frameId)
  store.setSnapGuides([])
  moveDrag.value = createCodeObjectMoveDrag({
    frame,
    pageId: store.state.currentPageId,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY
  })
  const target = event.currentTarget
  if (target instanceof HTMLElement) target.setPointerCapture(event.pointerId)
}

function moveShape(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  const movement = moveCodeObjectDesignGesture(drag, event.clientX, event.clientY)
  moveDrag.value = { ...drag, ...movement.gesture }
  if (!codeObjectDesignGestureDragged(movement.gesture)) return
  if (smylrClickCandidateFrameId.value === drag.frameId) {
    smylrClickCandidateFrameId.value = null
  }
  const zoom = Math.max(store.state.zoom, 0.01)
  const snapped = applyMoveSnap(drag.snapInput, movement.dx / zoom, movement.dy / zoom, store)
  store.graph.updateNodePositionPreview(
    drag.frameId,
    drag.startX + snapped.dx,
    drag.startY + snapped.dy
  )
  store.requestRepaint()
}

function endShapeMove(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  moveDrag.value = null
  store.setSnapGuides([])
  const frame = store.graph.getNode(drag.frameId)
  if (!frame) return
  if (!codeObjectDesignGestureDragged(drag)) {
    if (isSmylrProductionFrame(frame)) scheduleSmylrInteraction(frame.id)
    return
  }
  smylrClickCandidateFrameId.value = null
  const next = store.graph.getPresentedNodePosition(frame.id)
  store.graph.clearNodePositionPresentation(frame.id)
  if (next.x !== drag.startX || next.y !== drag.startY) {
    store.updateNodeWithUndo(frame.id, next, 'Move code object')
  }
  scheduleSync()
}

function cancelShapeMove(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  moveDrag.value = null
  store.setSnapGuides([])
  smylrClickCandidateFrameId.value = null
  if (codeObjectDesignGestureDragged(drag)) {
    store.graph.clearNodePositionPresentation(drag.frameId)
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

watch(runtimeActiveFrameIds, () => reconcileSmylrRuntimes(), { immediate: true })

onMounted(() => {
  unsubscribePortInvalidation = subscribeObjectGraphPortInvalidation((frameId) => {
    if (!isRuntimeActive(frameId)) return
    pendingPortPresentationFrameIds.add(frameId)
    scheduleSync()
  })
  unsubscribe = [
    store.onEditorEvent('graph:replaced', () => {
      disposeAllCodeObjects()
      pendingPortPresentationFrameIds.clear()
      sync()
      reconcileCurrentBoardRuntimes()
      for (const [frameId, host] of boundRuntimeHosts) {
        if (!isRuntimeActive(frameId)) continue
        attachCodeObject(frameId, host)
        const frame = store.graph.getNode(frameId)
        if (frame) renderFrame(frame)
      }
    }),
    store.onEditorEvent('page:changed', () => {
      sync()
      reconcileCurrentBoardRuntimes()
      renderActiveFrames()
    }),
    store.onEditorEvent('node:created', () => {
      sync()
      renderActiveFrames()
      reconcileSmylrRuntimes()
    }),
    store.onEditorEvent('node:deleted', (id) => {
      boundRuntimeHosts.delete(id)
      pendingPortPresentationFrameIds.delete(id)
      runtimeHostRefs.delete(id)
      surfaceHostRefs.delete(id)
      disposeCodeObject(id)
      sync()
      renderActiveFrames()
      reconcileCurrentBoardRuntimes()
    }),
    store.onEditorEvent('node:reparented', sync),
    store.onEditorEvent('node:reordered', sync),
    store.onEditorEvent('node:previewUpdated', scheduleSync),
    store.onEditorEvent('node:updated', () => {
      sync()
      renderActiveFrames()
    }),
    store.onEditorEvent('selection:changed', () => {
      if (
        pendingSmylrInteractionFrameId.value &&
        !store.state.selectedIds.has(pendingSmylrInteractionFrameId.value)
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
        if (frame && isRuntimeActive(frame.id)) renderFrame(frame)
      }

      const selectedSmylrId = selectedSmylrFrameId()
      if (selectedSmylrId) promoteSmylrRuntime(selectedSmylrId)
      else {
        setLiveInspectorActiveFrame(null)
        reconcileSmylrRuntimes()
      }
      sync()
    }),
    store.onEditorEvent('tool:changed', sync),
    store.onEditorEvent('viewport:changed', scheduleSync),
    store.onEditorEvent('overlay:requested', scheduleSync),
    store.onEditorEvent('repaint:requested', scheduleSync)
  ]
  reconcileSmylrRuntimes()
  renderActiveFrames()
})

onUnmounted(() => {
  cancelPendingSmylrInteraction()
  store.setSnapGuides([])
  cancelEditorPresentationFrame(store, syncPresentationFrame)
  if (inspectorNotificationFrame !== null) cancelAnimationFrame(inspectorNotificationFrame)
  inspectorNotificationFrame = null
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  unsubscribePortInvalidation?.()
  unsubscribePortInvalidation = null
  boundRuntimeHosts.clear()
  pendingPortPresentationFrameIds.clear()
  runtimeHostRefs.clear()
  surfaceHostRefs.clear()
  disposeAllCodeObjects()
})
</script>

<template>
  <template v-for="frame in shapes" :key="frame.id">
    <div
      :ref="surfaceHostRef(frame.id)"
      class="absolute top-0 left-0 overflow-hidden [&_[data-code-object-inspector-selected=true]]:outline [&_[data-code-object-inspector-selected=true]]:outline-2 [&_[data-code-object-inspector-selected=true]]:outline-violet-400 [&_[data-code-object-inspector-selected=true]]:outline-offset-[-2px]"
      :class="[
        surfaceAcceptsPointer(frame) ? 'pointer-events-auto' : 'pointer-events-none',
        modeFor(frame.id) === 'interact' ? 'z-[13]' : 'z-[4]'
      ]"
      :data-code-object-mode="modeFor(frame.id)"
      :data-code-object-id="frame.id"
      :data-code-object-runtime-active="isRuntimeActive(frame.id)"
      :data-test-id="`code-object-${frame.id}`"
      :style="surfaceCanvasStyle(frame)"
      @pointerdown.stop="selectShape(frame.id)"
      @wheel.prevent="handleSurfaceWheel"
    >
      <SmylrTrustedWebApp
        v-if="
          isSmylrProductionFrame(frame) &&
          isRuntimeActive(frame.id) &&
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
        v-else-if="isSmylrProductionFrame(frame)"
        class="flex size-full items-center justify-center bg-neutral-950 text-xs text-neutral-400"
        data-test-id="smylr-trusted-web-app-paused"
      >
        Paused · select to resume
      </div>
      <div
        v-else-if="isRuntimeActive(frame.id)"
        :ref="runtimeHostRef(frame.id)"
        class="size-full"
      />
      <div v-else class="size-full" data-test-id="code-object-runtime-paused" />
    </div>

    <div
      class="pointer-events-none absolute top-0 left-0 z-[7]"
      :data-test-id="`code-object-overlay-${frame.id}`"
      :style="surfaceOverlayStyle(frame)"
    >
      <div
        v-if="modeFor(frame.id) === 'design' && !isSmylrContainerMode(frame)"
        class="absolute inset-0 z-[1]"
        :class="[
          store.state.activeTool === 'SELECT' ? 'pointer-events-auto' : 'pointer-events-none',
          isSmylrProductionFrame(frame)
            ? 'cursor-pointer'
            : isSelected(frame.id)
              ? 'cursor-move'
              : 'cursor-default'
        ]"
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

    <!-- The Board-owned header is the selected Code Object's only chrome owner.
         It persists through Design, Interact, and semantic container focus.
         Transform controls remain Design-only. -->
    <div
      v-if="isSelected(frame.id)"
      class="pointer-events-none absolute top-0 left-0 z-[15]"
      :data-test-id="`code-object-header-owner-${frame.id}`"
      :style="surfaceOverlayStyle(frame)"
    >
      <div
        class="absolute top-0 left-0 z-30"
        :class="store.state.activeTool === 'SELECT' ? 'pointer-events-auto' : 'pointer-events-none'"
        :data-object-scale="headerScale(frame)"
        :style="headerCanvasStyle(frame)"
      >
        <CodeObjectHeader
          :height="frame.height"
          :label="codeObjectTitle(frame)"
          :mode="modeFor(frame.id)"
          :width="frame.width"
          @duplicate-object="duplicateObject(frame.id)"
          @resize-viewport="resizeObjectViewport(frame.id, $event)"
        />
      </div>
    </div>

    <div
      v-if="showsTransformControls(frame)"
      class="pointer-events-none absolute top-0 left-0 z-[14] ring-1 ring-inset ring-violet-400/35"
      :data-test-id="`code-object-controls-${frame.id}`"
      :style="surfaceOverlayStyle(frame)"
    >
      <span
        v-for="handle in resizeHandles(frame)"
        :key="handle.id"
        class="openpencil-control-node openpencil-control-node-transform pointer-events-auto absolute z-20"
        :class="
          handle.id === 'nw' || handle.id === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
        "
        :data-test-id="`code-object-resize-${handle.id}`"
        :style="{
          ...CODE_OBJECT_RESIZE_HANDLE_STYLE,
          left: `${handle.x}px`,
          top: `${handle.y}px`,
          transform: `${handle.transform} scale(var(--openpencil-control-node-scale))`
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
