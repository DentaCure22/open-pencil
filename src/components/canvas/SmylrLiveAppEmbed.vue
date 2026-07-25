<script setup lang="ts">
import { readCacheJson, writeCacheJson } from '@/app/cache'
import { useEditorStore } from '@/app/editor/active-store'
import {
  forwardEmbeddedSurfaceWheel,
  forwardFrameSurfaceWheel,
  isEmbeddedSurfaceWheelMessage
} from '@/app/editor/canvas/embedded-surface-wheel'
import { isSmylrLiveComponentFrame } from '@/app/smylr-component-library/live-component-canvas'
import {
  smylrFrameBaseUrlFor,
  smylrOpenPencilFrameUrlFor
} from '@/app/smylr-live-inspector/frame-origin'
import { isLiveInspectorMessageFromFrame } from '@/app/smylr-live-inspector/message-source'
import {
  isSmylrOpenPencilInspectorMessage,
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorInteractionMode,
  liveInspectorPatchDraft,
  liveInspectorPatchDrafts,
  liveInspectorPreviewMode,
  liveInspectorReloadTick,
  liveInspectorRoute,
  liveInspectorSelectedId,
  liveInspectorStatus,
  markLiveInspectorFrameLoading,
  markLiveInspectorFrameUnavailable,
  receiveLiveInspectorMessage,
  resetLiveInspectorToProduction,
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
  setLiveInspectorCommandTarget,
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode,
  selectedLiveInspectorNode,
  type SmylrOpenPencilInspectorMessage
} from '@/app/smylr-live-inspector/session'
import {
  completeLiveWorkspacePreview,
  failLiveWorkspacePreview,
  liveWorkspaceItems,
  liveWorkspacePreviewRequest,
  requestLiveWorkspacePreview,
  snapshotLiveWorkspace
} from '@/app/smylr-live-inspector/workspace'
import { liveFrameCornerStyle } from '@/app/smylr-production/frame-corners'
import {
  createLiveFrameTransformController,
  LIVE_FRAME_RESIZE_HANDLE_STYLE,
  LIVE_FRAME_ROTATE_HANDLE_STYLE,
  liveFrameCanvasStyle,
  liveFrameHeaderStyle,
  liveFrameResizeHandles,
  liveFrameRotationHandles,
  liveFrameScreenOverlayStyle,
  type FrameCorner
} from '@/app/smylr-production/frame-transform'
import { clearLiveFrameScenePaint } from '@/app/smylr-production/live/paint'
import {
  findCurrentSmylrLiveAppFrame,
  fitSmylrPageToViewport,
  isSmylrLiveAppFrameNode,
  isSmylrFlowPageNode,
  smylrLiveAppFrameDisplayName,
  smylrLiveAppFrameRoute
} from '@/app/smylr-production/workspace'
import { IS_BROWSER } from '@/constants'
import { useEventListener, useUrlSearchParams } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import SmylrLiveContainerOverlay from '../SmylrLiveContainerOverlay.vue'
import SmylrLiveWorkspaceActions from '../SmylrLiveWorkspaceActions.vue'
import Tip from '../ui/Tip.vue'
import SmylrLiveFrameViewportControls from './SmylrLiveFrameViewportControls.vue'
import './smylr-live-frame-header.css'

const store = useEditorStore()
const params = useUrlSearchParams('history')
const iframeRef = ref<HTMLIFrameElement | null>(null)
const cachedFrameSnapshot = ref<string | null>(null)
const liveFrameReady = ref(false)
const frameHovered = ref(false)
const syncTick = ref(0)
const frameHeaderDrag = ref<{
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
} | null>(null)
const INSPECTOR_RETRY_DELAY_MS = 750
const INSPECTOR_UNAVAILABLE_DELAY_MS = 15_000
const WORKSPACE_PREVIEW_TIMEOUT_MS = 15_000
let unsubscribe: Array<() => void> = []
let connectionDeadlineTimer = 0
let connectionRetryTimer = 0
let workspacePreviewTimer = 0
let frameHeaderHideTimer = 0
let snapshotRestoreVersion = 0

function bumpOverlaySync() {
  syncTick.value += 1
}

function defaultSmylrFrameBaseUrl() {
  if (IS_BROWSER && window.location?.href) {
    return smylrFrameBaseUrlFor(window.location.href)
  }
  return ''
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
})

