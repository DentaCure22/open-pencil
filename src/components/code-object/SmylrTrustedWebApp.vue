<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'

import {
  forwardEmbeddedSurfaceWheel,
  forwardFrameSurfaceWheel,
  isEmbeddedSurfaceWheelMessage
} from '@/app/editor/canvas/embedded-surface-wheel'
import { flushLiveIframeSurfaceHost } from '@/app/code-object/transform'
import { preserveCodeObjectRuntimeDuringHotUpdate } from '@/app/code-object/hmr-residency'
import {
  attachTrustedWebAppDomRuntime,
  disposeTrustedWebAppDomRuntime,
  parkTrustedWebAppDomRuntime,
  trustedWebAppDomRuntimeFor
} from '@/app/code-object/trusted-web-app-dom-runtime'
import { useEditorStore } from '@/app/editor/active-store'
import { canvasSurfaceCanReceivePointer } from '@/app/editor/canvas/surface/interaction'
import {
  smylrFrameBaseUrlFor,
  smylrOpenPencilFrameUrlFor
} from '@/app/smylr-live-inspector/frame-origin'
import { isLiveInspectorMessageFromFrame } from '@/app/smylr-live-inspector/message-source'
import {
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  liveInspectorReloadTickFor,
  liveInspectorStatus,
  markLiveInspectorFrameLoading,
  markLiveInspectorFrameUnavailable,
  receiveLiveInspectorMessage,
  setLiveInspectorActiveFrame,
  setLiveInspectorCommandTarget
} from '@/app/smylr-live-inspector/session'
import {
  isSmylrOpenPencilInspectorMessage,
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
  type SmylrOpenPencilInspectorCommand
} from '@/app/smylr-live-inspector/protocol'
import SmylrLiveContainerOverlay from '@/components/SmylrLiveContainerOverlay.vue'
import { IS_BROWSER } from '@/constants'

const { active, componentSurface, frameId, interactionEnabled, route, runtimeKey } = defineProps<{
  active: boolean
  componentSurface: boolean
  frameId: string
  interactionEnabled: boolean
  route: string
  runtimeKey: string
}>()
const emit = defineEmits<{
  boardNavigate: [direction: 'up' | 'down' | 'left' | 'right']
  exitInteraction: []
  focusFrame: []
  interactionStart: []
}>()

const store = useEditorStore()
const iframeHostRef = ref<HTMLDivElement | null>(null)
const domRuntime = IS_BROWSER ? trustedWebAppDomRuntimeFor(frameId) : null
const iframeRef = ref<HTMLIFrameElement | null>(domRuntime?.iframe ?? null)
const RETRY_DELAY_MS = 750
const UNAVAILABLE_DELAY_MS = 15_000
const runtimeInstanceId = domRuntime?.runtimeInstanceId ?? 'server'
const reloadTick = computed(() => liveInspectorReloadTickFor(frameId))
let retryTimer = 0
let unavailableTimer = 0
let hoverFrame = 0
let pendingHoverPoint: { clientX: number; clientY: number } | null = null

const iframeSrc = computed(() => {
  if (!IS_BROWSER) return route
  return smylrOpenPencilFrameUrlFor({
    baseUrl: smylrFrameBaseUrlFor(window.location.href),
    openPencilHref: window.location.href,
    params: {
      'smylr-openpencil-frame-key': runtimeKey,
      'smylr-openpencil-reload-tick': String(reloadTick.value),
      'smylr-openpencil-runtime-instance-id': runtimeInstanceId
    },
    route
  })
})
const iframeOrigin = computed(() => {
  if (!IS_BROWSER) return ''
  return new URL(iframeSrc.value, window.location.href).origin
})
const iframeKey = computed(() => `${iframeSrc.value}:${String(reloadTick.value)}`)
const ownsInspector = computed(
  () => !componentSurface && liveInspectorActiveFrameId.value === frameId
)
const selectMode = computed(
  () => ownsInspector.value && liveInspectorInteractionMode.value === 'select'
)
const interactMode = computed(() => interactionEnabled)
const surfaceCanReceivePointer = computed(
  () => selectMode.value || canvasSurfaceCanReceivePointer(store.state.activeTool)
)
const iframeCanReceivePointer = computed(() => interactMode.value && surfaceCanReceivePointer.value)

function dispatchInspectorCommand(command: Omit<SmylrOpenPencilInspectorCommand, 'kind'>) {
  const target = iframeRef.value?.contentWindow ?? null
  const origin = iframeOrigin.value
  if (!target || !origin) return false
  target.postMessage({ ...command, kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE }, origin)
  return true
}

