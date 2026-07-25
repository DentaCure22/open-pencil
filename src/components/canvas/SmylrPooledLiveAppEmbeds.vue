<script setup lang="ts">
import { useEventListener, useUrlSearchParams } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { readCacheJson, writeCacheJson } from '@/app/cache'
import { codeObjectDocument } from '@/app/code-object/model'
import { useEditorStore } from '@/app/editor/active-store'
import {
  isSmylrLiveComponentFrame,
  smylrLiveComponentDisplayName,
  syncSmylrLiveComponentIntrinsicSize
} from '@/app/smylr-component-library/live-component-canvas'
import {
  workLifecycleActionLabel,
  workLifecycleStatusLabel,
  type WorkLifecycleAction
} from '@/app/flow-state'
import type { ExperienceProjectionPurpose } from '@/app/workspace'
import {
  forwardEmbeddedSurfaceWheel,
  forwardFrameSurfaceWheel,
  isEmbeddedSurfaceWheelMessage
} from '@/app/editor/canvas/embedded-surface-wheel'
import { smylrFrameBaseUrlFor } from '@/app/smylr-live-inspector/frame-origin'
import { isLiveInspectorMessageFromFrame } from '@/app/smylr-live-inspector/message-source'
import {
  isSmylrOpenPencilInspectorMessage,
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  liveInspectorSelectedId,
  receiveLiveInspectorMessage,
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
  setLiveInspectorCommandTarget,
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import {
  addLiveWorkspaceItemToFlow,
  approveLiveWorkspaceItemForMerge,
  availableLiveWorkspaceLifecycleActions,
  completeLiveWorkspacePreview,
  createLiveWorkspaceItemChangeSet,
  failLiveWorkspacePreview,
  liveWorkspaceLifecycle,
  liveWorkspaceLifecycleLabel,
  liveWorkspaceItems,
  markLiveWorkspaceItemPreferred,
  requestLiveWorkspaceItemChanges,
  restoreLiveWorkspace,
  saveLiveWorkspaceItem,
  sendLiveWorkspaceItemToReview,
  setLiveWorkspaceItemRuntimeRoute,
  setLiveWorkspaceItemPreview,
  startLiveWorkspaceImplementation,
  startLiveWorkspaceBranch,
  transitionLiveWorkspaceLifecycle,
  type LiveWorkspaceItem,
  workspaceItemPatches
} from '@/app/smylr-live-inspector/workspace'
import { runLiveWorkspaceMutationWithUndo } from '@/app/smylr-live-inspector/history'
import { syncLiveWorkspaceExperienceProjection } from '@/app/smylr-live-inspector/experience-projections'
import {
  resolveSnapshotSource,
  SMYLR_LIVE_FRAME_SNAPSHOT_CACHE_NAMESPACE
} from '@/app/smylr-production/live/snapshot-fallback'
import {
  isSmylrReadOnlyReferenceFrame,
  smylrRuntimeBaseUrlForFrame
} from '@/app/smylr-production/live/reference-runtime'
import {
  appScreenFlowPluginValue,
  isNativeReactAppFlowFrame
} from '@/app/smylr-production/app-flow/primitives'
import { syncAppScreenFlowGeometryForNode } from '@/app/smylr-production/app-flow/scene'
import { liveFrameCornerStyle } from '@/app/smylr-production/frame-corners'
import {
  createLiveFrameTransformController,
  LIVE_FRAME_RESIZE_HANDLE_STYLE,
  LIVE_FRAME_ROTATE_HANDLE_STYLE,
  liveFrameCanvasStyle,
  liveFrameHeaderStyle,
  liveFrameResizeHandles,
  liveFrameRotationHandles,
  liveFrameScreenOverlayStyle
} from '@/app/smylr-production/frame-transform'
import { reindexLiveFrameWorkspaceItemLinks } from '@/app/smylr-production/live/frame-deletion'
import {
  resolveSelectedLiveRuntimeFrameId,
  shouldShowLiveRuntime
} from '@/app/smylr-production/live/runtime-retention'
import {
  smylrLiveRuntimeLabelFor,
  smylrLiveRuntimeTargetFor,
  smylrLiveRuntimeUrlFor
} from '@/app/smylr-production/live/runtime-target'
import { isWorkspaceItemTombstoned } from '@/app/smylr-production/live/frame-tombstones'
import {
  moveBetweenSmylrProductionViews,
  runSmylrProductionViewMovement
} from '@/app/smylr-production/view-state'
import {
  ensureSmylrAlternateLiveAppFrame,
  findSmylrAppViewPage,
  findSmylrLiveAppFrames,
  fitSmylrPageToViewport,
  isSmylrFlowPageNode,
  smylrLiveAppFrameRoute,
  smylrLiveAppFrameDisplayName,
  smylrLiveAppFrameState,
  smylrLiveAppFrameWorkspaceItemId,
  type SmylrAppViewKind
} from '@/app/smylr-production/workspace'
import {
  clearWorkspaceExperienceProjectionPage,
  workspacePluginValue
} from '@/app/workspace-ui/projection'
import { useKnowledgeWorkspaceUi } from '@/app/workspace-ui/use'

import SmylrLiveContainerOverlay from '../SmylrLiveContainerOverlay.vue'
import Tip from '../ui/Tip.vue'
import SmylrLiveFrameViewportControls from './SmylrLiveFrameViewportControls.vue'
import './smylr-live-frame-header.css'

type PreviewStatus = 'queued' | 'rendering' | 'ready' | 'failed'

const PREVIEW_TIMEOUT_MS = 15_000
const WORKFLOW_ACTION_PRIORITY: Record<WorkLifecycleAction, number> = {
  approve: 0,
  archive: 2,
  'create-change-set': 0,
  'mark-preferred': 0,
  'request-changes': 1,
  'request-review': 0,
  'start-branch': 0,
  'start-draft': 0,
  'start-implementation': 0,
  verify: 0
}
const EXPERIENCE_PURPOSES: Array<{ label: string; purpose: ExperienceProjectionPurpose }> = [
  { label: 'Focus', purpose: 'focus' },
  { label: 'Compare', purpose: 'compare' },
  { label: 'Knowledge', purpose: 'knowledge' },
  { label: 'Review', purpose: 'review' }
]
const SMYLR_OPENPENCIL_COMPONENT_READY = 'SMYLR_OPENPENCIL_COMPONENT_READY_V1'
const store = useEditorStore()
const workspaceUi = useKnowledgeWorkspaceUi(store)
const activeExperienceProjection = workspaceUi.experienceProjection
const params = useUrlSearchParams('history')
const syncTick = ref(0)
const snapshots = ref<Record<string, string>>({})
const previewStatuses = ref<Record<string, PreviewStatus>>({})
const previewQueue = ref<string[]>([])
const previewWorkerFrameId = ref<string | null>(null)
const selectedRuntimeFrameId = ref<string | null>(null)
const lastInteractedRuntimeFrameId = ref<string | null>(null)
const retainedRuntimeFrameId = ref<string | null>(null)
const sharedRuntimeLoadedFrameId = ref<string | null>(null)
const sharedRuntimeHydrationVersion = ref(0)
const sharedRuntimeReady = ref(false)
const sharedIframeElement = ref<HTMLIFrameElement | null>(null)
const selectedRuntimeMode = ref<'select' | 'interact' | null>(null)
const openWorkflowMenuId = ref<string | null>(null)
const lastWorkflowUndoItemId = ref<string | null>(null)
const workflowAcceptanceDrafts = ref<Record<string, string>>({})
const hoveredFrameIds = ref(new Set<string>())
const alternateHeaderDrag = ref<{
  frameId: string
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
} | null>(null)
const componentHeaderDrag = ref<{
  frameId: string
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
} | null>(null)
const iframeElements = new Map<string, HTMLIFrameElement>()
const componentIframeElements = new Map<string, HTMLIFrameElement>()
const componentReadyFrameIds = ref(new Set<string>())
const captureTimers = new Map<string, number>()
const previewTimeouts = new Map<string, number>()
const captureRequested = new Set<string>()
const alternateHeaderHideTimers = new Map<string, number>()
let unsubscribe: Array<() => void> = []

const baseUrl = computed(() => {
  const explicit = params['smylr-base'] ?? params['smylr-origin']
  return typeof explicit === 'string' && explicit.length > 0
    ? explicit.replace(/\/+$/, '')
    : smylrFrameBaseUrlFor(window.location.href)
})

function runtimeBaseUrlForFrame(frame: SceneNode) {
  return smylrRuntimeBaseUrlForFrame(frame, baseUrl.value)
}

function runtimeOriginForFrameId(frameId: string) {
  const frame = store.graph.getNode(frameId)
  return new URL(frame ? runtimeBaseUrlForFrame(frame) : baseUrl.value).origin
}

function isReadOnlyReferenceFrame(frameId: string) {
  return isSmylrReadOnlyReferenceFrame(store.graph.getNode(frameId))
}

const liveFrames = computed(() => {
  void syncTick.value
  return findSmylrLiveAppFrames(store)
})
const componentFrames = computed(() =>
  liveFrames.value.filter(
    (frame) => isSmylrLiveComponentFrame(frame) && smylrLiveAppFrameState(frame) !== 'current'
  )
)
const selectedComponentFrame = computed(() => {
  if (store.state.selectedIds.size !== 1) return null
  const [selectedId] = store.state.selectedIds
  return componentFrames.value.find((frame) => frame.id === selectedId) ?? null
})
const alternateFrames = computed(() => {
  return liveFrames.value.filter(
    (frame) =>
      smylrLiveAppFrameState(frame) !== 'current' &&
      !isSmylrLiveComponentFrame(frame) &&
      !isNativeReactAppFlowFrame(frame) &&
      codeObjectDocument(frame) === null
  )
})

const interactionRuntimeFrameId = computed(() => selectedRuntimeFrameId.value)
const sharedRuntimeOwnerFrameId = computed(() => {
  void syncTick.value
  const lastInteractedFrameId = lastInteractedRuntimeFrameId.value
  const retainedInteractionFrameId =
    lastInteractedFrameId && store.graph.getNode(lastInteractedFrameId)
      ? lastInteractedFrameId
      : null
  return selectedRuntimeFrameId.value ?? retainedInteractionFrameId ?? previewWorkerFrameId.value
})

function sync() {
  syncTick.value += 1
}

function setAlternateFrameHovered(frameId: string, hovered: boolean) {
  const next = new Set(hoveredFrameIds.value)
  if (hovered) next.add(frameId)
  else next.delete(frameId)
  hoveredFrameIds.value = next
}

function revealAlternateFrameHeader(frameId: string) {
  const timer = alternateHeaderHideTimers.get(frameId)
  if (timer) window.clearTimeout(timer)
  alternateHeaderHideTimers.delete(frameId)
  setAlternateFrameHovered(frameId, true)
}

function hideAlternateFrameHeaderSoon(frameId: string) {
  const timer = alternateHeaderHideTimers.get(frameId)
  if (timer) window.clearTimeout(timer)
  alternateHeaderHideTimers.set(
    frameId,
    window.setTimeout(() => {
      alternateHeaderHideTimers.delete(frameId)
      if (alternateHeaderDrag.value?.frameId !== frameId && openWorkflowMenuId.value !== frameId) {
        setAlternateFrameHovered(frameId, false)
      }
    }, 140)
  )
}

function shouldShowAlternateFrameHeader(frameId: string) {
  if (!isFlowView()) return true
  return hoveredFrameIds.value.has(frameId) || liveInspectorActiveFrameId.value === frameId
}

function workspaceItemForFrame(frameId: string) {
  const frame = store.graph.getNode(frameId)
  const itemId = frame ? smylrLiveAppFrameWorkspaceItemId(frame) : null
  return itemId ? (liveWorkspaceItems.value.find((item) => item.id === itemId) ?? null) : null
}

function snapshotCacheKey(frameId: string) {
  const frame = store.graph.getNode(frameId)
  if (!frame) return ''
  return `${SMYLR_LIVE_FRAME_SNAPSHOT_CACHE_NAMESPACE}/${encodeURIComponent(smylrLiveAppFrameRoute(frame))}/${encodeURIComponent(smylrLiveAppFrameState(frame))}`
}

function hasSharpPersistedPreview(
  frame: { height: number; width: number },
  preview: { height?: number; width?: number } | undefined
) {
  if (!preview?.height || !preview.width) return false
  return preview.width >= frame.width * 1.25 && preview.height >= frame.height * 1.25
}

function setPreviewStatus(frameId: string, status: PreviewStatus) {
  previewStatuses.value = { ...previewStatuses.value, [frameId]: status }
}

function previewStatus(frameId: string): PreviewStatus {
  return previewStatuses.value[frameId] ?? 'queued'
}

function runtimeTargetForFrame(frame: SceneNode) {
  return smylrLiveRuntimeTargetFor({
    flowNodeKind: appScreenFlowPluginValue(frame, 'appFlowNodeKind'),
    route: smylrLiveAppFrameRoute(frame),
    state: smylrLiveAppFrameState(frame)
  })
}

function runtimeLabelForFrame(frame: SceneNode) {
  return smylrLiveRuntimeLabelFor(runtimeTargetForFrame(frame))
}

function previewStatusLabel(frameId: string) {
  switch (previewStatus(frameId)) {
    case 'rendering':
      return 'Capturing live source'
    case 'queued':
      return 'Live snapshot queued'
    case 'failed':
      return 'Live snapshot unavailable'
    case 'ready':
      return 'Live snapshot ready'
  }
}

function previewStatusDetail(frameId: string, frame: SceneNode) {
  switch (previewStatus(frameId)) {
    case 'rendering':
      return 'Capturing from the source-backed runtime.'
    case 'queued':
      return 'Queued for the shared source-backed runtime.'
    case 'failed':
      return `Select to load ${runtimeLabelForFrame(frame)} live, or retry.`
    case 'ready':
      return `Rendered from ${runtimeLabelForFrame(frame)}.`
  }
}

function clearFrameTimers(frameId: string) {
  const captureTimer = captureTimers.get(frameId)
  if (captureTimer) window.clearTimeout(captureTimer)
  captureTimers.delete(frameId)
  const timeout = previewTimeouts.get(frameId)
  if (timeout) window.clearTimeout(timeout)
  previewTimeouts.delete(frameId)
  captureRequested.delete(frameId)
}

function ensureWorkspaceFrames() {
  // Only materialize frames for items that still exist and were not tombstoned.
  for (const item of liveWorkspaceItems.value) {
    if (
      !['variant', 'flow', 'review', 'change-set'].includes(item.kind) ||
      item.status === 'archived' ||
      isWorkspaceItemTombstoned(item.id)
    )
      continue
    ensureSmylrAlternateLiveAppFrame(store, item)
  }
  reindexLiveFrameWorkspaceItemLinks(store)
  sync()
}

async function restoreSnapshots() {
  const entries = await Promise.all(
    alternateFrames.value.map(async (frame) => {
      const item = workspaceItemForFrame(frame.id)
      const persistedPreview =
        item?.preview?.status === 'ready' &&
        item.preview.dataUrl &&
        hasSharpPersistedPreview(frame, item.preview)
          ? item.preview.dataUrl
          : null
      const cachedPreview = persistedPreview
        ? null
        : await readCacheJson<string>(snapshotCacheKey(frame.id))
      return [
        frame.id,
        resolveSnapshotSource({
          cachedSnapshot: cachedPreview,
          policy: 'source-only',
          sharpPersistedPreview: persistedPreview
        }),
        item?.preview?.status
      ] as const
    })
  )
  const nextSnapshots: Record<string, string> = {}
  const nextStatuses: Record<string, PreviewStatus> = {}
  for (const [frameId, dataUrl, persistedStatus] of entries) {
    if (dataUrl) {
      nextSnapshots[frameId] = dataUrl
      nextStatuses[frameId] = 'ready'
    } else if (persistedStatus && persistedStatus !== 'ready') {
      nextStatuses[frameId] = persistedStatus
    } else {
      nextStatuses[frameId] = 'queued'
    }
  }
  snapshots.value = nextSnapshots
  previewStatuses.value = nextStatuses
}

function activateRuntimeFrame(selectedId: string | null) {
  if (selectedId === selectedRuntimeFrameId.value) return
  const interruptedWorker = previewWorkerFrameId.value
  if (interruptedWorker && interruptedWorker !== selectedId) {
    clearFrameTimers(interruptedWorker)
    setPreviewStatus(interruptedWorker, 'queued')
    if (!previewQueue.value.includes(interruptedWorker)) {
      previewQueue.value.unshift(interruptedWorker)
    }
    previewWorkerFrameId.value = null
  }
  selectedRuntimeFrameId.value = selectedId
  bindSharedRuntimeToFrame(sharedRuntimeOwnerFrameId.value)
  if (selectedId && sharedRuntimeReady.value) activateWorkspacePatches(selectedId)
  if (!selectedId) window.setTimeout(startNextPreview, 0)
}

function enqueueMissingSnapshots() {
  const workerId = previewWorkerFrameId.value
  const queuedIds = new Set(previewQueue.value)
  for (const frame of alternateFrames.value) {
    if (snapshots.value[frame.id] || frame.id === workerId || queuedIds.has(frame.id)) continue
    previewQueue.value.push(frame.id)
    queuedIds.add(frame.id)
  }
}

function startNextPreview() {
  if (
    selectedRuntimeFrameId.value ||
    lastInteractedRuntimeFrameId.value ||
    previewWorkerFrameId.value ||
    !sharedRuntimeReady.value
  ) {
    return
  }
  const validIds = new Set(alternateFrames.value.map((frame) => frame.id))
  let frameId = previewQueue.value.shift() ?? null
  while (frameId && (!validIds.has(frameId) || snapshots.value[frameId])) {
    frameId = previewQueue.value.shift() ?? null
  }
  if (!frameId) return
  previewWorkerFrameId.value = frameId
  setPreviewStatus(frameId, 'rendering')
  bindSharedRuntimeToFrame(frameId)
  activateWorkspacePatches(frameId)
}

function activateSelectedRuntime() {
  const frameId = resolveSelectedLiveRuntimeFrameId({
    activeFrameId: liveInspectorActiveFrameId.value,
    alternateFrameIds: alternateFrames.value.map((frame) => frame.id),
    hasLiveContainerSelection: Boolean(liveInspectorSelectedId.value),
    selectedSceneNodeIds: store.state.selectedIds
  })
  // Frame mode still blocks pointer interaction, but the selected iframe now
  // owns the inspector immediately so its live tree can populate Layers.
  activateRuntimeFrame(frameId)
}

function releaseFlowRuntimeForOverview() {
  if (!isFlowView() || store.state.selectedIds.size > 0 || liveInspectorSelectedId.value) {
    return false
  }
  selectedRuntimeMode.value = null
  lastInteractedRuntimeFrameId.value = null
  setLiveInspectorActiveFrame(null)
  activateRuntimeFrame(null)
  return true
}

function syncSelectedComponentMode() {
  const frame = selectedComponentFrame.value
  const activeFrame = liveInspectorActiveFrameId.value
    ? store.graph.getNode(liveInspectorActiveFrameId.value)
    : null

  if (!frame) {
    if (!activeFrame || !isSmylrLiveComponentFrame(activeFrame)) return
    postComponentRuntimeMode(activeFrame.id, 'frame')
    setLiveInspectorActiveFrame(null)
    if (liveInspectorInteractionMode.value === 'interact') {
      setLiveInspectorInteractionMode('frame')
    }
    return
  }

  const keepsInteraction =
    liveInspectorActiveFrameId.value === frame.id &&
    liveInspectorInteractionMode.value === 'interact'
  setLiveInspectorActiveFrame(frame.id)
  if (!keepsInteraction) {
    setLiveInspectorInteractionMode('frame')
    postComponentRuntimeMode(frame.id, 'frame')
  }
}

async function reconcilePool() {
  ensureWorkspaceFrames()
  const lastInteractedFrameId = lastInteractedRuntimeFrameId.value
  if (lastInteractedFrameId && !store.graph.getNode(lastInteractedFrameId)) {
    lastInteractedRuntimeFrameId.value = null
  }
  activateSelectedRuntime()
  await restoreSnapshots()
  enqueueMissingSnapshots()
  startNextPreview()
}

onMounted(() => {
  unsubscribe = [
    store.onEditorEvent('graph:replaced', () => {
      sync()
      void reconcilePool()
    }),
    store.onEditorEvent('page:changed', () => {
      sync()
      previewQueue.value = []
      previewWorkerFrameId.value = null
      selectedRuntimeFrameId.value = null
      selectedRuntimeMode.value = null
      if (isFlowView()) {
        lastInteractedRuntimeFrameId.value = null
        setLiveInspectorActiveFrame(null)
      }
      bindSharedRuntimeToFrame(sharedRuntimeOwnerFrameId.value)
      syncSelectedComponentMode()
      void reconcilePool()
    }),
    store.onEditorEvent('node:updated', (id, changes) => {
      sync()
      if (!['height', 'width', 'x', 'y'].some((key) => key in changes)) return
      const node = store.graph.getNode(id)
      syncAppScreenFlowGeometryForNode(store.graph, node)
    }),
    store.onEditorEvent('selection:changed', () => {
      sync()
      syncSelectedComponentMode()
      if (!releaseFlowRuntimeForOverview()) activateSelectedRuntime()
    })
  ]
  syncSelectedComponentMode()
  void restoreLiveWorkspace().then(reconcilePool)
})

onUnmounted(() => {
  unsubscribe.forEach((stop) => stop())
  captureTimers.forEach((timer) => window.clearTimeout(timer))
  previewTimeouts.forEach((timer) => window.clearTimeout(timer))
  alternateHeaderHideTimers.forEach((timer) => window.clearTimeout(timer))
  componentIframeElements.clear()
  componentReadyFrameIds.value = new Set()
})

watch(liveWorkspaceItems, () => {
  void reconcilePool()
})

watch(liveInspectorInteractionMode, (mode) => {
  const activeFrameId = liveInspectorActiveFrameId.value
  const activeFrame = activeFrameId ? store.graph.getNode(activeFrameId) : null
  const activeAlternate = Boolean(activeFrame && smylrLiveAppFrameState(activeFrame) !== 'current')
  selectedRuntimeMode.value =
    activeAlternate && (mode === 'select' || mode === 'interact') ? mode : null
  activateSelectedRuntime()
  const frameId = selectedRuntimeFrameId.value
  if (frameId) postRuntimeCommand(frameId, 'set-interaction-mode')
})

watch(liveInspectorActiveFrameId, (frameId) => {
  const selectedFrame = frameId ? store.graph.getNode(frameId) : null
  if (selectedFrame && smylrLiveAppFrameState(selectedFrame) === 'current') {
    selectedRuntimeMode.value = null
    // Keep the shared iframe warm, but release its interaction lease as soon
    // as Current becomes authoritative. Otherwise late tree/hover packets
    // from the alternate can steal the inspector back from Current.
    activateRuntimeFrame(null)
  }
})

function bindSharedRuntimeToFrame(frameId: string | null) {
  if (frameId) {
    retainedRuntimeFrameId.value = frameId
    if (sharedRuntimeLoadedFrameId.value !== frameId) {
      sharedRuntimeLoadedFrameId.value = frameId
      sharedRuntimeReady.value = false
    }
  }
  iframeElements.clear()
  const iframe = sharedIframeElement.value
  if (frameId && iframe) iframeElements.set(frameId, iframe)
}

function hydrateRuntimeFrame(frameId: string) {
  sharedRuntimeHydrationVersion.value += 1
  sharedRuntimeReady.value = false
  bindSharedRuntimeToFrame(frameId)
}

function setSharedIframeElement(value: Element | null) {
  sharedIframeElement.value = value instanceof HTMLIFrameElement ? value : null
  bindSharedRuntimeToFrame(sharedRuntimeOwnerFrameId.value)
}

function scheduleSnapshot(frameId: string, delay = 350) {
  if (snapshots.value[frameId] || captureRequested.has(frameId)) return
  setPreviewStatus(frameId, 'rendering')
  const previous = captureTimers.get(frameId)
  if (previous) window.clearTimeout(previous)
  captureTimers.set(
    frameId,
    window.setTimeout(() => prepareAndRequestSnapshot(frameId), delay)
  )
}

function postRuntimeCommand(
  frameId: string,
  action: 'request-tree' | 'set-interaction-mode',
  mode = selectedRuntimeFrameId.value === frameId
    ? (selectedRuntimeMode.value ?? liveInspectorInteractionMode.value)
    : liveInspectorInteractionMode.value
) {
  const iframe = iframeElements.get(frameId)
  const target = iframe?.contentWindow
  if (!target) return
  target.postMessage(
    {
      action,
      kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
      mode
    },
    runtimeOriginForFrameId(frameId)
  )
}

function activateWorkspacePatches(frameId: string) {
  const target = iframeElements.get(frameId)?.contentWindow
  if (!target) return
  target.postMessage(
    { action: 'clear-all-preview-styles', kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE },
    runtimeOriginForFrameId(frameId)
  )
  window.setTimeout(() => {
    if (sharedRuntimeOwnerFrameId.value !== frameId) return
    applyWorkspacePatches(frameId)
    postRuntimeCommand(frameId, 'set-interaction-mode')
    postRuntimeCommand(frameId, 'request-tree')
    if (!snapshots.value[frameId]) scheduleSnapshot(frameId, 650)
  }, 0)
}

function handleSharedRuntimeLoad() {
  sharedRuntimeReady.value = true
  const frameId = sharedRuntimeOwnerFrameId.value
  if (frameId) activateWorkspacePatches(frameId)
  else startNextPreview()
}

function applyWorkspacePatches(frameId: string) {
  const target = iframeElements.get(frameId)?.contentWindow
  const item = workspaceItemForFrame(frameId)
  if (!target || !item) return
  for (const patch of workspaceItemPatches(item)) {
    target.postMessage(
      {
        action: 'apply-preview-style',
        kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
        nodeId: patch.nodeId,
        styles: patch.styles,
        tokenPatch: { add: patch.add, remove: patch.remove }
      },
      runtimeOriginForFrameId(frameId)
    )
  }
}

function prepareAndRequestSnapshot(frameId: string) {
  const iframe = iframeElements.get(frameId)
  const target = iframe?.contentWindow
  if (!target) {
    failPreview(frameId)
    return
  }
  const item = workspaceItemForFrame(frameId)
  if (item) applyWorkspacePatches(frameId)
  captureTimers.set(
    frameId,
    window.setTimeout(() => requestSnapshot(frameId), item ? 250 : 0)
  )
}

function requestSnapshot(frameId: string) {
  if (captureRequested.has(frameId)) return
  const iframe = iframeElements.get(frameId)
  if (!iframe?.contentWindow) {
    failPreview(frameId)
    return
  }
  captureRequested.add(frameId)
  previewTimeouts.set(
    frameId,
    window.setTimeout(() => failPreview(frameId), PREVIEW_TIMEOUT_MS)
  )
  iframe.contentWindow.postMessage(
    { action: 'request-snapshot', kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE },
    runtimeOriginForFrameId(frameId)
  )
}

function completePreview(
  frameId: string,
  dataUrl: string,
  face: { height?: number; mimeType?: string; width?: number }
) {
  const frame = store.graph.getNode(frameId)
  if (!frame) return
  clearFrameTimers(frameId)
  snapshots.value = { ...snapshots.value, [frameId]: dataUrl }
  setPreviewStatus(frameId, 'ready')
  const cacheKey = snapshotCacheKey(frameId)
  if (cacheKey) void writeCacheJson(cacheKey, dataUrl)
  const item = workspaceItemForFrame(frameId)
  if (item) {
    completeLiveWorkspacePreview(item.id, {
      dataUrl,
      height: face.height,
      mimeType: face.mimeType,
      width: face.width
    })
  }
  if (previewWorkerFrameId.value === frameId) {
    previewWorkerFrameId.value = null
    bindSharedRuntimeToFrame(sharedRuntimeOwnerFrameId.value)
    window.setTimeout(startNextPreview, 500)
  }
}

function failPreview(frameId: string) {
  clearFrameTimers(frameId)
  setPreviewStatus(frameId, 'failed')
  const item = workspaceItemForFrame(frameId)
  if (item) failLiveWorkspacePreview(item.id)
  if (previewWorkerFrameId.value === frameId) {
    previewWorkerFrameId.value = null
    bindSharedRuntimeToFrame(sharedRuntimeOwnerFrameId.value)
    window.setTimeout(startNextPreview, 500)
  }
}

function retryPreview(frameId: string) {
  clearFrameTimers(frameId)
  if (previewWorkerFrameId.value === frameId) {
    previewWorkerFrameId.value = null
    bindSharedRuntimeToFrame(sharedRuntimeOwnerFrameId.value)
  }
  setPreviewStatus(frameId, 'queued')
  const item = workspaceItemForFrame(frameId)
  if (item) setLiveWorkspaceItemPreview(item.id, { status: 'queued' })
  if (!previewQueue.value.includes(frameId)) previewQueue.value.unshift(frameId)
  if (selectedRuntimeFrameId.value === frameId && sharedRuntimeReady.value) {
    activateWorkspacePatches(frameId)
    return
  }
  startNextPreview()
}

function handleSharedRuntimeWheelMessage(event: MessageEvent) {
  if (!isEmbeddedSurfaceWheelMessage(event.data, SMYLR_OPENPENCIL_INSPECTOR_MESSAGE)) return
  const frameId = sharedRuntimeOwnerFrameId.value
  const expectedOrigin = frameId ? runtimeOriginForFrameId(frameId) : ''
  if (
    !frameId ||
    !isLiveInspectorMessageFromFrame(
      event,
      expectedOrigin,
      frameId,
      sharedIframeElement.value?.contentWindow ?? null
    )
  )
    return
  const iframe = sharedIframeElement.value
  if (iframe) forwardEmbeddedSurfaceWheel(iframe, event.data)
}

function handleFrameSurfaceWheel(event: WheelEvent) {
  if (!(event.currentTarget instanceof HTMLElement)) return
  if (!forwardFrameSurfaceWheel(event.currentTarget, event)) return
  event.preventDefault()
  event.stopPropagation()
}

useEventListener(window, 'message', handleSharedRuntimeWheelMessage)

useEventListener(window, 'message', (event: MessageEvent) => {
  if (!isSmylrOpenPencilInspectorMessage(event.data)) return
  const frameId = sharedRuntimeOwnerFrameId.value
  const expectedOrigin = frameId ? runtimeOriginForFrameId(frameId) : ''
  if (
    !frameId ||
    !isLiveInspectorMessageFromFrame(
      event,
      expectedOrigin,
      frameId,
      sharedIframeElement.value?.contentWindow ?? null
    )
  )
    return
  if (event.data.action === 'ready') {
    sharedRuntimeReady.value = true
    if (frameId) activateWorkspacePatches(frameId)
  }
  if (!frameId) return
  const runtimeRoute = event.data.route ?? event.data.document?.route
  const item = runtimeRoute ? workspaceItemForFrame(frameId) : null
  if (runtimeRoute && item) setLiveWorkspaceItemRuntimeRoute(item.id, runtimeRoute)
  const ownsInspector =
    selectedRuntimeFrameId.value === frameId && liveInspectorActiveFrameId.value === frameId
  if (ownsInspector) {
    const target = iframeElements.get(frameId)?.contentWindow ?? null
    setLiveInspectorCommandTarget(target, event.origin)
    receiveLiveInspectorMessage(event.data)
    const desiredMode = selectedRuntimeMode.value
    if (desiredMode && event.data.mode && event.data.mode !== desiredMode) {
      setLiveInspectorInteractionMode(desiredMode)
      postRuntimeCommand(frameId, 'set-interaction-mode', desiredMode)
    }
  }
  if (event.data.action === 'ready' && !event.data.document) {
    return
  }
  const face =
    event.data.pageFace ??
    event.data.document?.pageFace ??
    event.data.document?.pages?.[0]?.pageFace
  if (face?.dataUrl) completePreview(frameId, face.dataUrl, face)
})

function frameStyle(frameId: string) {
  void syncTick.value
  const frame = store.graph.getNode(frameId)
  if (!frame) return {}
  return liveFrameCanvasStyle(store, frame)
}

function componentRuntimeSrc(frameId: string) {
  const frame = store.graph.getNode(frameId)
  if (!frame) return ''
  const route = smylrLiveAppFrameRoute(frame)
  return `${baseUrl.value}${route.startsWith('/') ? route : `/${route}`}`
}

function setComponentFrameReady(frameId: string, ready: boolean) {
  const next = new Set(componentReadyFrameIds.value)
  if (ready) next.add(frameId)
  else next.delete(frameId)
  componentReadyFrameIds.value = next
}

function setComponentIframeElement(frameId: string, value: Element | null) {
  const iframe = value instanceof HTMLIFrameElement ? value : null
  if (componentIframeElements.get(frameId) !== iframe) setComponentFrameReady(frameId, false)
  if (iframe) componentIframeElements.set(frameId, iframe)
  else componentIframeElements.delete(frameId)
}

function handleComponentReadyMessage(event: MessageEvent) {
  const data = event.data as {
    intrinsicHeight?: unknown
    intrinsicWidth?: unknown
    kind?: unknown
  }
  if (
    event.origin !== new URL(baseUrl.value).origin ||
    typeof event.data !== 'object' ||
    event.data === null ||
    data.kind !== SMYLR_OPENPENCIL_COMPONENT_READY
  ) {
    return
  }
  const frameEntry = [...componentIframeElements.entries()].find(
    ([, iframe]) => iframe.contentWindow === event.source
  )
  if (!frameEntry) return
  const frameId = frameEntry[0]
  setComponentFrameReady(frameId, true)
  if (typeof data.intrinsicWidth !== 'number' || typeof data.intrinsicHeight !== 'number') return
  if (
    syncSmylrLiveComponentIntrinsicSize(store, frameId, {
      height: data.intrinsicHeight,
      width: data.intrinsicWidth
    })
  ) {
    sync()
  }
}

useEventListener(window, 'message', handleComponentReadyMessage)

function componentFrameIsReady(frameId: string) {
  return componentReadyFrameIds.value.has(frameId)
}

function postComponentRuntimeMode(frameId: string, mode: 'frame' | 'interact') {
  componentIframeElements.get(frameId)?.contentWindow?.postMessage(
    {
      action: 'set-interaction-mode',
      kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
      mode
    },
    new URL(baseUrl.value).origin
  )
}

function handleComponentRuntimeLoad(frameId: string) {
  postComponentRuntimeMode(frameId, componentFrameIsInteractive(frameId) ? 'interact' : 'frame')
}

function componentFrameIsInteractive(frameId: string) {
  return (
    selectedComponentFrame.value?.id === frameId &&
    liveInspectorActiveFrameId.value === frameId &&
    liveInspectorInteractionMode.value === 'interact'
  )
}

function setComponentFrameMode(frameId: string, mode: 'frame' | 'interact') {
  if (mode === 'interact' && !componentFrameIsReady(frameId)) return
  store.select([frameId])
  setLiveInspectorActiveFrame(frameId)
  setLiveInspectorInteractionMode(mode)
  postComponentRuntimeMode(frameId, mode)
  sync()
}

function beginComponentHeaderMove(frameId: string, event: PointerEvent) {
  const frame = store.graph.getNode(frameId)
  if (!frame || event.button !== 0) return
  setComponentFrameMode(frameId, 'frame')
  componentHeaderDrag.value = {
    frameId,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: frame.x,
    startY: frame.y
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function moveComponentFromHeader(event: PointerEvent) {
  const drag = componentHeaderDrag.value
  const frame = drag ? store.graph.getNode(drag.frameId) : null
  if (!drag || !frame || drag.pointerId !== event.pointerId) return
  const zoom = Math.max(store.state.zoom, 0.01)
  store.graph.updateNodePositionPreview(
    frame.id,
    drag.startX + (event.clientX - drag.startClientX) / zoom,
    drag.startY + (event.clientY - drag.startClientY) / zoom
  )
  store.requestRepaint()
  sync()
}

function endComponentHeaderMove(event: PointerEvent) {
  const drag = componentHeaderDrag.value
  const frame = drag ? store.graph.getNode(drag.frameId) : null
  if (!drag || drag.pointerId !== event.pointerId) return
  componentHeaderDrag.value = null
  if (!frame) return
  const final = { x: frame.x, y: frame.y }
  if (final.x !== drag.startX || final.y !== drag.startY) {
    store.graph.updateNodePositionPreview(frame.id, drag.startX, drag.startY)
    store.updateNode(frame.id, final)
    store.commitNodeUpdate(frame.id, { x: drag.startX, y: drag.startY }, 'Move component')
  }
  sync()
}

function overlayStyle(frameId: string) {
  void syncTick.value
  const frame = store.graph.getNode(frameId)
  return frame ? liveFrameScreenOverlayStyle(store, frame) : {}
}

function resizeHandles(frameId: string) {
  void syncTick.value
  const frame = store.graph.getNode(frameId)
  return frame ? liveFrameResizeHandles(frame, store.state.zoom) : []
}

function rotationHandles(frameId: string) {
  void syncTick.value
  const frame = store.graph.getNode(frameId)
  return frame ? liveFrameRotationHandles(frame, store.state.zoom) : []
}

const frameTransform = createLiveFrameTransformController(store, sync)
const frameSelectionHandleStyle = LIVE_FRAME_RESIZE_HANDLE_STYLE
const frameRotationHandleStyle = LIVE_FRAME_ROTATE_HANDLE_STYLE

const sharedRuntimeSrc = computed(() => {
  void syncTick.value
  const frameId = sharedRuntimeLoadedFrameId.value
  const retainedFrameId = retainedRuntimeFrameId.value
  const frame =
    (frameId ? store.graph.getNode(frameId) : null) ??
    (retainedFrameId ? store.graph.getNode(retainedFrameId) : null) ??
    alternateFrames.value[0] ??
    null
  if (!frame) return ''
  return smylrLiveRuntimeUrlFor({
    baseUrl: runtimeBaseUrlForFrame(frame),
    openPencilHref: window.location.href,
    target: runtimeTargetForFrame(frame)
  })
})

watch(sharedRuntimeSrc, () => {
  sharedRuntimeReady.value = false
})

function selectFrame(frameId: string, mode?: 'frame' | 'select' | 'interact') {
  const requestedMode = isReadOnlyReferenceFrame(frameId) ? 'frame' : mode
  // Establish the scene selection first. Toolbar mode synchronization derives
  // its target from the selected frame; setting the global mode first lets the
  // previously selected Current frame win the same tick.
  store.select([frameId])
  setLiveInspectorActiveFrame(frameId)
  selectedRuntimeMode.value =
    requestedMode === 'select' || requestedMode === 'interact' ? requestedMode : null
  activateRuntimeFrame(frameId)
  hydrateRuntimeFrame(frameId)
  if (requestedMode !== 'frame') {
    lastInteractedRuntimeFrameId.value = frameId
    const target = sharedIframeElement.value?.contentWindow ?? null
    setLiveInspectorCommandTarget(target, runtimeOriginForFrameId(frameId))
  }
  if (requestedMode) setLiveInspectorInteractionMode(requestedMode)
  if (requestedMode !== 'frame') {
    postRuntimeCommand(frameId, 'set-interaction-mode', requestedMode ?? 'interact')
    postRuntimeCommand(frameId, 'request-tree', requestedMode ?? 'interact')
  }
  sync()
}

function beginAlternateHeaderMove(frameId: string, event: PointerEvent) {
  const frame = store.graph.getNode(frameId)
  if (!frame || event.button !== 0) return
  selectFrame(frameId, 'frame')
  alternateHeaderDrag.value = {
    frameId,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: frame.x,
    startY: frame.y
  }
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function moveAlternateFromHeader(event: PointerEvent) {
  const drag = alternateHeaderDrag.value
  const frame = drag ? store.graph.getNode(drag.frameId) : null
  if (!drag || !frame || drag.pointerId !== event.pointerId) return
  const zoom = Math.max(store.state.zoom, 0.01)
  store.graph.updateNodePositionPreview(
    frame.id,
    drag.startX + (event.clientX - drag.startClientX) / zoom,
    drag.startY + (event.clientY - drag.startClientY) / zoom
  )
  store.requestRepaint()
  sync()
}

function endAlternateHeaderMove(event: PointerEvent) {
  const drag = alternateHeaderDrag.value
  const frame = drag ? store.graph.getNode(drag.frameId) : null
  if (!drag || drag.pointerId !== event.pointerId) return
  alternateHeaderDrag.value = null
  if (!frame) return
  const final = { x: frame.x, y: frame.y }
  if (final.x !== drag.startX || final.y !== drag.startY) {
    store.graph.updateNodePositionPreview(frame.id, drag.startX, drag.startY)
    store.updateNode(frame.id, final)
    store.commitNodeUpdate(frame.id, { x: drag.startX, y: drag.startY }, 'Move live app frame')
  }
  sync()
}

function workflowLabel(frameId: string) {
  if (isReadOnlyReferenceFrame(frameId)) return 'Read-only reference'
  const item = workspaceItemForFrame(frameId)
  if (!item) return isFlowView() ? 'Flow state' : 'Alternate'
  return liveWorkspaceLifecycleLabel(item)
}

function focusAlternateFrame(frameId: string, event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('button, [role="button"]')) return
  selectFrame(frameId, 'frame')
  void fitSmylrPageToViewport(store, [frameId])
}

function duplicateSnapshot(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  if (!item) return
  const copy = saveLiveWorkspaceItem({
    baseRevision: item.baseRevision,
    branch: { name: '', status: 'not-started' },
    kind: 'variant',
    name: `${item.name} Copy`,
    nodeId: item.nodeId,
    note: `Duplicate of ${item.name}`,
    parentId: item.id,
    patch: item.patch,
    patches: workspaceItemPatches(item),
    route: item.route,
    runtimeRoute: item.runtimeRoute,
    status: 'unmerged'
  })
  if (item.preview?.status === 'ready' && item.preview.dataUrl) {
    completeLiveWorkspacePreview(copy.id, {
      capturedAt: item.preview.capturedAt,
      dataUrl: item.preview.dataUrl,
      height: item.preview.height,
      mimeType: item.preview.mimeType,
      width: item.preview.width
    })
  }
}

function restoreSnapshot(frameId: string) {
  const target = iframeElements.get(frameId)?.contentWindow
  if (!target) return
  target.postMessage(
    { action: 'clear-preview-style', kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE },
    runtimeOriginForFrameId(frameId)
  )
  window.setTimeout(() => applyWorkspacePatches(frameId), 50)
}

function isFlowView() {
  return isSmylrFlowPageNode(store.graph.getNode(store.state.currentPageId))
}

function showAppScreenFlowOverview() {
  store.clearSelection()
  selectedRuntimeMode.value = null
  lastInteractedRuntimeFrameId.value = null
  setLiveInspectorActiveFrame(null)
  activateRuntimeFrame(null)
  enqueueMissingSnapshots()
  window.setTimeout(startNextPreview, 0)
  void fitSmylrPageToViewport(store)
}

const activeExperienceItem = computed(() => {
  void syncTick.value
  const rootId = workspaceUi.experienceProjection.value?.rootSurface.objectId
  return rootId ? (liveWorkspaceItems.value.find((item) => item.id === rootId) ?? null) : null
})

const activeExperiencePurpose = computed<ExperienceProjectionPurpose | null>(() => {
  void syncTick.value
  const page = store.graph.getNode(store.state.currentPageId)
  const purpose = page ? workspacePluginValue(page, 'experiencePurpose') : undefined
  return purpose === 'focus' ||
    purpose === 'compare' ||
    purpose === 'knowledge' ||
    purpose === 'review'
    ? purpose
    : null
})

const availableExperienceViews = computed(() =>
  EXPERIENCE_PURPOSES.filter((candidate) =>
    activeExperienceProjection.value?.availablePurposes.includes(candidate.purpose)
  )
)

function smylrPageIdentity(page: ReturnType<typeof findSmylrAppViewPage>, item: LiveWorkspaceItem) {
  return (
    page?.pluginData.find(
      (entry) =>
        entry.pluginId === 'smylr-production' && entry.key === 'pageId' && entry.value.trim()
    )?.value ?? item.route
  )
}

async function openWorkspaceItemView(item: LiveWorkspaceItem, view: SmylrAppViewKind) {
  const page = findSmylrAppViewPage(store, item.route, view)
  if (!page) return false
  let projectionId = ''
  const movement = await moveBetweenSmylrProductionViews(store, {
    destination: {
      kind: view === 'flow' ? 'smylr-flow-page' : 'smylr-production-page',
      pageId: smylrPageIdentity(page, item)
    },
    focusTarget: (ids) => fitSmylrPageToViewport(store, ids),
    itemId: item.id,
    prepareTarget: () => {
      if (view === 'current') clearWorkspaceExperienceProjectionPage(store.graph, page.id)
      const projection = ensureSmylrAlternateLiveAppFrame(store, item)
      projectionId = projection?.id ?? ''
      return projection ? [projection.id] : []
    },
    targetPageId: page.id
  })
  return Boolean(movement && projectionId)
}

async function openWorkspaceExperienceProjection(
  item: LiveWorkspaceItem,
  purpose: ExperienceProjectionPurpose
) {
  openWorkflowMenuId.value = null
  const prepared = syncLiveWorkspaceExperienceProjection(store, item)
  const basePage = store.graph.getNode(prepared.basePageId)
  if (!basePage) return false
  try {
    await runSmylrProductionViewMovement(store, {
      destination: { kind: `experience-${purpose}`, pageId: prepared.basePageId },
      itemId: item.id,
      transition: async () => {
        await workspaceUi.openExperienceProjection({
          basePageId: prepared.basePageId,
          basePageName: basePage.name,
          purpose,
          rootSurface: prepared.rootSurface,
          route: item.route
        })
      }
    })
    sync()
    return true
  } catch (error) {
    console.warn(`[Flow state] Could not open ${purpose} projection`, error)
    return false
  }
}

function openFrameExperienceProjection(frameId: string, purpose: ExperienceProjectionPurpose) {
  const item = workspaceItemForFrame(frameId)
  if (item) void openWorkspaceExperienceProjection(item, purpose)
}

async function addFrameToFlow(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  openWorkflowMenuId.value = null
  if (!item) return
  const flowItem = addLiveWorkspaceItemToFlow(item.id)
  if (flowItem) await openWorkspaceItemView(flowItem, 'flow')
}

async function openFrameFlowView(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  openWorkflowMenuId.value = null
  if (item?.flow) await openWorkspaceItemView(item, 'flow')
}

async function returnFrameToCurrent(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  openWorkflowMenuId.value = null
  if (item) await openWorkspaceItemView(item, 'current')
}

function workflowActionsForFrame(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  if (!item) return []
  return availableLiveWorkspaceLifecycleActions(item)
    .filter((action) => action !== 'archive' && action !== 'verify')
    .toSorted((left, right) => WORKFLOW_ACTION_PRIORITY[left] - WORKFLOW_ACTION_PRIORITY[right])
}

function workflowHistoryForFrame(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  return item ? [...liveWorkspaceLifecycle(item).history].reverse().slice(0, 2) : []
}

function workflowRevisionForFrame(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  return item ? liveWorkspaceLifecycle(item).revision : 1
}

function workflowNextHint(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  if (!item) return ''
  const status = liveWorkspaceLifecycle(item).status
  if (status === 'approved') {
    return 'Implementation waits for a checked source proposal and explicit authorization.'
  }
  if (status === 'implementing') {
    return 'Verification waits for source diff, tests, and real-app proof.'
  }
  if (status === 'verified') return 'Verified evidence is attached to this item.'
  return workflowActionsForFrame(frameId).length === 0 ? 'No lifecycle action is available.' : ''
}

function applyLifecycleAction(
  item: LiveWorkspaceItem,
  frameId: string,
  action: WorkLifecycleAction
) {
  if (action === 'start-draft') {
    return transitionLiveWorkspaceLifecycle(item.id, { action }).ok
  }
  if (action === 'start-branch') return Boolean(startLiveWorkspaceBranch(item.id))
  if (action === 'request-review') return Boolean(sendLiveWorkspaceItemToReview(item.id))
  if (action === 'request-changes') return requestLiveWorkspaceItemChanges(item.id)
  if (action === 'mark-preferred') return markLiveWorkspaceItemPreferred(item.id)
  if (action === 'create-change-set') {
    const criterion = workflowAcceptanceDrafts.value[frameId]?.trim() ?? ''
    if (!criterion) return false
    const created = createLiveWorkspaceItemChangeSet(item.id, [criterion])
    if (created)
      workflowAcceptanceDrafts.value = { ...workflowAcceptanceDrafts.value, [frameId]: '' }
    return Boolean(created)
  }
  if (action === 'approve') return approveLiveWorkspaceItemForMerge(item.id)
  if (action === 'start-implementation') return startLiveWorkspaceImplementation(item.id)
  return false
}

function runFrameLifecycleAction(frameId: string, action: WorkLifecycleAction) {
  const item = workspaceItemForFrame(frameId)
  if (!item) return
  const changed = runLiveWorkspaceMutationWithUndo(store, workLifecycleActionLabel(action), () =>
    applyLifecycleAction(item, frameId, action)
  )
  if (!changed) return
  lastWorkflowUndoItemId.value = item.id
  sync()
}

function undoLastFrameLifecycleAction(frameId: string) {
  const item = workspaceItemForFrame(frameId)
  if (!item || lastWorkflowUndoItemId.value !== item.id || !store.undo.canUndo) return
  store.undoAction()
  lastWorkflowUndoItemId.value = null
  sync()
}

function ownsRuntimeInteraction(frameId: string) {
  return interactionRuntimeFrameId.value === frameId && selectedRuntimeMode.value !== null
}

const sharedRuntimeFrame = computed(() => {
  void syncTick.value
  const activeFrameId =
    selectedRuntimeFrameId.value ??
    lastInteractedRuntimeFrameId.value ??
    previewWorkerFrameId.value ??
    retainedRuntimeFrameId.value
  const activeFrame = activeFrameId ? store.graph.getNode(activeFrameId) : null
  if (activeFrame) return activeFrame
  return alternateFrames.value[0] ?? null
})

function sharedRuntimeCanvasStyle() {
  void syncTick.value
  const frame = sharedRuntimeFrame.value
  if (!frame) return {}
  const isOnCurrentPage = frame.parentId === store.state.currentPageId
  const showsLiveState = shouldShowLiveRuntime({
    currentPageId: store.state.currentPageId,
    frameId: frame.id,
    frameParentId: frame.parentId,
    lastInteractedFrameId: lastInteractedRuntimeFrameId.value,
    loadedFrameId: sharedRuntimeLoadedFrameId.value,
    ownsInteraction: ownsRuntimeInteraction(frame.id)
  })
  return {
    ...liveFrameCanvasStyle(store, frame),
    display: isOnCurrentPage ? 'block' : 'none',
    opacity: showsLiveState ? '1' : '0'
  }
}

function showsSnapshot(frameId: string) {
  return Boolean(snapshots.value[frameId])
}
</script>

<template>
  <button
    v-if="isFlowView()"
    type="button"
    data-test-id="app-screen-flow-overview"
    class="pointer-events-auto absolute top-14 right-3 z-40 flex items-center gap-1.5 rounded-lg border border-border bg-panel/95 px-2.5 py-1.5 text-[10px] font-medium text-surface shadow-lg backdrop-blur transition-colors hover:bg-hover"
    @click.stop="showAppScreenFlowOverview"
    @pointerdown.stop
  >
    <icon-lucide-route class="size-3.5" />
    Overview
  </button>

  <div
    v-if="activeExperienceItem && activeExperienceProjection"
    data-test-id="live-experience-view-switcher"
    class="pointer-events-auto absolute top-14 right-3 z-40 flex items-center gap-0.5 rounded-lg border border-border bg-panel/95 p-1 text-[10px] shadow-lg backdrop-blur"
  >
    <button
      class="rounded px-2 py-1 text-muted hover:bg-hover hover:text-surface"
      :class="!activeExperiencePurpose ? 'bg-hover text-surface' : ''"
      data-test-id="live-experience-view-current"
      @click="openWorkspaceItemView(activeExperienceItem, 'current')"
    >
      Current
    </button>
    <button
      v-for="view in availableExperienceViews"
      :key="view.purpose"
      class="rounded px-2 py-1 text-muted hover:bg-hover hover:text-surface"
      :class="activeExperiencePurpose === view.purpose ? 'bg-accent text-white' : ''"
      :data-test-id="`live-experience-view-${view.purpose}`"
      @click="openWorkspaceExperienceProjection(activeExperienceItem, view.purpose)"
    >
      {{ view.label }}
    </button>
  </div>

  <template v-for="frame in componentFrames" :key="frame.id">
    <div
      :data-live-component-frame-id="frame.id"
      class="absolute top-0 left-0 z-[5] overflow-hidden bg-transparent"
      :class="componentFrameIsInteractive(frame.id) ? 'pointer-events-auto' : 'pointer-events-none'"
      :style="{ ...frameStyle(frame.id), ...liveFrameCornerStyle(frame) }"
    >
      <iframe
        :ref="(value) => setComponentIframeElement(frame.id, value as Element | null)"
        data-test-id="placed-live-component-runtime"
        :data-interaction-mode="componentFrameIsInteractive(frame.id) ? 'interact' : 'frame'"
        :src="componentRuntimeSrc(frame.id)"
        :title="`${frame.name} component`"
        allowtransparency="true"
        :tabindex="componentFrameIsInteractive(frame.id) ? 0 : -1"
        loading="eager"
        class="size-full border-0 bg-transparent"
        :class="
          componentFrameIsInteractive(frame.id) ? 'pointer-events-auto' : 'pointer-events-none'
        "
        @load="handleComponentRuntimeLoad(frame.id)"
      />
    </div>
    <div
      v-if="!componentFrameIsInteractive(frame.id)"
      class="pointer-events-none absolute top-0 left-0 z-[9]"
      :style="overlayStyle(frame.id)"
    >
      <button
        type="button"
        data-test-id="placed-live-component-enter-interact"
        class="pointer-events-auto absolute inset-0 bg-transparent disabled:cursor-wait"
        :aria-label="
          componentFrameIsReady(frame.id)
            ? `Use ${smylrLiveComponentDisplayName(frame)}`
            : `${smylrLiveComponentDisplayName(frame)} is loading`
        "
        :disabled="!componentFrameIsReady(frame.id)"
        @click.stop.prevent="setComponentFrameMode(frame.id, 'interact')"
        @pointerdown.stop.prevent="setComponentFrameMode(frame.id, 'interact')"
      />
    </div>
    <div
      v-if="selectedComponentFrame?.id === frame.id"
      data-test-id="placed-live-component-selection"
      class="pointer-events-none absolute top-0 left-0 z-10 border border-violet-500"
      :style="overlayStyle(frame.id)"
    >
      <button
        type="button"
        data-test-id="placed-live-component-header"
        class="pointer-events-auto absolute left-1/2 flex cursor-move items-center gap-1.5 rounded-md border border-violet-500 bg-panel px-2 py-1 text-[10px] font-medium whitespace-nowrap text-surface shadow-sm transition-colors hover:bg-hover"
        :style="liveFrameHeaderStyle(store.state.zoom)"
        :aria-label="
          componentFrameIsInteractive(frame.id)
            ? `Finish interacting and move ${smylrLiveComponentDisplayName(frame)}`
            : `Move ${smylrLiveComponentDisplayName(frame)}`
        "
        @click.stop="setComponentFrameMode(frame.id, 'frame')"
        @pointercancel.stop="endComponentHeaderMove"
        @pointerdown.stop.prevent="beginComponentHeaderMove(frame.id, $event)"
        @pointermove.stop="moveComponentFromHeader"
        @pointerup.stop="endComponentHeaderMove"
      >
        <span class="max-w-32 truncate">{{ smylrLiveComponentDisplayName(frame) }}</span>
        <span
          v-if="!componentFrameIsReady(frame.id) || componentFrameIsInteractive(frame.id)"
          class="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] text-violet-500"
        >
          {{ componentFrameIsReady(frame.id) ? 'Done' : 'Loading' }}
        </span>
      </button>
    </div>
  </template>

  <template v-for="frame in alternateFrames" :key="frame.id">
    <div
      :data-live-frame-id="frame.id"
      :data-live-frame-state="smylrLiveAppFrameState(frame)"
      :data-live-frame-route="runtimeTargetForFrame(frame).route"
      class="pointer-events-none absolute top-0 left-0 z-[5]"
      :style="frameStyle(frame.id)"
    >
      <div
        data-test-id="smylr-live-frame-snapshot-surface"
        class="absolute inset-0 overflow-hidden bg-white shadow-[var(--shadow-live-frame)]"
        :style="liveFrameCornerStyle(frame)"
      >
        <img
          v-if="showsSnapshot(frame.id)"
          :src="snapshots[frame.id]"
          :alt="`${frame.name} last rendered snapshot`"
          class="size-full object-cover object-top"
        />
        <div
          v-else
          :data-preview-status="previewStatus(frame.id)"
          class="flex size-full items-center justify-center bg-white text-center text-muted"
        >
          <div class="max-w-48">
            <icon-lucide-loader-circle
              v-if="previewStatus(frame.id) === 'rendering'"
              class="mx-auto mb-2 size-7 animate-spin"
            />
            <icon-lucide-clock-3
              v-else-if="previewStatus(frame.id) === 'queued'"
              class="mx-auto mb-2 size-7"
            />
            <icon-lucide-image-off v-else class="mx-auto mb-2 size-7" />
            <p class="text-xs font-medium">
              {{ previewStatusLabel(frame.id) }}
            </p>
            <p class="mt-1 text-[10px]">
              {{ previewStatusDetail(frame.id, frame) }}
            </p>
            <button
              v-if="previewStatus(frame.id) === 'failed'"
              type="button"
              :aria-label="`Open live source for ${frame.name}`"
              class="pointer-events-auto mt-2 rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover"
              @click.stop="selectFrame(frame.id, 'interact')"
              @pointerdown.stop
            >
              Open live source
            </button>
            <button
              v-else-if="previewStatus(frame.id) !== 'ready'"
              type="button"
              :aria-label="`Retry live snapshot for ${frame.name}`"
              class="pointer-events-auto mt-2 rounded border border-border px-2 py-1 text-[10px] text-surface hover:bg-hover"
              @click.stop="retryPreview(frame.id)"
              @pointerdown.stop
            >
              Retry live snapshot
            </button>
          </div>
        </div>
      </div>
    </div>

    <div
      class="smylr-live-frame-header-container pointer-events-none absolute top-0 left-0 z-10"
      :class="store.state.selectedIds.has(frame.id) ? 'border border-violet-500' : ''"
      :style="overlayStyle(frame.id)"
      @pointerenter="revealAlternateFrameHeader(frame.id)"
      @pointerleave="hideAlternateFrameHeaderSoon(frame.id)"
    >
      <!-- Press the frame body → live app (header stays move/frame mode). -->
      <Tip
        v-if="!ownsRuntimeInteraction(frame.id) && previewStatus(frame.id) !== 'failed'"
        :disabled="isFlowView()"
        :label="
          isReadOnlyReferenceFrame(frame.id)
            ? `${frame.name} is a separate read-only historical build`
            : `Open ${runtimeLabelForFrame(frame)} in the live source`
        "
      >
        <div
          data-test-id="smylr-live-frame-enter-interact"
          class="pointer-events-auto absolute inset-0 z-[1]"
          :class="isReadOnlyReferenceFrame(frame.id) ? 'cursor-default' : 'cursor-pointer'"
          @pointerenter="revealAlternateFrameHeader(frame.id)"
          @pointerleave="hideAlternateFrameHeaderSoon(frame.id)"
          @pointerdown.stop.prevent="
            selectFrame(frame.id, isReadOnlyReferenceFrame(frame.id) ? 'frame' : 'interact')
          "
          @wheel="handleFrameSurfaceWheel"
        />
      </Tip>
      <span
        v-if="shouldShowAlternateFrameHeader(frame.id)"
        data-test-id="smylr-live-alternate-frame-header"
        class="smylr-live-frame-header pointer-events-auto absolute left-1/2 z-[2] flex cursor-move items-center gap-0.5 whitespace-nowrap rounded-md border border-border bg-panel px-1 py-0.5 text-surface shadow-sm transition-colors hover:border-violet-500 hover:bg-hover"
        :class="store.state.selectedIds.has(frame.id) ? 'border-violet-500 bg-hover' : ''"
        :style="liveFrameHeaderStyle(store.state.zoom)"
        @click.stop="selectFrame(frame.id, 'frame')"
        @dblclick.stop.prevent="focusAlternateFrame(frame.id, $event)"
        @pointercancel.stop="endAlternateHeaderMove"
        @pointerdown.stop.prevent="beginAlternateHeaderMove(frame.id, $event)"
        @pointerenter="revealAlternateFrameHeader(frame.id)"
        @pointerleave="hideAlternateFrameHeaderSoon(frame.id)"
        @pointermove.stop="moveAlternateFromHeader"
        @pointerup.stop="endAlternateHeaderMove"
      >
        <strong
          class="smylr-live-frame-header__title max-w-36 truncate px-1 text-[10px] font-medium"
          >{{ smylrLiveAppFrameDisplayName(frame.name) }}</strong
        >
        <Tip :label="`Source-backed view ${runtimeLabelForFrame(frame)}`">
          <span
            data-test-id="smylr-live-frame-source"
            class="max-w-36 truncate rounded bg-surface/5 px-1 text-[8px] font-medium text-muted"
            :aria-label="`Source-backed view ${runtimeLabelForFrame(frame)}`"
          >
            {{ runtimeLabelForFrame(frame) }}
          </span>
        </Tip>
        <span v-if="previewStatus(frame.id) !== 'ready'" class="smylr-live-frame-header__preview">
          <Tip label="Retry preview">
            <button
              type="button"
              :aria-label="`Retry live snapshot for ${frame.name}`"
              class="flex size-6 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
              @click.stop="retryPreview(frame.id)"
              @pointerdown.stop
            >
              <icon-lucide-refresh-cw class="size-3" />
            </button>
          </Tip>
        </span>
        <span
          class="smylr-live-frame-header__status rounded bg-violet-500/15 px-1 text-[8px] font-medium text-violet-300"
        >
          {{ workflowLabel(frame.id) }}
        </span>
        <span
          class="smylr-live-frame-header__divider smylr-live-frame-header__title-divider mx-0.5 h-3.5 w-px bg-border"
        />
        <SmylrLiveFrameViewportControls
          class="smylr-live-frame-header__viewport"
          :frame-id="frame.id"
          :frame-label="frame.name"
          @change="selectFrame(frame.id, 'frame')"
        />
        <span
          class="smylr-live-frame-header__divider smylr-live-frame-header__secondary-divider mx-0.5 h-3.5 w-px bg-border"
        />
        <span class="smylr-live-frame-header__optional flex items-center gap-0.5">
          <Tip label="Duplicate snapshot">
            <button
              :aria-label="`Duplicate ${frame.name}`"
              class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
              type="button"
              @click.stop="duplicateSnapshot(frame.id)"
              @pointerdown.stop
            >
              <icon-lucide-camera class="size-4" />
            </button>
          </Tip>
          <Tip label="Restore saved snapshot">
            <button
              :aria-label="`Restore ${frame.name} snapshot`"
              class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
              type="button"
              @click.stop="restoreSnapshot(frame.id)"
              @pointerdown.stop
            >
              <icon-lucide-rotate-ccw class="size-4" />
            </button>
          </Tip>
        </span>
        <div
          v-if="workspaceItemForFrame(frame.id)"
          class="smylr-live-frame-header__workflow relative"
        >
          <Tip label="Design workflow">
            <button
              :aria-label="`Open workflow for ${frame.name}`"
              class="flex size-7 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface"
              type="button"
              @click.stop="openWorkflowMenuId = openWorkflowMenuId === frame.id ? null : frame.id"
              @pointerdown.stop
            >
              <icon-lucide-git-branch class="size-4" />
            </button>
          </Tip>
          <div
            v-if="openWorkflowMenuId === frame.id"
            class="absolute top-8 right-0 z-50 w-64 whitespace-normal rounded-lg border border-border bg-panel p-2 text-[11px] shadow-xl"
            @pointerdown.stop
          >
            <div
              class="flex items-center justify-between gap-3 px-1 pb-2"
              data-test-id="live-workflow-status"
            >
              <strong class="font-medium text-surface">{{ workflowLabel(frame.id) }}</strong>
              <span class="text-[9px] text-muted">r{{ workflowRevisionForFrame(frame.id) }}</span>
            </div>

            <div class="border-y border-border py-1">
              <button
                v-if="isFlowView()"
                class="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-muted hover:bg-hover hover:text-surface"
                data-test-id="live-workflow-return-current"
                @click.stop="returnFrameToCurrent(frame.id)"
              >
                <icon-lucide-corner-up-left class="size-3" />
                Return to Current
              </button>
              <button
                v-else-if="workspaceItemForFrame(frame.id)?.flow"
                class="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-muted hover:bg-hover hover:text-surface"
                data-test-id="live-workflow-open-flow"
                @click.stop="openFrameFlowView(frame.id)"
              >
                <icon-lucide-route class="size-3" />
                Open Flow view
              </button>
              <button
                v-else
                class="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-muted hover:bg-hover hover:text-surface"
                data-test-id="live-workflow-add-flow"
                @click.stop="addFrameToFlow(frame.id)"
              >
                <icon-lucide-route class="size-3" />
                Add to Flow
              </button>
            </div>

            <div class="border-b border-border py-2">
              <span class="block px-1 pb-1 text-[9px] font-medium text-muted"
                >Synchronized views</span
              >
              <div class="grid grid-cols-4 gap-1">
                <button
                  v-for="view in EXPERIENCE_PURPOSES"
                  :key="view.purpose"
                  class="rounded px-1 py-1 text-[9px] text-muted hover:bg-hover hover:text-surface"
                  :data-test-id="`live-workflow-open-${view.purpose}`"
                  @click.stop="openFrameExperienceProjection(frame.id, view.purpose)"
                >
                  {{ view.label }}
                </button>
              </div>
            </div>

            <div v-if="workflowActionsForFrame(frame.id).length" class="mt-2 space-y-1">
              <input
                v-if="workflowActionsForFrame(frame.id).includes('create-change-set')"
                v-model="workflowAcceptanceDrafts[frame.id]"
                class="h-7 w-full rounded border border-border bg-black/15 px-2 text-[10px] text-surface outline-none focus:border-accent"
                data-test-id="live-workflow-acceptance"
                placeholder="Acceptance criterion"
                @keydown.stop
              />
              <button
                v-for="(action, actionIndex) in workflowActionsForFrame(frame.id)"
                :key="action"
                class="block w-full rounded px-2 py-1.5 text-left font-medium disabled:opacity-35"
                :class="
                  actionIndex === 0
                    ? 'bg-accent text-white hover:bg-accent/90'
                    : 'text-surface/80 hover:bg-hover hover:text-surface'
                "
                :data-test-id="`live-workflow-action-${action}`"
                :disabled="
                  action === 'create-change-set' && !workflowAcceptanceDrafts[frame.id]?.trim()
                "
                @click.stop="runFrameLifecycleAction(frame.id, action)"
              >
                {{ workLifecycleActionLabel(action) }}
              </button>
            </div>
            <p v-else class="px-1 py-2 text-[9px] leading-relaxed text-muted">
              {{ workflowNextHint(frame.id) }}
            </p>

            <div class="mt-2 border-t border-border pt-2" data-test-id="live-workflow-history">
              <div class="mb-1 flex items-center justify-between gap-2 px-1">
                <span class="text-[9px] font-medium text-muted">Recent activity</span>
                <button
                  v-if="lastWorkflowUndoItemId === workspaceItemForFrame(frame.id)?.id"
                  class="text-[9px] text-muted hover:text-surface disabled:opacity-35"
                  data-test-id="live-workflow-undo"
                  :disabled="!store.undo.canUndo"
                  @click.stop="undoLastFrameLifecycleAction(frame.id)"
                >
                  Undo last
                </button>
              </div>
              <div v-if="workflowHistoryForFrame(frame.id).length" class="space-y-1">
                <div
                  v-for="receipt in workflowHistoryForFrame(frame.id)"
                  :key="receipt.id"
                  class="flex items-center justify-between gap-2 px-1 text-[9px]"
                >
                  <span class="min-w-0 truncate text-surface/80">{{ receipt.label }}</span>
                  <span class="shrink-0 text-muted">
                    {{ workLifecycleStatusLabel(receipt.from) }} →
                    {{ workLifecycleStatusLabel(receipt.to) }}
                  </span>
                </div>
              </div>
              <p v-else class="px-1 text-[9px] text-muted">No transitions yet</p>
            </div>
          </div>
        </div>
      </span>
      <span
        v-for="handle in resizeHandles(frame.id)"
        v-show="store.state.selectedIds.has(frame.id)"
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
        @pointercancel.stop="frameTransform.end"
        @pointerdown.stop.prevent="frameTransform.beginResize(frame.id, handle.id, $event)"
        @pointermove.stop.prevent="frameTransform.move"
        @pointerup.stop.prevent="frameTransform.end"
      />
      <span
        v-for="handle in rotationHandles(frame.id)"
        v-show="store.state.selectedIds.has(frame.id)"
        :key="`rotate-${handle.id}`"
        class="pointer-events-auto absolute z-10 cursor-crosshair"
        :style="{
          ...frameRotationHandleStyle,
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

  <div
    v-if="sharedRuntimeFrame"
    class="absolute top-0 left-0 z-[6]"
    :class="
      sharedRuntimeFrame && ownsRuntimeInteraction(sharedRuntimeFrame.id)
        ? 'pointer-events-auto'
        : 'pointer-events-none'
    "
    :style="sharedRuntimeCanvasStyle()"
    @pointerenter="revealAlternateFrameHeader(sharedRuntimeFrame.id)"
    @pointerleave="hideAlternateFrameHeaderSoon(sharedRuntimeFrame.id)"
  >
    <div
      data-test-id="smylr-live-frame-runtime-surface"
      class="absolute inset-0 overflow-hidden bg-white shadow-[var(--shadow-live-frame)]"
      :style="liveFrameCornerStyle(sharedRuntimeFrame)"
    >
      <iframe
        :key="`${sharedRuntimeLoadedFrameId ?? 'shared-runtime'}:${sharedRuntimeHydrationVersion}`"
        :ref="(value) => setSharedIframeElement(value as Element | null)"
        :data-live-frame-id="sharedRuntimeFrame.id"
        :data-live-frame-route="runtimeTargetForFrame(sharedRuntimeFrame).route"
        :data-live-frame-state="runtimeTargetForFrame(sharedRuntimeFrame).state"
        :src="sharedRuntimeSrc"
        class="size-full border-0 bg-white"
        title="Shared live alternate runtime"
        @load="handleSharedRuntimeLoad"
        @pointerenter="revealAlternateFrameHeader(sharedRuntimeFrame.id)"
        @pointerleave="hideAlternateFrameHeaderSoon(sharedRuntimeFrame.id)"
      />
    </div>
    <SmylrLiveContainerOverlay v-if="ownsRuntimeInteraction(sharedRuntimeFrame.id)" />
  </div>
</template>