onUnmounted(() => {
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  window.clearTimeout(connectionDeadlineTimer)
  window.clearTimeout(connectionRetryTimer)
  window.clearTimeout(workspacePreviewTimer)
  window.clearTimeout(frameHeaderHideTimer)
  if (liveInspectorActiveFrameId.value === liveFrame.value?.id) {
    setLiveInspectorCommandTarget(null)
  }
})

useEventListener(window, 'message', handleInspectorMessage)

const baseUrl = computed(() => {
  const value = params['smylr-base'] ?? params['smylr-origin']
  return typeof value === 'string' && value.length > 0
    ? value.replace(/\/+$/, '')
    : defaultSmylrFrameBaseUrl()
})

const liveFrame = computed(() => {
  void syncTick.value
  return findCurrentSmylrLiveAppFrame(store)
})
const isLiveComponentRuntime = computed(() => isSmylrLiveComponentFrame(liveFrame.value))

// Migrate an already-open workspace in place. Older Smylr live-frame nodes
// carried CanvasKit fills, strokes, or effects, leaving a second painted frame
// underneath the DOM iframe until the workspace was fully re-seeded.
watch(
  liveFrame,
  (frame) => {
    if (
      frame &&
      (!liveInspectorActiveFrameId.value || !store.graph.getNode(liveInspectorActiveFrameId.value))
    ) {
      setLiveInspectorActiveFrame(frame.id)
    }
    if (frame && clearLiveFrameScenePaint(store.graph, frame)) store.requestRender()
  },
  { immediate: true }
)