function syncIframeElement() {
  const iframe = iframeRef.value
  if (!iframe) return
  iframe.className = `block size-full min-h-0 min-w-0 border-0 ${
    componentSurface ? 'bg-transparent' : 'bg-white'
  } ${iframeCanReceivePointer.value ? 'pointer-events-auto' : 'pointer-events-none'}`
  iframe.tabIndex = iframeCanReceivePointer.value ? 0 : -1
  const src = iframeSrc.value
  if (iframe.getAttribute('src') !== src) iframe.setAttribute('src', src)
}

function currentInspectorMode() {
  if (!componentSurface) return liveInspectorInteractionMode.value
  return interactionEnabled ? 'interact' : 'select'
}

function postMode() {
  if (!componentSurface && !ownsInspector.value) return
  if (ownsInspector.value) {
    setLiveInspectorCommandTarget(iframeRef.value?.contentWindow ?? null, iframeOrigin.value)
  }
  dispatchInspectorCommand({
    action: 'set-interaction-mode',
    mode: currentInspectorMode()
  })
}

function postRuntimeActivity() {
  dispatchInspectorCommand({
    action: 'set-runtime-activity',
    runtimeActivity: ownsInspector.value ? 'active' : 'passive'
  })
}

async function syncFrameFocus() {
  await nextTick()
  const iframe = iframeRef.value
  if (!iframe) return
  if (iframeCanReceivePointer.value) {
    requestAnimationFrame(() => iframe.focus({ preventScroll: true }))
  } else {
    iframe.blur()
  }
}

function queueRetry(src: string) {
  window.clearTimeout(retryTimer)
  retryTimer = window.setTimeout(() => {
    if (
      iframeSrc.value !== src ||
      !ownsInspector.value ||
      liveInspectorStatus.value === 'connected'
    ) {
      return
    }
    postRuntimeActivity()
    postMode()
    dispatchInspectorCommand({ action: 'request-tree' })
    queueRetry(src)
  }, RETRY_DELAY_MS)
}

function requestInspectorTree() {
  if (!ownsInspector.value) return
  const src = iframeSrc.value
  markLiveInspectorFrameLoading(src)
  postRuntimeActivity()
  postMode()
  dispatchInspectorCommand({ action: 'request-tree' })
  queueRetry(src)
  window.clearTimeout(unavailableTimer)
  unavailableTimer = window.setTimeout(
    () => markLiveInspectorFrameUnavailable(src),
    UNAVAILABLE_DELAY_MS
  )
}

function flushHostCompositor() {
  const iframe = iframeRef.value
  const host =
    iframe?.closest<HTMLElement>('[data-code-object-id]') ?? iframe?.parentElement ?? null
  flushLiveIframeSurfaceHost(host)
}

function handleFrameLoad() {
  flushHostCompositor()
  postRuntimeActivity()
  if (componentSurface) postMode()
  if (ownsInspector.value) requestInspectorTree()
}

function postPointCommand(
  action: 'hover-at-point' | 'select-at-point',
  point: { clientX: number; clientY: number }
) {
  const frame = iframeRef.value
  if (!frame) return false
  const rect = frame.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return dispatchInspectorCommand({
    action,
    x: ((point.clientX - rect.left) * frame.clientWidth) / rect.width,
    y: ((point.clientY - rect.top) * frame.clientHeight) / rect.height
  })
}

function selectContainerAtPoint(event: MouseEvent | PointerEvent) {
  postPointCommand('select-at-point', event)
}

function queuePointHover(event: PointerEvent) {
  pendingHoverPoint = { clientX: event.clientX, clientY: event.clientY }
  if (hoverFrame) return
  hoverFrame = requestAnimationFrame(() => {
    hoverFrame = 0
    const point = pendingHoverPoint
    pendingHoverPoint = null
    if (point) postPointCommand('hover-at-point', point)
  })
}

function clearPointHover() {
  if (hoverFrame) cancelAnimationFrame(hoverFrame)
  hoverFrame = 0
  pendingHoverPoint = null
  dispatchInspectorCommand({ action: 'hover-at-point', x: -1, y: -1 })
}

function handleFrameSurfaceWheel(event: WheelEvent) {
  const source = event.currentTarget
  if (!(source instanceof HTMLElement) || !forwardFrameSurfaceWheel(source, event)) return
  event.preventDefault()
  event.stopPropagation()
}

function handleHostOnlyInspectorAction(action: string) {
  if (action === 'interaction-start') {
    emit('interactionStart')
    return true
  }
  if (action === 'exit-interact') {
    emit('exitInteraction')
    return true
  }
  if (action === 'focus-frame') {
    emit('focusFrame')
    return true
  }
  return false
}

