<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import {
  forwardEmbeddedSurfaceWheel,
  forwardFrameSurfaceWheel,
  isEmbeddedSurfaceWheelMessage
} from '@/app/editor/canvas/embedded-surface-wheel'
import { useEditorStore } from '@/app/editor/active-store'
import {
  smylrFrameBaseUrlFor,
  smylrOpenPencilFrameUrlFor
} from '@/app/smylr-live-inspector/frame-origin'
import { isLiveInspectorMessageFromFrame } from '@/app/smylr-live-inspector/message-source'
import {
  isSmylrOpenPencilInspectorMessage,
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  liveInspectorReloadTick,
  liveInspectorStatus,
  markLiveInspectorFrameLoading,
  markLiveInspectorFrameUnavailable,
  receiveLiveInspectorMessage,
  setLiveInspectorActiveFrame,
  setLiveInspectorCommandTarget,
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
  type SmylrOpenPencilInspectorCommand
} from '@/app/smylr-live-inspector/session'
import SmylrLiveContainerOverlay from '@/components/SmylrLiveContainerOverlay.vue'
import { IS_BROWSER } from '@/constants'

const { active, frameId, interactionEnabled, route, runtimeKey } = defineProps<{
  active: boolean
  frameId: string
  interactionEnabled: boolean
  route: string
  runtimeKey: string
}>()
const emit = defineEmits<{
  interactionStart: []
  exitInteraction: []
}>()

const store = useEditorStore()
const iframeRef = ref<HTMLIFrameElement | null>(null)
const RETRY_DELAY_MS = 750
const UNAVAILABLE_DELAY_MS = 15_000
const runtimeInstanceId = IS_BROWSER ? globalThis.crypto.randomUUID() : 'server'
let retryTimer = 0
let unavailableTimer = 0

const iframeSrc = computed(() => {
  if (!IS_BROWSER) return route
  return smylrOpenPencilFrameUrlFor({
    baseUrl: smylrFrameBaseUrlFor(window.location.href),
    openPencilHref: window.location.href,
    params: {
      'smylr-openpencil-frame-key': runtimeKey,
      'smylr-openpencil-runtime-instance-id': runtimeInstanceId
    },
    route
  })
})
const iframeOrigin = computed(() => {
  if (!IS_BROWSER) return ''
  return new URL(iframeSrc.value, window.location.href).origin
})
const iframeKey = computed(() => `${iframeSrc.value}:${liveInspectorReloadTick.value}`)
const ownsInspector = computed(() => liveInspectorActiveFrameId.value === frameId)
const selectMode = computed(
  () => ownsInspector.value && liveInspectorInteractionMode.value === 'select'
)
const interactMode = computed(() => interactionEnabled)

function dispatchInspectorCommand(command: Omit<SmylrOpenPencilInspectorCommand, 'kind'>) {
  const target = iframeRef.value?.contentWindow ?? null
  const origin = iframeOrigin.value
  if (!target || !origin) return false
  target.postMessage({ ...command, kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE }, origin)
  return true
}