const iframeSrc = computed(() => {
  void syncTick.value
  const route = liveFrame.value ? smylrLiveAppFrameRoute(liveFrame.value) : '/dental-chart'
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`
  if (isLiveComponentRuntime.value) {
    return `${baseUrl.value}${normalizedRoute}`
  }
  return smylrOpenPencilFrameUrlFor({
    baseUrl: baseUrl.value,
    openPencilHref: window.location.href,
    route: normalizedRoute
  })
})

const iframeOrigin = computed(() => {
  try {
    const origin = new URL(iframeSrc.value, window.location.href).origin
    return origin === 'null' ? '' : origin
  } catch {
    return ''
  }
})

const iframeKey = computed(() =>
  isLiveComponentRuntime.value
    ? iframeSrc.value
    : `${iframeSrc.value}:${liveInspectorReloadTick.value}`
)

function currentFrameSnapshotCacheKey() {
  const frame = liveFrame.value
  const route = frame ? smylrLiveAppFrameRoute(frame) : '/dental-chart'
  return `smylr-live-frame-snapshot/v2/${encodeURIComponent(route)}/current`
}

async function restoreCurrentFrameSnapshot() {
  const version = ++snapshotRestoreVersion
  cachedFrameSnapshot.value = null
  const snapshot = await readCacheJson<string>(currentFrameSnapshotCacheKey())
  if (version === snapshotRestoreVersion) cachedFrameSnapshot.value = snapshot
}

function persistCurrentFrameSnapshot(dataUrl: string) {
  cachedFrameSnapshot.value = dataUrl
  void writeCacheJson(currentFrameSnapshotCacheKey(), dataUrl).catch(() => undefined)
}

const frameStyle = computed(() => {
  void syncTick.value
  const frame = liveFrame.value
  if (!frame) return {}
  return liveFrameCanvasStyle(store, frame)
})

const frameCornerStyle = computed(() => {
  const frame = liveFrame.value
  return frame ? liveFrameCornerStyle(frame) : {}
})

const isCurrentRuntimeSelected = computed(() => {
  const frame = liveFrame.value
  return Boolean(frame && store.state.selectedIds.has(frame.id))
})
const isCurrentRuntimeActive = computed(() => {
  const frame = liveFrame.value
  return Boolean(frame && liveInspectorActiveFrameId.value === frame.id)
})
const isFlowPage = computed(() => {
  void syncTick.value
  return isSmylrFlowPageNode(store.graph.getNode(store.state.currentPageId))
})
const shouldShowCurrentFrameHeader = computed(() => {
  if (!isFlowPage.value) return true
  return frameHovered.value || isCurrentRuntimeActive.value
})
const isFrameSelected = computed(() => {
  // The frame remains selected internally to route the native inspector, but
  // once a live DOM container owns selection it must not draw a second box.
  return isCurrentRuntimeSelected.value && !liveInspectorSelectedId.value
})
const frameIframeStyle = computed(() => ({ ...frameCornerStyle.value }))

/**
 * Selection chrome lives in screen space, not inside the scaled iframe.
 * This gives the box and every handle one transform and prevents zoom drift.
 */
const frameSelectionStyle = computed(() => {
  void syncTick.value
  const frame = liveFrame.value
  if (!frame) return {}
  return liveFrameScreenOverlayStyle(store, frame)
})

const frameSelectionHandles = computed<
  Array<{
    id: FrameCorner
    transform: string
    x: number
    y: number
  }>
>(() => {
  void syncTick.value
  const frame = liveFrame.value
  if (!frame) return []
  return liveFrameResizeHandles(frame, store.state.zoom)
})

const frameRotationHandles = computed(() => {
  void syncTick.value
  const frame = liveFrame.value
  if (!frame) return []
  return liveFrameRotationHandles(frame, store.state.zoom)
})

const frameSelectionHandleStyle = LIVE_FRAME_RESIZE_HANDLE_STYLE
const frameRotationHandleStyle = LIVE_FRAME_ROTATE_HANDLE_STYLE

const frameTransform = createLiveFrameTransformController(store, bumpOverlaySync)

function beginFrameResize(corner: FrameCorner, event: PointerEvent) {
  const frame = liveFrame.value
  if (frame) frameTransform.beginResize(frame.id, corner, event)
}

function beginFrameRotate(event: PointerEvent) {
  const frame = liveFrame.value
  if (frame) frameTransform.beginRotate(frame.id, event)
}

const moveFrameTransform = frameTransform.move
const endFrameTransform = frameTransform.end

const frameHeaderTitle = computed(() =>
  smylrLiveAppFrameDisplayName(liveFrame.value?.name ?? 'Live app')
)
const currentDraftCount = computed(() => liveInspectorPatchDrafts.value.size)
const frameSelectionLabelStyle = computed(() => {
  return {
    fontSize: '12px',
    ...liveFrameHeaderStyle(store.state.zoom)
  }
})

function showCurrentFrameHeader() {
  window.clearTimeout(frameHeaderHideTimer)
  frameHovered.value = true
}

function hideCurrentFrameHeaderSoon() {
  window.clearTimeout(frameHeaderHideTimer)
  frameHeaderHideTimer = window.setTimeout(() => {
    if (!frameHeaderDrag.value) frameHovered.value = false
  }, 140)
}

function activateFrameMode() {
  const frame = liveFrame.value
  if (!frame) return
  store.select([frame.id])
  setLiveInspectorActiveFrame(frame.id)
  setLiveInspectorInteractionMode('frame')
  postInspectorCommand('set-interaction-mode')
  postInspectorCommand('request-tree')
  bumpOverlaySync()
}

function focusCurrentFrame(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button, [role="button"]')) return
  const frame = liveFrame.value
  if (!frame) return
  activateFrameMode()
  void fitSmylrPageToViewport(store, [frame.id])
}

function activateInteractMode() {
  const frame = liveFrame.value
  if (!frame) return
  store.select([frame.id])
  setLiveInspectorActiveFrame(frame.id)
  setLiveInspectorInteractionMode('interact')
  postInspectorCommand('set-interaction-mode')
  postInspectorCommand('request-tree')
  bumpOverlaySync()
}

function snapshotCurrentFrame() {
  const frame = liveFrame.value
  if (!frame) return
  const route = liveInspectorRoute.value ?? smylrLiveAppFrameRoute(frame)
  const patches = [...liveInspectorPatchDrafts.value.values()]
  const nodeId =
    liveInspectorSelectedId.value ??
    liveInspectorDocument.value?.selectedId ??
    patches[0]?.nodeId ??
    `${route}:page`
  const snapshotNumber =
    liveWorkspaceItems.value.filter((item) => item.route === route && item.kind !== 'archived')
      .length + 1
  const item = snapshotLiveWorkspace({
    name: `${frameHeaderTitle.value} Alternate ${snapshotNumber}`,
    nodeId,
    note:
      patches.length > 0
        ? `${patches.length} saved canvas edit${patches.length === 1 ? '' : 's'}`
        : 'Production-state design snapshot',
    patches,
    route
  })
  requestLiveWorkspacePreview(item.id)
  activateFrameMode()
}

function resetCurrentFrameToProduction() {
  if (currentDraftCount.value === 0) return
  resetLiveInspectorToProduction()
  activateFrameMode()
}

function beginFrameHeaderMove(event: PointerEvent) {
  const frame = liveFrame.value
  if (!frame || event.button !== 0) return
  activateFrameMode()
  frameHeaderDrag.value = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: frame.x,
    startY: frame.y
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function moveFrameFromHeader(event: PointerEvent) {
  const drag = frameHeaderDrag.value
  const frame = liveFrame.value
  if (!drag || !frame || drag.pointerId !== event.pointerId) return
  const zoom = Math.max(store.state.zoom, 0.01)
  store.updateNode(frame.id, {
    x: drag.startX + (event.clientX - drag.startClientX) / zoom,
    y: drag.startY + (event.clientY - drag.startClientY) / zoom
  })
  store.requestRender()
  bumpOverlaySync()
}

function endFrameHeaderMove(event: PointerEvent) {
  const drag = frameHeaderDrag.value
  const frame = liveFrame.value
  if (!drag || !frame || drag.pointerId !== event.pointerId) return
  store.commitNodeUpdate(frame.id, { x: drag.startX, y: drag.startY }, 'Move live app frame')
  frameHeaderDrag.value = null
  store.requestRender()
  bumpOverlaySync()
}

const hasNativeNonFrameSelection = computed(() =>
  [...store.state.selectedIds].some((id) => {
    const node = store.graph.getNode(id)
    return Boolean(node && !isSmylrLiveAppFrameNode(node))
  })
)

/**
 * Live iframe must sit ABOVE the Skia scene canvas (opaque page clear at z-1).
 * Only toggle pointer-events — never drop below the scene layer (that hid the app).
 * - select/interact: receive clicks for live container picking
 * - frame mode / native paste selection: clicks fall through to interaction canvas
 */
const liveFrameClass = computed(() => {
  if (!isCurrentRuntimeActive.value) {
    return 'pointer-events-none z-[5]'
  }
  // Interact is authoritative: the real app must receive clicks even if a
  // native OpenPencil node was selected before switching modes.
  if (liveInspectorInteractionMode.value === 'interact') {
    return 'pointer-events-auto z-[5]'
  }
  if (liveInspectorInteractionMode.value === 'frame') {
    return 'pointer-events-none z-[5]'
  }
  if (hasNativeNonFrameSelection.value) {
    return 'pointer-events-none z-[5]'
  }
  return 'pointer-events-auto z-[5]'
})

const shouldCaptureDisconnectedFrameGestures = computed(
  () =>
    !isLiveComponentRuntime.value &&
    isCurrentRuntimeActive.value &&
    liveInspectorInteractionMode.value === 'interact' &&
    liveInspectorStatus.value !== 'connected'
)

function postInspectorCommand(action: 'request-tree' | 'set-interaction-mode') {
  const target = iframeRef.value?.contentWindow ?? null
  const targetOrigin = iframeOrigin.value
  if (isCurrentRuntimeActive.value) {
    setLiveInspectorCommandTarget(target, targetOrigin)
  }
  if (!target || !targetOrigin) return
  dispatchInspectorCommand(target, targetOrigin, {
    action,
    kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
    mode: liveInspectorInteractionMode.value
  })
}

function dispatchInspectorCommand(
  target: Window,
  targetOrigin: string,
  command: Record<string, unknown>
) {
  if (targetOrigin === window.location.origin) {
    try {
      const directCommand = (
        target as Window & {
          __smylrOpenPencilCommand?: (command: Record<string, unknown>) => void
        }
      ).__smylrOpenPencilCommand
      if (directCommand) {
        directCommand(command)
        return
      }
    } catch {
      // Fall through to postMessage while the same-origin iframe is starting.
    }
  }
  target.postMessage(command, targetOrigin)
}

function postInspectorPointCommand(
  action: 'hover-at-point' | 'select-at-point',
  event: MouseEvent | PointerEvent
) {
  const frame = iframeRef.value
  if (!frame) return
  const rect = frame.getBoundingClientRect()
  const target = frame.contentWindow
  const targetOrigin = iframeOrigin.value
  if (!target || !targetOrigin || rect.width <= 0 || rect.height <= 0) return
  dispatchInspectorCommand(target, targetOrigin, {
    action,
    kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
    x: ((event.clientX - rect.left) * frame.clientWidth) / rect.width,
    y: ((event.clientY - rect.top) * frame.clientHeight) / rect.height
  })
}

function clearInspectorPointHover() {
  const target = iframeRef.value?.contentWindow
  const targetOrigin = iframeOrigin.value
  if (!target || !targetOrigin) return
  dispatchInspectorCommand(target, targetOrigin, {
    action: 'hover-at-point',
    kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
    x: -1,
    y: -1
  })
}

function leaveInspectorSelectSurface() {
  clearInspectorPointHover()
  hideCurrentFrameHeaderSoon()
}

function queueInspectorRetry(src: string) {
  window.clearTimeout(connectionRetryTimer)
  connectionRetryTimer = window.setTimeout(() => {
    if (iframeSrc.value !== src || liveInspectorStatus.value === 'connected') return
    postInspectorCommand('set-interaction-mode')
    postInspectorCommand('request-tree')
    queueInspectorRetry(src)
  }, INSPECTOR_RETRY_DELAY_MS)
}

function requestInspectorTree() {
  const src = iframeSrc.value
  markLiveInspectorFrameLoading(src)
  postInspectorCommand('set-interaction-mode')
  postInspectorCommand('request-tree')
  queueInspectorRetry(src)
  window.clearTimeout(connectionDeadlineTimer)
  connectionDeadlineTimer = window.setTimeout(() => {
    markLiveInspectorFrameUnavailable(src)
  }, INSPECTOR_UNAVAILABLE_DELAY_MS)
}

function handleFrameLoad() {
  if (isLiveComponentRuntime.value) {
    liveFrameReady.value = true
    return
  }
  requestInspectorTree()
}

function cacheInspectorPageFace(message: SmylrOpenPencilInspectorMessage) {
  const pageFace =
    message.pageFace ?? message.document?.pageFace ?? message.document?.pages?.[0]?.pageFace
  if (pageFace?.dataUrl) persistCurrentFrameSnapshot(pageFace.dataUrl)
  const previewRequest = liveWorkspacePreviewRequest.value
  if (!previewRequest || !pageFace?.dataUrl) return
  window.clearTimeout(workspacePreviewTimer)
  completeLiveWorkspacePreview(previewRequest.itemId, {
    dataUrl: pageFace.dataUrl,
    height: pageFace.height,
    mimeType: pageFace.mimeType,
    width: pageFace.width
  })
}

function receiveInspectorPacket(
  message: SmylrOpenPencilInspectorMessage,
  iframeWindow: Window,
  expectedOrigin: string
) {
  liveFrameReady.value = true
  window.clearTimeout(connectionDeadlineTimer)
  window.clearTimeout(connectionRetryTimer)
  cacheInspectorPageFace(message)
  const frame = liveFrame.value
  const ownsInspector = Boolean(frame && liveInspectorActiveFrameId.value === frame.id)
  if (ownsInspector) setLiveInspectorCommandTarget(iframeWindow, expectedOrigin)
  // Runtime packets describe the frame that already owns interaction; they
  // must never establish ownership themselves. A delayed Current select/tree
  // packet would otherwise steal the inspector immediately after the user
  // activates an alternate.
  if (ownsInspector) receiveLiveInspectorMessage(message)
  if (ownsInspector && message.action === 'ready') {
    // The bridge has mounted by the time it emits ready, so re-apply the
    // parent tool now that the same-origin direct command function exists.
    postInspectorCommand('set-interaction-mode')
    if (!message.document) postInspectorCommand('request-tree')
  }
}

function handleInspectorMessage(event: MessageEvent) {
  const iframeWindow = iframeRef.value?.contentWindow ?? null
  const expectedOrigin = iframeOrigin.value
  const frameId = liveFrame.value?.id
  if (
    !iframeWindow ||
    !frameId ||
    !isLiveInspectorMessageFromFrame(event, expectedOrigin, frameId, iframeWindow)
  )
    return
  if (
    isEmbeddedSurfaceWheelMessage(event.data, SMYLR_OPENPENCIL_INSPECTOR_MESSAGE) &&
    iframeRef.value
  ) {
    forwardEmbeddedSurfaceWheel(iframeRef.value, event.data)
    return
  }
  if (!isSmylrOpenPencilInspectorMessage(event.data)) return
  receiveInspectorPacket(event.data, iframeWindow, expectedOrigin)
}

function handleFrameSurfaceWheel(event: WheelEvent) {
  if (!(event.currentTarget instanceof HTMLElement)) return
  if (!forwardFrameSurfaceWheel(event.currentTarget, event)) return
  event.preventDefault()
  event.stopPropagation()
}

function requestCurrentWorkspacePreview(itemId: string) {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === itemId)
  const target = iframeRef.value?.contentWindow
  if (!item || !target || item.route !== liveInspectorRoute.value) {
    failLiveWorkspacePreview(itemId)
    return
  }
  window.clearTimeout(workspacePreviewTimer)
  workspacePreviewTimer = window.setTimeout(() => {
    failLiveWorkspacePreview(itemId)
  }, WORKSPACE_PREVIEW_TIMEOUT_MS)
  target.postMessage(
    { action: 'request-snapshot', kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE },
    iframeOrigin.value
  )
}

watch(
  iframeKey,
  () => {
    const src = iframeSrc.value
    liveFrameReady.value = false
    window.clearTimeout(connectionDeadlineTimer)
    window.clearTimeout(connectionRetryTimer)
    if (isCurrentRuntimeActive.value) setLiveInspectorCommandTarget(null)
    if (isLiveComponentRuntime.value) {
      cachedFrameSnapshot.value = null
      return
    }
    markLiveInspectorFrameLoading(src)
    void restoreCurrentFrameSnapshot()
  },
  { immediate: true }
)

watch(liveInspectorInteractionMode, () => {
  if (!isLiveComponentRuntime.value && liveInspectorActiveFrameId.value === liveFrame.value?.id) {
    postInspectorCommand('set-interaction-mode')
  }
})

watch(liveWorkspacePreviewRequest, (request) => {
  if (request && !isLiveComponentRuntime.value) {
    requestCurrentWorkspacePreview(request.itemId)
  }
})
</script>

<template>
  <div
    v-if="liveFrame"
    data-test-id="smylr-live-app-embed"
    :aria-hidden="liveInspectorInteractionMode === 'frame'"
    class="absolute top-0 left-0"
    :class="liveFrameClass"
    :style="frameStyle"
    @pointerenter="showCurrentFrameHeader"
    @pointerleave="hideCurrentFrameHeaderSoon"
  >
    <div
      data-test-id="smylr-live-frame-surface"
      class="absolute inset-0 overflow-hidden"
      :class="
        isLiveComponentRuntime
          ? 'bg-transparent shadow-none'
          : 'bg-white shadow-[var(--shadow-live-frame)]'
      "
      :style="frameCornerStyle"
    >
      <iframe
        ref="iframeRef"
        :key="iframeKey"
        data-test-id="smylr-production-frame"
        :data-live-frame-id="liveFrame.id"
        :data-runtime-kind="isLiveComponentRuntime ? 'component' : 'production'"
        :src="iframeSrc"
        allowtransparency="true"
        class="size-full border-0"
        :class="isLiveComponentRuntime ? 'bg-transparent' : 'bg-white'"
        :style="frameIframeStyle"
        :tabindex="
          liveInspectorActiveFrameId === liveFrame.id && liveInspectorInteractionMode === 'interact'
            ? 0
            : -1
        "
        loading="eager"
        :title="isLiveComponentRuntime ? `${frameHeaderTitle} component` : 'Smylr production app'"
        @load="handleFrameLoad"
        @pointerenter="showCurrentFrameHeader"
        @pointerleave="hideCurrentFrameHeaderSoon"
      />
      <img
        v-if="!isLiveComponentRuntime && cachedFrameSnapshot && !liveFrameReady"
        :src="cachedFrameSnapshot"
        alt=""
        aria-hidden="true"
        data-test-id="smylr-live-frame-instant-preview"
        class="pointer-events-none absolute inset-0 z-[1] size-full bg-white object-fill"
        :style="frameIframeStyle"
      />
      <Tip
        v-if="shouldCaptureDisconnectedFrameGestures"
        label="Navigate the board while the live app reconnects"
      >
        <div
          data-test-id="smylr-live-disconnected-navigation-surface"
          class="absolute inset-0 z-10 cursor-grab active:cursor-grabbing"
          @wheel="handleFrameSurfaceWheel"
        />
      </Tip>
      <Tip
        v-if="
          liveInspectorActiveFrameId === liveFrame.id &&
          !isLiveComponentRuntime &&
          liveInspectorInteractionMode === 'select' &&
          !hasNativeNonFrameSelection
        "
        label="Select a live container"
      >
        <div
          data-test-id="smylr-live-select-surface"
          class="absolute inset-0 z-10 cursor-crosshair"
          @click.stop.prevent="postInspectorPointCommand('select-at-point', $event)"
          @pointerenter="showCurrentFrameHeader"
          @pointerleave="leaveInspectorSelectSurface"
          @pointermove="postInspectorPointCommand('hover-at-point', $event)"
          @wheel="handleFrameSurfaceWheel"
        />
      </Tip>
      <div
        v-if="!isLiveComponentRuntime && liveInspectorStatus === 'loading'"
        data-test-id="smylr-live-app-loading"
        class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-blue-600/85 px-3 py-2 text-[11px] text-white"
      >
        Connecting live layers…
      </div>
      <div
        v-if="!isLiveComponentRuntime && liveInspectorStatus === 'unavailable'"
        data-test-id="smylr-live-app-connection-warning"
        class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-black/55 px-3 py-2 text-[11px] text-white"
      >
        Live layers are reconnecting. The Smylr page remains available.
      </div>
    </div>
    <SmylrLiveContainerOverlay
      v-if="
        !isLiveComponentRuntime &&
        !liveInspectorPreviewMode &&
        liveInspectorActiveFrameId === liveFrame?.id
      "
      @select-at-point="postInspectorPointCommand('select-at-point', $event)"
    />
  </div>
  <div
    v-if="liveFrame"
    data-test-id="smylr-live-frame-selection"
    class="smylr-live-frame-header-container pointer-events-none absolute top-0 left-0 z-10"
    :class="isFrameSelected ? 'border border-violet-500' : ''"
    :style="frameSelectionStyle"
    @pointerenter="showCurrentFrameHeader"
    @pointerleave="hideCurrentFrameHeaderSoon"
  >
    <!--
      Body press → live app. Lives on the selection chrome (above pe-none frame shell)
      so the hit target actually receives pointer events in frame mode.
    -->
    <Tip
      v-if="
        !isCurrentRuntimeActive ||
        (liveInspectorInteractionMode !== 'interact' &&
          liveInspectorInteractionMode !== 'select' &&
          !hasNativeNonFrameSelection)
      "
      label="Use live app"
    >
      <div
        data-test-id="smylr-live-frame-enter-interact"
        class="pointer-events-auto absolute inset-0 z-[1] cursor-pointer"
        @pointerenter="showCurrentFrameHeader"
        @pointerleave="hideCurrentFrameHeaderSoon"
        @pointerdown.stop.prevent="activateInteractMode"
        @wheel="handleFrameSurfaceWheel"
      />
    </Tip>
    <Tip v-if="shouldShowCurrentFrameHeader" label="Frame mode · double-click to center this frame">
      <span
        data-test-id="smylr-live-frame-header"
        class="smylr-live-frame-header bg-panel border-border text-surface hover:bg-hover pointer-events-auto absolute left-1/2 z-[2] flex cursor-move items-center gap-0.5 rounded-md border px-1 py-0.5 whitespace-nowrap shadow-sm transition-colors hover:border-violet-500"
        :class="liveInspectorInteractionMode === 'frame' ? 'bg-hover border-violet-500' : ''"
        :style="frameSelectionLabelStyle"
        @click.stop="activateFrameMode"
        @dblclick.stop.prevent="focusCurrentFrame"
        @pointerenter="showCurrentFrameHeader"
        @pointerleave="hideCurrentFrameHeaderSoon"
        @pointercancel.stop="endFrameHeaderMove"
        @pointerdown.stop.prevent="beginFrameHeaderMove"
        @pointermove.stop="moveFrameFromHeader"
        @pointerup.stop="endFrameHeaderMove"
      >
        <strong
          class="smylr-live-frame-header__title max-w-36 cursor-move truncate px-1 text-[10px] font-medium"
          >{{ frameHeaderTitle }}</strong
        >
        <span
          class="smylr-live-frame-header__status rounded px-1 text-[8px] font-medium"
          :class="
            !isLiveComponentRuntime && currentDraftCount
              ? 'bg-amber-500/15 text-amber-400'
              : 'bg-green-500/15 text-green-400'
          "
        >
          {{
            isLiveComponentRuntime
              ? 'Live'
              : currentDraftCount
                ? `${currentDraftCount} edit${currentDraftCount === 1 ? '' : 's'}`
                : 'Prod'
          }}
        </span>
        <span
          class="smylr-live-frame-header__divider smylr-live-frame-header__title-divider bg-border mx-0.5 h-3.5 w-px"
        />
        <SmylrLiveFrameViewportControls
          class="smylr-live-frame-header__viewport"
          :frame-id="liveFrame.id"
          :frame-label="frameHeaderTitle"
          @change="activateFrameMode"
        />
        <span
          v-if="!isLiveComponentRuntime && selectedLiveInspectorNode"
          class="smylr-live-frame-header__secondary border-border ml-0.5 flex items-center gap-0.5 border-l pl-1"
          @click.stop
          @pointerdown.stop
        >
          <SmylrLiveWorkspaceActions
            :draft="liveInspectorPatchDraft"
            :node="selectedLiveInspectorNode"
          />
        </span>
        <span
          v-if="!isLiveComponentRuntime"
          class="smylr-live-frame-header__divider smylr-live-frame-header__secondary-divider bg-border mx-0.5 h-3.5 w-px"
        />
        <span
          v-if="!isLiveComponentRuntime"
          class="smylr-live-frame-header__optional flex items-center gap-0.5"
        >
          <Tip label="Snapshot as alternate">
            <button
              type="button"
              aria-label="Snapshot current frame as an alternate"
              data-test-id="smylr-live-frame-snapshot"
              class="text-muted hover:bg-hover hover:text-surface flex size-7 items-center justify-center rounded"
              @click.stop="snapshotCurrentFrame"
              @pointerdown.stop
            >
              <icon-lucide-camera class="size-4" />
            </button>
          </Tip>
          <Tip label="Reset Current to production">
            <button
              type="button"
              aria-label="Reset Current to production"
              data-test-id="smylr-live-frame-reset-production"
              class="text-muted hover:bg-hover hover:text-surface flex size-7 items-center justify-center rounded disabled:cursor-default disabled:opacity-30"
              :disabled="currentDraftCount === 0"
              @click.stop="resetCurrentFrameToProduction"
              @pointerdown.stop
            >
              <icon-lucide-rotate-ccw class="size-4" />
            </button>
          </Tip>
        </span>
      </span>
    </Tip>
    <span
      v-for="handle in frameSelectionHandles"
      v-show="isFrameSelected"
      :key="handle.id"
      class="pointer-events-auto absolute z-20 rounded-full border border-violet-500 bg-white"
      :class="
        handle.id === 'nw' || handle.id === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
      "
      :style="{
        ...frameSelectionHandleStyle,
        left: `${handle.x}px`,
        top: `${handle.y}px`,
        transform: handle.transform
      }"
      @pointercancel.stop="endFrameTransform"
      @pointerdown.stop.prevent="beginFrameResize(handle.id, $event)"
      @pointermove.stop.prevent="moveFrameTransform"
      @pointerup.stop.prevent="endFrameTransform"
    />
    <span
      v-for="handle in frameRotationHandles"
      v-show="isFrameSelected"
      :key="`rotate-${handle.id}`"
      :aria-label="`Rotate from ${handle.id} corner`"
      class="pointer-events-auto absolute z-10 cursor-crosshair"
      :style="{
        ...frameRotationHandleStyle,
        left: `${handle.x}px`,
        top: `${handle.y}px`,
        transform: handle.transform
      }"
      role="button"
      @pointercancel.stop="endFrameTransform"
      @pointerdown.stop.prevent="beginFrameRotate"
      @pointermove.stop.prevent="moveFrameTransform"
      @pointerup.stop.prevent="endFrameTransform"
    />
  </div>
</template>