function handleInspectorMessage(event: MessageEvent) {
  const iframe = iframeRef.value
  const iframeWindow = iframe?.contentWindow ?? null
  if (
    !iframe ||
    !isLiveInspectorMessageFromFrame(event, iframeOrigin.value, frameId, iframeWindow)
  ) {
    return
  }
  if (isEmbeddedSurfaceWheelMessage(event.data, SMYLR_OPENPENCIL_INSPECTOR_MESSAGE)) {
    if (!ownsInspector.value || event.data.runtimeInstanceId !== runtimeInstanceId) return
    forwardEmbeddedSurfaceWheel(iframe, event.data)
    return
  }
  if (!isSmylrOpenPencilInspectorMessage(event.data)) return
  if (event.data.runtimeInstanceId !== runtimeInstanceId) return
  // Server restart / HMR signals must remount or invalidate this host even
  // when the frame is passive. The canvas compositor keeps a stale layer
  // after an in-frame location.reload().
  if (handleHostOnlyInspectorAction(event.data.action ?? '')) return
  if (event.data.action === 'board-navigate' && event.data.direction) {
    emit('boardNavigate', event.data.direction)
    return
  }
  if (!ownsInspector.value) return
  if (event.data.action === 'select' && !store.state.selectedIds.has(frameId)) {
    store.select([frameId])
  }
  window.clearTimeout(retryTimer)
  window.clearTimeout(unavailableTimer)
  setLiveInspectorCommandTarget(iframeWindow, iframeOrigin.value)
  receiveLiveInspectorMessage(event.data)
  if (event.data.action === 'ready') {
    postRuntimeActivity()
    postMode()
    if (!event.data.document) dispatchInspectorCommand({ action: 'request-tree' })
  }
}

watch(
  () => active,
  (isActive) => {
    if (!isActive || componentSurface) return
    setLiveInspectorActiveFrame(frameId)
    postRuntimeActivity()
    requestInspectorTree()
  },
  { immediate: true }
)

watch(liveInspectorInteractionMode, () => {
  if (componentSurface) return
  postMode()
  void syncFrameFocus()
})
watch(
  () => interactionEnabled,
  () => {
    if (!componentSurface) return
    postMode()
    void syncFrameFocus()
  }
)
watch(surfaceCanReceivePointer, () => void syncFrameFocus())
watch(iframeCanReceivePointer, syncIframeElement)
watch(ownsInspector, () => {
  postRuntimeActivity()
  if (ownsInspector.value) requestInspectorTree()
})
watch(iframeKey, () => {
  syncIframeElement()
  if (ownsInspector.value) markLiveInspectorFrameLoading(iframeSrc.value)
})

useEventListener(window, 'message', handleInspectorMessage)

onMounted(() => {
  const host = iframeHostRef.value
  const runtime = host ? attachTrustedWebAppDomRuntime(frameId, host) : null
  if (runtime) {
    iframeRef.value = runtime.iframe
    runtime.iframe.addEventListener('load', handleFrameLoad)
    syncIframeElement()
  }
  if (componentSurface) return
  if (!liveInspectorActiveFrameId.value) setLiveInspectorActiveFrame(frameId)
})

onBeforeUnmount(() => {
  iframeRef.value?.removeEventListener('load', handleFrameLoad)
  if (preserveCodeObjectRuntimeDuringHotUpdate()) parkTrustedWebAppDomRuntime(frameId)
  else disposeTrustedWebAppDomRuntime(frameId)
})

onUnmounted(() => {
  window.clearTimeout(retryTimer)
  window.clearTimeout(unavailableTimer)
  if (hoverFrame) cancelAnimationFrame(hoverFrame)
  if (ownsInspector.value && !preserveCodeObjectRuntimeDuringHotUpdate()) {
    setLiveInspectorCommandTarget(null)
    setLiveInspectorActiveFrame(null)
  }
})
</script>

<template>
  <div
    class="relative size-full overflow-hidden"
    :class="componentSurface ? 'bg-transparent' : 'bg-white'"
    data-runtime-boundary="trusted-web-app"
    data-test-id="smylr-trusted-web-app"
  >
    <div ref="iframeHostRef" class="size-full" />

    <div
      v-if="selectMode && surfaceCanReceivePointer"
      class="absolute inset-0 z-10 cursor-crosshair"
      data-test-id="smylr-live-select-surface"
      @click.stop.prevent="selectContainerAtPoint"
      @pointerleave="clearPointHover"
      @pointermove="queuePointHover"
      @wheel="handleFrameSurfaceWheel"
    />

    <div
      v-if="!componentSurface && ownsInspector && liveInspectorStatus === 'unavailable'"
      class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-black/55 px-3 py-2 text-[11px] text-white"
      data-test-id="smylr-live-app-connection-warning"
    >
      Live Layers are not connected. Smylr remains available.
    </div>

    <SmylrLiveContainerOverlay
      v-if="ownsInspector && surfaceCanReceivePointer"
      @select-at-point="selectContainerAtPoint"
    />
  </div>
</template>