function postMode() {
  if (!ownsInspector.value) return
  setLiveInspectorCommandTarget(iframeRef.value?.contentWindow ?? null, iframeOrigin.value)
  dispatchInspectorCommand({
    action: 'set-interaction-mode',
    mode: liveInspectorInteractionMode.value
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
  if (interactMode.value) {
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
    postMode()
    dispatchInspectorCommand({ action: 'request-tree' })
    queueRetry(src)
  }, RETRY_DELAY_MS)
}

function requestInspectorTree() {
  if (!ownsInspector.value) return
  const src = iframeSrc.value
  markLiveInspectorFrameLoading(src)
  postMode()
  dispatchInspectorCommand({ action: 'request-tree' })
  queueRetry(src)
  window.clearTimeout(unavailableTimer)
  unavailableTimer = window.setTimeout(
    () => markLiveInspectorFrameUnavailable(src),
    UNAVAILABLE_DELAY_MS
  )
}

function handleFrameLoad() {
  postRuntimeActivity()
  if (ownsInspector.value) requestInspectorTree()
}

function postPointCommand(
  action: 'hover-at-point' | 'select-at-point',
  event: MouseEvent | PointerEvent
) {
  const frame = iframeRef.value
  if (!frame) return
  const rect = frame.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  dispatchInspectorCommand({
    action,
    x: ((event.clientX - rect.left) * frame.clientWidth) / rect.width,
    y: ((event.clientY - rect.top) * frame.clientHeight) / rect.height
  })
}

function clearPointHover() {
  dispatchInspectorCommand({ action: 'hover-at-point', x: -1, y: -1 })
}

function handleFrameSurfaceWheel(event: WheelEvent) {
  const source = event.currentTarget
  if (!(source instanceof HTMLElement) || !forwardFrameSurfaceWheel(source, event)) return
  event.preventDefault()
  event.stopPropagation()
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
  if (event.data.action === 'interaction-start') {
    emit('interactionStart')
    return
  }
  if (!ownsInspector.value) return
  if (event.data.action === 'exit-interact') {
    emit('exitInteraction')
    return
  }
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
    if (!isActive) return
    setLiveInspectorActiveFrame(frameId)
    postRuntimeActivity()
    requestInspectorTree()
  },
  { immediate: true }
)

watch(liveInspectorInteractionMode, () => {
  postMode()
  void syncFrameFocus()
})
watch(ownsInspector, () => {
  postRuntimeActivity()
  if (ownsInspector.value) requestInspectorTree()
})
watch(iframeKey, () => {
  if (ownsInspector.value) markLiveInspectorFrameLoading(iframeSrc.value)
})

useEventListener(window, 'message', handleInspectorMessage)

onMounted(() => {
  if (!liveInspectorActiveFrameId.value) setLiveInspectorActiveFrame(frameId)
})

onUnmounted(() => {
  window.clearTimeout(retryTimer)
  window.clearTimeout(unavailableTimer)
  if (ownsInspector.value) {
    setLiveInspectorCommandTarget(null)
    setLiveInspectorActiveFrame(null)
  }
})
</script>

<template>
  <div
    class="relative size-full overflow-hidden bg-white"
    data-runtime-boundary="trusted-web-app"
    data-test-id="smylr-trusted-web-app"
  >
    <iframe
      ref="iframeRef"
      :key="iframeKey"
      :data-live-frame-id="frameId"
      :data-runtime-instance-id="runtimeInstanceId"
      data-test-id="smylr-trusted-web-app-frame"
      :src="iframeSrc"
      title="Smylr production app"
      class="block size-full min-h-0 min-w-0 border-0 bg-white"
      :class="interactMode ? 'pointer-events-auto' : 'pointer-events-none'"
      :tabindex="interactMode ? 0 : -1"
      loading="eager"
      @load="handleFrameLoad"
    />

    <div
      v-if="selectMode"
      class="absolute inset-0 z-10 cursor-crosshair"
      data-test-id="smylr-live-select-surface"
      @click.stop.prevent="postPointCommand('select-at-point', $event)"
      @pointerleave="clearPointHover"
      @pointermove="postPointCommand('hover-at-point', $event)"
      @wheel="handleFrameSurfaceWheel"
    />

    <div
      v-if="ownsInspector && liveInspectorStatus === 'loading'"
      class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-blue-600/85 px-3 py-2 text-[11px] text-white"
      data-test-id="smylr-live-app-loading"
    >
      Connecting live layers…
    </div>
    <div
      v-if="ownsInspector && liveInspectorStatus === 'unavailable'"
      class="pointer-events-none absolute inset-x-0 top-0 z-20 bg-black/55 px-3 py-2 text-[11px] text-white"
      data-test-id="smylr-live-app-connection-warning"
    >
      Smylr is visible; live Layers are reconnecting.
    </div>

    <SmylrLiveContainerOverlay
      v-if="ownsInspector"
      @select-at-point="postPointCommand('select-at-point', $event)"
    />
  </div>
</template>
