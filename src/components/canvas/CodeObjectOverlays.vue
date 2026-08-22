<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type ComponentPublicInstance,
  type CSSProperties
} from 'vue'

import { readContentSource } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'
import { applyMoveReparent, applyMoveSnap } from '@open-pencil/vue'

import { useEditorStore } from '@/app/editor/active-store'
import { forwardFrameSurfaceWheel } from '@/app/editor/canvas/embedded-surface-wheel'
import { focusCanvasSurface } from '@/app/editor/canvas/surface/focus'
import { closeCodeObjectFullFrame, fullFrameCodeObjectId } from '@/app/code-object/full-frame'
import {
  codeObjectDocument,
  createCodeObjectBoardClient,
  dispatchCodeObjectBoardAction,
  isCodeObjectFrame,
  updateCodeObjectState,
  type CodeObjectState
} from '@/app/code-object/model'
import {
  activeCodeObjectInteractionFrameId,
  codeObjectDesignGestureDragged,
  codeObjectWheelOwner,
  createCodeObjectMoveDrag,
  moveCodeObjectDesignGesture,
  reconcileCodeObjectInteractionModes,
  type CodeObjectMoveDrag,
  type CodeObjectInteractionMode
} from '@/app/code-object/interaction'
import { codeObjectFramesForOverlay } from '@/app/code-object/overlays'
import { notifyCodeObjectInspectorChanged } from '@/app/code-object/inspector'
import {
  isSmylrComponentCodeObject,
  smylrComponentRuntimeHeight
} from '@/app/smylr-component-library/runtime'
import { useAppTheme } from '@/app/shell/theme'
import { navigateBoardSelection } from '@/app/shell/keyboard/nudging'
import {
  loadCodeObjectRuntime,
  loadedCodeObjectRuntime,
  type CodeObjectRuntimeModule
} from '@/app/code-object/runtime'
import { placeExtractedPdfPage } from '@/app/media-evidence/extraction'
import type { PdfPageImage } from '@/app/media-evidence/pdf'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import { codeObjectCanvasStyle, liveIframeHostStyle } from '@/app/code-object/transform'
import {
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import { readOpenPencilWorkspaceIdentity } from '@/app/workspace-document/identity'
import { agentBoardObjectDocument } from '@/app/agent-terminal/board-object'
import AgentConversationBoardSurface from '@/components/agent-terminal/AgentConversationBoardSurface.vue'
import SmylrTrustedWebApp from '@/components/code-object/SmylrTrustedWebApp.vue'
import CodeObjectTransformControls from '@/components/code-object/CodeObjectTransformControls.vue'

import { useCodeObjectRuntimeResidency } from './useCodeObjectRuntimeResidency'
import { useTrustedWebAppRuntimeResidency } from './useTrustedWebAppRuntimeResidency'

type TemplateRefValue = Element | ComponentPublicInstance | null
type TemplateRefHandler = (value: TemplateRefValue) => void
type TemplateRefBinder = (frameId: string, value: TemplateRefValue) => void

const store = useEditorStore()
const { resolvedTheme } = useAppTheme()
const syncTick = ref(0)
const modeByFrame = ref<Record<string, CodeObjectInteractionMode>>({})
const moveDrag = ref<CodeObjectMoveDrag | null>(null)
const interactionClickCandidateFrameId = ref<string | null>(null)
const directInteractionStartedAtByFrame = new Map<string, number>()
let unsubscribe: Array<() => void> = []
let inspectorNotificationFrame: number | null = null
let runtimeRenderFrame: number | null = null
let mounted = false
const pendingRuntimeRenderFrameIds = new Set<string>()
const boundRuntimeHosts = new Map<string, HTMLElement>()
const runtimeHostRefs = new Map<string, TemplateRefHandler>()
const surfaceHostRefs = new Map<string, TemplateRefHandler>()

const shapes = computed(() => {
  void syncTick.value
  void store.state.currentPageId
  return codeObjectFramesForOverlay(store.graph, store.state.currentPageId)
})
const documentByFrameId = computed(() => {
  void store.state.sceneVersion
  return new Map(shapes.value.map((frame) => [frame.id, codeObjectDocument(frame)]))
})

function pinnedRuntimeFrameIds() {
  void syncTick.value
  const frameIds = new Set<string>()
  if (store.state.selectedIds.size === 1) {
    const [selectedId] = store.state.selectedIds
    if (selectedId) frameIds.add(selectedId)
  }
  if (moveDrag.value?.frameId) frameIds.add(moveDrag.value.frameId)
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
const runtimeBindSurfaceHost = runtimeResidency.bindSurfaceHost
const boundSurfaceHosts = new Map<string, HTMLElement>()
function bindSurfaceHost(frameId: string, value: TemplateRefValue) {
  const host = value instanceof HTMLElement ? value : null
  if (host) boundSurfaceHosts.set(frameId, host)
  else boundSurfaceHosts.delete(frameId)
  runtimeBindSurfaceHost(frameId, value)
}
const smylrRuntimeResidency = useTrustedWebAppRuntimeResidency({
  activeFrameIds: runtimeResidency.relevantFrameIds,
  documentVisible: runtimeResidency.documentVisible,
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

function agentDocumentFor(frame: SceneNode) {
  return agentBoardObjectDocument(frame)
}

function agentWorkerConversationId(frame: SceneNode) {
  const document = agentDocumentFor(frame)
  return document?.component === 'agent-conversation-terminal'
    ? document.workerConversationId
    : undefined
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

function isSmylrContainerMode(frame: SceneNode) {
  return (
    isSmylrProductionFrame(frame) &&
    liveInspectorActiveFrameId.value === frame.id &&
    liveInspectorInteractionMode.value === 'select'
  )
}

function surfaceAcceptsPointer(frame: SceneNode) {
  return (
    isSmylrContainerMode(frame) ||
    (store.state.activeTool === 'SELECT' && modeFor(frame.id) === 'interact')
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
  activeCodeObjectInteractionFrameId.value = mode === 'interact' ? frameId : null
  if (frame && isSmylrProductionFrame(frame)) {
    setLiveInspectorActiveFrame(frameId)
    setLiveInspectorInteractionMode(mode === 'interact' ? 'interact' : 'frame')
  }
  if (frame) void renderFrame(frame)
  if (mode === 'interact' && frame && !agentDocumentFor(frame)) {
    requestAnimationFrame(() => focusCodeObject(frameId))
  }
  sync()
}

function enterInteraction(frameId: string) {
  setMode(frameId, 'interact')
}

function exitInteraction(frameId: string) {
  directInteractionStartedAtByFrame.delete(frameId)
  const activeElement = document.activeElement
  const surface = boundSurfaceHosts.get(frameId)
  if (activeElement instanceof HTMLElement && surface?.contains(activeElement)) {
    activeElement.blur()
  }
  setMode(frameId, 'design')
}

function exitSurfaceInteraction(frameId: string) {
  closeCodeObjectFullFrame(frameId)
  exitInteraction(frameId)
}

function surfaceCanvasStyle(frame: SceneNode) {
  if (fullFrameCodeObjectId.value === frame.id) {
    return {
      backfaceVisibility: 'hidden',
      borderRadius: '0px',
      contain: 'layout paint',
      height: '100%',
      inset: '0px',
      opacity: '1',
      transform: 'none',
      transformOrigin: 'top left',
      width: '100%'
    } satisfies CSSProperties
  }
  return codeObjectCanvasStyle(store, frame)
}

function runtimeSurfaceCanvasStyle(frame: SceneNode) {
  const style = surfaceCanvasStyle(frame)
  const liveHost =
    isSmylrProductionFrame(frame) || isSmylrComponentCodeObject(frame)
      ? liveIframeHostStyle(style)
      : style
  if (!isSmylrComponentCodeObject(frame) || fullFrameCodeObjectId.value === frame.id) {
    return liveHost
  }
  return {
    ...liveHost,
    height: `${smylrComponentRuntimeHeight(frame, modeFor(frame.id) === 'interact')}px`
  } satisfies CSSProperties
}

function showsTransformControls(frame: SceneNode) {
  return (
    store.state.activeTool === 'SELECT' &&
    isSelected(frame.id) &&
    fullFrameCodeObjectId.value !== frame.id &&
    modeFor(frame.id) === 'design' &&
    !isSmylrContainerMode(frame)
  )
}

function disposeCodeObject(frameId: string) {
  return loadedCodeObjectRuntime()?.disposeCodeObject(frameId) ?? false
}

function disposeAllCodeObjects() {
  loadedCodeObjectRuntime()?.disposeAllCodeObjects()
}

function focusCodeObject(frameId: string) {
  return loadedCodeObjectRuntime()?.focusCodeObject(frameId) ?? false
}

async function renderFrameWithRuntime(runtime: CodeObjectRuntimeModule, frame: SceneNode) {
  const currentFrame = store.graph.getNode(frame.id)
  if (!mounted || !currentFrame || !isRuntimeActive(frame.id)) {
    runtime.disposeCodeObject(frame.id)
    return
  }
  const shape = codeObjectDocument(currentFrame)
  if (!shape) return
  if (
    shape.component === 'smylr-production-app' ||
    shape.component === 'agent-conversation-terminal'
  ) {
    runtime.disposeCodeObject(frame.id)
    return
  }
  const contentSource = readContentSource(currentFrame)
  const assetHash = contentSource ? assetHashFromReference(contentSource.source) : null
  const dispatchBoardAction = async (action: Parameters<typeof dispatchCodeObjectBoardAction>[2]) =>
    dispatchCodeObjectBoardAction(store, currentFrame.id, action, {
      interactionEnabled: modeFor(currentFrame.id) === 'interact'
    })
  runtime.renderCodeObject(
    currentFrame.id,
    shape,
    (state) => commitShapeState(currentFrame.id, state),
    {
      board: createCodeObjectBoardClient(store, currentFrame.id, dispatchBoardAction),
      bytes: assetHash ? store.graph.images.get(assetHash) : undefined,
      dispatchBoardAction,
      fileName: contentSource?.fileName ?? undefined,
      interactionEnabled: modeFor(currentFrame.id) === 'interact',
      onExtractPdfPage: (pageNumber, image) => extractPdfPage(currentFrame.id, pageNumber, image),
      theme: resolvedTheme.value
    }
  )
  if (modeFor(currentFrame.id) === 'interact') {
    requestAnimationFrame(() => runtime.focusCodeObject(currentFrame.id))
  }
  scheduleInspectorNotification()
}

async function renderFrame(frame: SceneNode) {
  if (!isRuntimeActive(frame.id)) {
    disposeCodeObject(frame.id)
    return
  }
  const shape = codeObjectDocument(frame)
  if (!shape) return
  if (
    shape.component === 'smylr-production-app' ||
    shape.component === 'agent-conversation-terminal'
  ) {
    disposeCodeObject(frame.id)
    return
  }
  try {
    await renderFrameWithRuntime(await loadCodeObjectRuntime(), frame)
  } catch (error) {
    console.error('[code-object] Runtime failed to load', error)
  }
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
    if (isRuntimeActive(frame.id)) void renderFrame(frame)
  }
}

function scheduleRuntimeRender(frameId: string) {
  pendingRuntimeRenderFrameIds.add(frameId)
  if (runtimeRenderFrame !== null) return
  runtimeRenderFrame = requestAnimationFrame(() => {
    runtimeRenderFrame = null
    const frameIds = [...pendingRuntimeRenderFrameIds]
    pendingRuntimeRenderFrameIds.clear()
    for (const pendingFrameId of frameIds) {
      const frame = store.graph.getNode(pendingFrameId)
      if (frame && isCodeObjectFrame(frame) && isRuntimeActive(frame.id)) void renderFrame(frame)
    }
  })
}

function reconcileCurrentBoardRuntimes() {
  const currentFrameIds = new Set(shapes.value.map((frame) => frame.id))
  modeByFrame.value = Object.fromEntries(
    Object.entries(modeByFrame.value).filter(([frameId]) => currentFrameIds.has(frameId))
  )
  for (const frameId of boundRuntimeHosts.keys()) {
    if (currentFrameIds.has(frameId)) continue
    boundRuntimeHosts.delete(frameId)
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
    disposeCodeObject(frameId)
    return
  }
  boundRuntimeHosts.set(frameId, host)
  void loadCodeObjectRuntime()
    .then((runtime) => {
      if (!mounted || boundRuntimeHosts.get(frameId) !== host || !isRuntimeActive(frameId)) {
        return undefined
      }
      runtime.attachCodeObject(frameId, host)
      const frame = store.graph.getNode(frameId)
      if (frame) void renderFrameWithRuntime(runtime, frame)
      return undefined
    })
    .catch((error: unknown) => {
      console.error('[code-object] Runtime failed to load', error)
    })
}

function commitShapeState(frameId: string, state: CodeObjectState) {
  updateCodeObjectState(store, frameId, state)
}

function handleCanvasSurfaceWheel(event: WheelEvent) {
  const source = event.currentTarget
  if (source instanceof HTMLElement) forwardFrameSurfaceWheel(source, event)
}

function handleSurfaceWheel(frame: SceneNode, event: WheelEvent) {
  const document = documentFor(frame)
  if (
    (modeFor(frame.id) === 'interact' && document?.component === 'agent-conversation-terminal') ||
    codeObjectWheelOwner(modeFor(frame.id), document?.surface?.overflow) === 'content'
  ) {
    event.stopPropagation()
    return
  }
  event.preventDefault()
  handleCanvasSurfaceWheel(event)
}

function handleDesignSurfaceWheel(event: WheelEvent) {
  event.preventDefault()
  handleCanvasSurfaceWheel(event)
}

function containInteractionKey(frame: SceneNode, event: KeyboardEvent) {
  if (modeFor(frame.id) === 'interact' && event.code !== 'Space') event.stopPropagation()
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
  activeCodeObjectInteractionFrameId.value = mode === 'interact' ? frameId : null
  if (mode === 'interact') requestAnimationFrame(() => focusCodeObject(frameId))
  sync()
}

function activatePassiveSmylrFrame(frameId: string) {
  focusRecentDirectInteraction(frameId)
  promoteSmylrRuntime(frameId)
  store.select([frameId])
  setLiveInspectorActiveFrame(frameId)
  setLiveInspectorInteractionMode(modeFor(frameId) === 'interact' ? 'interact' : 'frame')
  sync()
}

function beginSurfacePointerInteraction(frame: SceneNode, event: PointerEvent) {
  if (event.button !== 0) return
  beginShapeMove(frame.id, event)
  interactionClickCandidateFrameId.value = frame.id
}

function enterSurfaceInteraction(frame: SceneNode, direct = false) {
  if (direct) directInteractionStartedAtByFrame.set(frame.id, Date.now())
  if (isSmylrProductionFrame(frame)) {
    activateSmylrMode(frame.id, 'interact')
    return
  }
  enterInteraction(frame.id)
}

function focusRecentDirectInteraction(frameId: string) {
  const startedAt = directInteractionStartedAtByFrame.get(frameId)
  if (startedAt === undefined || Date.now() - startedAt > 500) return false
  directInteractionStartedAtByFrame.delete(frameId)
  focusCanvasSurface(store, frameId)
  return true
}

function handleRecentSurfaceDoubleClick(event: MouseEvent) {
  const now = Date.now()
  for (const [frameId, startedAt] of directInteractionStartedAtByFrame) {
    if (now - startedAt > 500) {
      directInteractionStartedAtByFrame.delete(frameId)
      continue
    }
    const host = boundSurfaceHosts.get(frameId)
    if (!host) continue
    const bounds = host.getBoundingClientRect()
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      continue
    }
    if (!focusRecentDirectInteraction(frameId)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
}

function beginShapeMove(frameId: string, event: PointerEvent) {
  const frame = store.graph.getNode(frameId)
  if (!frame || event.button !== 0) return
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
  interactionClickCandidateFrameId.value = null
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
    if (interactionClickCandidateFrameId.value === frame.id) enterSurfaceInteraction(frame, true)
    interactionClickCandidateFrameId.value = null
    return
  }
  interactionClickCandidateFrameId.value = null
  const next = store.graph.getPresentedNodePosition(frame.id)
  store.graph.clearNodePositionPresentation(frame.id)
  if (next.x !== drag.startX || next.y !== drag.startY) {
    store.updateNode(frame.id, next)
    applyMoveReparent(store)
    store.commitMoveWithReparent(drag.snapInput.originals)
  }
}

function cancelShapeMove(event: PointerEvent) {
  const drag = moveDrag.value
  if (!drag || drag.pointerId !== event.pointerId) return
  moveDrag.value = null
  store.setSnapGuides([])
  interactionClickCandidateFrameId.value = null
  if (codeObjectDesignGestureDragged(drag)) {
    store.graph.clearNodePositionPresentation(drag.frameId)
    store.requestRepaint()
  }
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

function activeInteractionFrameId() {
  return Object.entries(modeByFrame.value).find(([, mode]) => mode === 'interact')?.[0] ?? null
}

function navigateFromInteractingFrame(
  frameId: string,
  direction: 'up' | 'down' | 'left' | 'right'
) {
  if (modeFor(frameId) !== 'interact') return
  const navigated = navigateBoardSelection(store, direction)
  if (navigated && fullFrameCodeObjectId.value === frameId) closeCodeObjectFullFrame(frameId)
}

function focusInteractingFrame(frameId: string) {
  if (modeFor(frameId) !== 'interact') return
  store.select([frameId])
  focusCanvasSurface(store, frameId)
}

function handleEscapeKey(event: KeyboardEvent) {
  const fullFrameId = fullFrameCodeObjectId.value
  if (fullFrameId) {
    event.preventDefault()
    event.stopImmediatePropagation()
    closeCodeObjectFullFrame(fullFrameId)
    exitInteraction(fullFrameId)
    return
  }
  const activeFrameId = activeInteractionFrameId()
  if (!activeFrameId && liveInspectorInteractionMode.value !== 'select') return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (activeFrameId) exitInteraction(activeFrameId)
  else if (liveInspectorActiveFrameId.value) {
    activateSmylrMode(liveInspectorActiveFrameId.value, 'frame')
  }
}

function handleEnterKey(event: KeyboardEvent) {
  if (event.repeat || isTypingTarget(event.target)) return
  const selectedId = store.state.selectedIds.size === 1 ? [...store.state.selectedIds][0] : null
  const selected = selectedId ? store.graph.getNode(selectedId) : null
  if (!selectedId || !isCodeObjectFrame(selected) || modeFor(selectedId) === 'interact') return
  event.preventDefault()
  enterInteraction(selectedId)
}

function handleCodeObjectKeydown(event: KeyboardEvent) {
  if (event.code === 'Escape') {
    handleEscapeKey(event)
    return
  }
  if (event.code === 'Enter') handleEnterKey(event)
}

useEventListener(window, 'keydown', handleCodeObjectKeydown, { capture: true })
useEventListener(window, 'dblclick', handleRecentSurfaceDoubleClick, { capture: true })

watch(runtimeActiveFrameIds, () => reconcileSmylrRuntimes(), {
  immediate: true
})
watch(resolvedTheme, renderActiveFrames)
watch(fullFrameCodeObjectId, (frameId, previousFrameId) => {
  if (previousFrameId && previousFrameId !== frameId) exitInteraction(previousFrameId)
  if (!frameId) return
  const frame = store.graph.getNode(frameId)
  if (!frame || !isSmylrProductionFrame(frame)) {
    closeCodeObjectFullFrame(frameId)
    return
  }
  store.select([frameId])
  promoteSmylrRuntime(frameId)
  enterInteraction(frameId)
})

onMounted(() => {
  mounted = true
  unsubscribe = [
    store.onEditorEvent('graph:replaced', () => {
      disposeAllCodeObjects()
      sync()
      reconcileCurrentBoardRuntimes()
      const runtime = loadedCodeObjectRuntime()
      if (!runtime) return
      for (const [frameId, host] of boundRuntimeHosts) {
        if (!isRuntimeActive(frameId)) continue
        runtime.attachCodeObject(frameId, host)
        const frame = store.graph.getNode(frameId)
        if (frame) void renderFrameWithRuntime(runtime, frame)
      }
    }),
    store.onEditorEvent('page:changed', () => {
      closeCodeObjectFullFrame()
      sync()
      reconcileCurrentBoardRuntimes()
      renderActiveFrames()
    }),
    store.onEditorEvent('node:created', () => {
      sync()
      reconcileSmylrRuntimes()
    }),
    store.onEditorEvent('node:deleted', (id) => {
      closeCodeObjectFullFrame(id)
      boundRuntimeHosts.delete(id)
      runtimeHostRefs.delete(id)
      surfaceHostRefs.delete(id)
      disposeCodeObject(id)
      pendingRuntimeRenderFrameIds.delete(id)
      sync()
      reconcileCurrentBoardRuntimes()
    }),
    store.onEditorEvent('node:reparented', sync),
    store.onEditorEvent('node:reordered', sync),
    store.onEditorEvent('node:previewUpdated', () => {
      sync()
    }),
    store.onEditorEvent('node:updated', (id, changes) => {
      sync()
      if ('pluginData' in changes) scheduleRuntimeRender(id)
    }),
    store.onEditorEvent('selection:changed', () => {
      const fullFrameId = fullFrameCodeObjectId.value
      if (fullFrameId && !store.state.selectedIds.has(fullFrameId)) {
        closeCodeObjectFullFrame(fullFrameId)
      }
      const selectedCodeObjectFrameId =
        store.state.selectedIds.size === 1 ? ([...store.state.selectedIds][0] ?? null) : null
      const interactionModes = reconcileCodeObjectInteractionModes(
        modeByFrame.value,
        selectedCodeObjectFrameId
      )
      modeByFrame.value = interactionModes.modes
      if (
        activeCodeObjectInteractionFrameId.value &&
        interactionModes.deactivatedFrameIds.includes(activeCodeObjectInteractionFrameId.value)
      ) {
        activeCodeObjectInteractionFrameId.value = null
      }
      for (const frameId of interactionModes.deactivatedFrameIds) {
        const frame = store.graph.getNode(frameId)
        if (frame && isRuntimeActive(frame.id)) void renderFrame(frame)
      }

      const selectedSmylrId = selectedSmylrFrameId()
      if (selectedSmylrId) promoteSmylrRuntime(selectedSmylrId)
      else {
        setLiveInspectorActiveFrame(null)
        reconcileSmylrRuntimes()
      }
      sync()
    }),
    store.onEditorEvent('tool:changed', sync)
  ]
  reconcileSmylrRuntimes()
  renderActiveFrames()
})

onUnmounted(() => {
  mounted = false
  activeCodeObjectInteractionFrameId.value = null
  closeCodeObjectFullFrame()
  store.setSnapGuides([])
  if (runtimeRenderFrame !== null) cancelAnimationFrame(runtimeRenderFrame)
  runtimeRenderFrame = null
  pendingRuntimeRenderFrameIds.clear()
  if (inspectorNotificationFrame !== null) cancelAnimationFrame(inspectorNotificationFrame)
  inspectorNotificationFrame = null
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  boundRuntimeHosts.clear()
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
        agentDocumentFor(frame) ? 'shadow-agent-card' : '',
        isSelected(frame.id) &&
        modeFor(frame.id) === 'interact' &&
        fullFrameCodeObjectId !== frame.id
          ? 'outline outline-2 outline-offset-2 outline-component/70'
          : '',
        fullFrameCodeObjectId === frame.id
          ? 'z-[18]'
          : modeFor(frame.id) === 'interact'
            ? 'z-[13]'
            : 'z-[4]'
      ]"
      :data-code-object-full-frame="fullFrameCodeObjectId === frame.id ? 'true' : 'false'"
      :data-code-object-mode="modeFor(frame.id)"
      :data-code-object-id="frame.id"
      :data-code-object-runtime-active="isRuntimeActive(frame.id)"
      :data-test-id="`code-object-${frame.id}`"
      :style="runtimeSurfaceCanvasStyle(frame)"
      @keydown="containInteractionKey(frame, $event)"
      @pointerdown.stop="selectShape(frame.id)"
      @wheel="handleSurfaceWheel(frame, $event)"
    >
      <AgentConversationBoardSurface
        v-if="agentDocumentFor(frame)"
        :frame-id="frame.id"
        :interaction-enabled="modeFor(frame.id) === 'interact'"
        :thread-name="frame.name"
        :worker-conversation-id="agentWorkerConversationId(frame)"
      />
      <SmylrTrustedWebApp
        v-else-if="isSmylrProductionFrame(frame) && isSmylrRuntimeResident(frame.id)"
        :active="isSelected(frame.id)"
        :component-surface="isSmylrComponentCodeObject(frame)"
        :frame-id="frame.id"
        :interaction-enabled="modeFor(frame.id) === 'interact'"
        :route="smylrProductionRoute(frame)"
        :runtime-key="smylrRuntimeKey(frame.id)"
        @board-navigate="navigateFromInteractingFrame(frame.id, $event)"
        @exit-interaction="exitSurfaceInteraction(frame.id)"
        @focus-frame="focusInteractingFrame(frame.id)"
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
      :style="surfaceCanvasStyle(frame)"
    >
      <div
        v-if="modeFor(frame.id) === 'design' && !isSmylrContainerMode(frame)"
        class="absolute inset-0 z-[1] cursor-pointer"
        :class="store.state.activeTool === 'SELECT' ? 'pointer-events-auto' : 'pointer-events-none'"
        :aria-label="`${frame.name}. Click to interact or drag to move.`"
        data-test-id="code-object-design-hit-target"
        @pointercancel.stop="cancelShapeMove"
        @pointerdown.stop="beginSurfacePointerInteraction(frame, $event)"
        @pointermove.stop.prevent="moveShape"
        @pointerup.stop.prevent="endShapeMove"
        @wheel="handleDesignSurfaceWheel($event)"
      />
    </div>

    <CodeObjectTransformControls
      v-if="showsTransformControls(frame)"
      :frame="frame"
      :revision="syncTick"
    />
  </template>
</template>
