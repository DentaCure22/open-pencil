/* eslint-disable max-lines -- Compatibility facade for reactive session state and draft history. */
import { computed, ref, shallowRef } from 'vue'

import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerRect
} from '../smylr-live-container/types'
import {
  createLiveInspectorCommandChannel,
  type LiveInspectorCommand,
  type LiveInspectorDirectCommandDispatcher
} from './command-channel'
import {
  privacySafeLiveInspectorRoute,
  readLiveInspectorDraftCache,
  writeLiveInspectorDraftCache
} from './draft-cache'
import { createLiveInspectorDraftHistory } from './draft-history'
import { copyLiveInspectorPatchDraft, remapLiveInspectorDrafts } from './draft-policy'
import type { LiveInspectorPatchDraft } from './patch'
import {
  type LiveInspectorAuthStatus,
  type LiveInspectorInteractionMode,
  type SmylrOpenPencilInspectorMessage
} from './protocol'
import {
  createLiveInspectorTreeIndex,
  findLiveInspectorNode,
  findLiveInspectorNodeRect,
  type LiveInspectorNavigationDirection,
  type SmylrLiveInspectorFlatNode
} from './tree'

export {
  isSmylrOpenPencilInspectorMessage,
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
  type LiveInspectorAuthStatus,
  type LiveInspectorInteractionMode,
  type SmylrOpenPencilInspectorAction,
  type SmylrOpenPencilInspectorCommand,
  type SmylrOpenPencilInspectorMessage
} from './protocol'
export {
  findLiveInspectorNode,
  findLiveInspectorNodeRect,
  type LiveInspectorNavigationDirection,
  type SmylrLiveInspectorFlatNode
} from './tree'
export type { LiveInspectorDirectCommandDispatcher } from './command-channel'

export type LiveInspectorStatus = 'idle' | 'loading' | 'connected' | 'unavailable'

export const liveInspectorDocument = ref<SmylrLiveContainerDocument | null>(null)
export const liveInspectorAuthHref = ref<string | null>(null)
export const liveInspectorAuthStatus = ref<LiveInspectorAuthStatus>('unknown')
export const liveInspectorFrameSrc = ref<string | null>(null)
export const liveInspectorHoveredId = ref<string | null>(null)
export const liveInspectorInteractionMode = ref<LiveInspectorInteractionMode>('frame')
export const liveInspectorClipboardHtmlByNode = shallowRef<Map<string, string>>(new Map())
export const liveInspectorPreviewMode = ref(false)
export const liveInspectorActiveFrameId = ref<string | null>(null)
export const liveInspectorPendingSelectedId = ref<string | null>(null)
const liveInspectorReloadTicks = shallowRef<Map<string, number>>(new Map())
export const liveInspectorRoute = ref<string | null>(null)
export const liveInspectorSelectedId = ref<string | null>(null)
/** Bumps on every live-container claim so re-selecting the same id reclaims native ownership. */
export const liveInspectorSelectionEpoch = ref(0)
export const liveInspectorSelectedRect = ref<SmylrLiveContainerRect | null>(null)
export const liveInspectorStatus = ref<LiveInspectorStatus>('idle')
const liveInspectorDraftHistory = createLiveInspectorDraftHistory({
  onReplay: (drafts) => {
    postLiveInspectorCommand({ action: 'clear-preview-style' })
    for (const draft of drafts.values()) postLiveInspectorPreview(draft)
    void persistLiveInspectorDrafts()
  },
  selectedNodeId: () => liveInspectorSelectedId.value
})
export const liveInspectorPatchDrafts = liveInspectorDraftHistory.drafts
export const liveInspectorDraftHistoryEpoch = liveInspectorDraftHistory.historyEpoch
export const liveInspectorCanUndoDraft = liveInspectorDraftHistory.canUndo
export const liveInspectorCanRedoDraft = liveInspectorDraftHistory.canRedo
export const liveInspectorCanUndoSelectedDraft = liveInspectorDraftHistory.canUndoSelected
export const liveInspectorCanRedoSelectedDraft = liveInspectorDraftHistory.canRedoSelected
export const liveInspectorUndoDraftLabel = liveInspectorDraftHistory.undoLabel
export const liveInspectorRedoDraftLabel = liveInspectorDraftHistory.redoLabel
export const liveInspectorPatchDraft = liveInspectorDraftHistory.selectedDraft
const liveInspectorCommandChannel = createLiveInspectorCommandChannel(
  () => liveInspectorActiveFrameId.value
)
let liveInspectorPreviewReturnMode: LiveInspectorInteractionMode = 'select'
let requestedLiveInspectorInteractionMode: LiveInspectorInteractionMode = 'frame'
let restoredDraftRoute: string | null = null
let pendingDraftReplay = false
let pendingRestoredDrafts: LiveInspectorPatchDraft[] = []

function setLiveInspectorRoute(route: string | null) {
  if (liveInspectorRoute.value !== route) liveInspectorDraftHistory.reset()
  liveInspectorRoute.value = route
}

function postLiveInspectorPreview(draft: LiveInspectorPatchDraft) {
  return postLiveInspectorCommand({
    action: 'apply-preview-style',
    nodeId: draft.nodeId,
    styles: draft.styles,
    tokenPatch: {
      add: draft.add,
      remove: draft.remove
    }
  })
}

async function persistLiveInspectorDrafts() {
  const route = liveInspectorRoute.value
  if (!route) return
  await writeLiveInspectorDraftCache(route, liveInspectorPatchDrafts.value)
}

async function restoreLiveInspectorDrafts(route: string) {
  if (restoredDraftRoute === route || liveInspectorPatchDrafts.value.size > 0) return
  restoredDraftRoute = route
  const entries = await readLiveInspectorDraftCache(route)
  if (!entries || liveInspectorPatchDrafts.value.size > 0) return
  pendingRestoredDrafts = entries.map(([, draft]) => copyLiveInspectorPatchDraft(draft))
  const currentDocument = liveInspectorDocument.value
  if (
    currentDocument &&
    privacySafeLiveInspectorRoute(currentDocument.route) === privacySafeLiveInspectorRoute(route)
  ) {
    replayRestoredLiveInspectorDrafts(currentDocument)
    return
  }
  pendingDraftReplay = pendingRestoredDrafts.length > 0
  if (pendingDraftReplay) postLiveInspectorCommand({ action: 'request-tree' })
}

function replayRestoredLiveInspectorDrafts(document: SmylrLiveContainerDocument) {
  pendingDraftReplay = false
  const remappedDrafts = remapLiveInspectorDrafts(pendingRestoredDrafts, document)
  pendingRestoredDrafts = []
  liveInspectorDraftHistory.replace(new Map(remappedDrafts.map((draft) => [draft.nodeId, draft])))
  if (remappedDrafts.length > 0) void persistLiveInspectorDrafts()
  for (const draft of remappedDrafts) postLiveInspectorPreview(draft)
}

type ClearLiveInspectorDocumentOptions = {
  preserveDrafts?: boolean
  preserveSelection?: boolean
}

function clearLiveInspectorDocumentState(options: ClearLiveInspectorDocumentOptions = {}) {
  const drafts = options.preserveDrafts
    ? [...liveInspectorPatchDrafts.value.values()].map(copyLiveInspectorPatchDraft)
    : []
  const selectedId = options.preserveSelection ? liveInspectorSelectedId.value : null

  liveInspectorDocument.value = null
  liveInspectorHoveredId.value = null
  if (!options.preserveDrafts) {
    liveInspectorDraftHistory.replace(new Map())
    liveInspectorClipboardHtmlByNode.value = new Map()
  }
  liveInspectorPreviewMode.value = false
  liveInspectorPendingSelectedId.value = selectedId
  liveInspectorSelectedId.value = selectedId
  liveInspectorSelectedRect.value = null
  if (options.preserveDrafts) {
    pendingRestoredDrafts = drafts
    pendingDraftReplay = drafts.length > 0
  } else {
    restoredDraftRoute = null
    pendingDraftReplay = false
    pendingRestoredDrafts = []
  }
}

const liveInspectorTreeIndex = computed(() =>
  createLiveInspectorTreeIndex(liveInspectorDocument.value?.tree)
)

export const selectedLiveInspectorNode = computed(() =>
  liveInspectorTreeIndex.value.node(liveInspectorSelectedId.value)
)

export const hoveredLiveInspectorNode = computed(() =>
  liveInspectorTreeIndex.value.node(liveInspectorHoveredId.value)
)

export const hoveredLiveInspectorRect = computed(() =>
  liveInspectorTreeIndex.value.rect(liveInspectorHoveredId.value)
)

export const liveInspectorFlatNodes = computed<SmylrLiveInspectorFlatNode[]>(() => [
  ...liveInspectorTreeIndex.value.flatNodes
])

export function selectAdjacentLiveInspectorNode(direction: LiveInspectorNavigationDirection) {
  const document = liveInspectorDocument.value
  const root = document?.tree
  if (!document || !root) return false

  const selectedId = liveInspectorSelectedId.value
  if (!selectedId) return selectLiveInspectorNode(root.id)

  const target = liveInspectorTreeIndex.value.adjacentNode(
    selectedId,
    direction,
    document.selectedId
  )
  if (!target || target.id === selectedId) return false
  return selectLiveInspectorNode(target.id)
}

function receiveLiveInspectorDocument(message: SmylrOpenPencilInspectorMessage) {
  const document = message.document
  if (!document) return
  const selectedId = liveInspectorSelectedId.value
  if (
    liveInspectorDocument.value &&
    message.action !== 'select' &&
    selectedId &&
    !findLiveInspectorNode(document.tree, selectedId)
  ) {
    // MutationObserver tree refreshes can race immediately after a click. Do
    // not replace the authoritative selected document with an unrelated root
    // packet, or the selected id remains set while Design and the overlay lose
    // the node they need to render.
    return
  }
  if (
    liveInspectorDocument.value &&
    message.action !== 'select' &&
    liveInspectorPatchDrafts.value.has(document.selectedId)
  ) {
    return
  }

  liveInspectorDocument.value = document
  liveInspectorStatus.value = 'connected'
  if (liveInspectorAuthStatus.value === 'unknown') {
    liveInspectorAuthStatus.value = 'authenticated'
  }
  setLiveInspectorRoute(document.route)
}

// eslint-disable-next-line complexity -- One reducer preserves ordering across packet action variants.
export function receiveLiveInspectorMessage(message: SmylrOpenPencilInspectorMessage) {
  if (message.auth?.href) liveInspectorAuthHref.value = message.auth.href
  if (message.auth?.status) liveInspectorAuthStatus.value = message.auth.status
  // The parent editor owns the active tool. Accept only the acknowledgement
  // for its latest request so a delayed iframe packet cannot reactivate an
  // earlier mode after the user has moved on.
  if (
    message.action === 'mode' &&
    message.mode &&
    message.mode === requestedLiveInspectorInteractionMode
  ) {
    liveInspectorInteractionMode.value = message.mode
  }
  if (message.route) setLiveInspectorRoute(message.route)
  if (message.route) void restoreLiveInspectorDrafts(message.route)
  if (message.action === 'ready') {
    liveInspectorStatus.value = 'connected'
    if (liveInspectorAuthStatus.value === 'unknown') {
      liveInspectorAuthStatus.value = 'authenticated'
    }
  }
  receiveLiveInspectorDocument(message)
  if (message.document && pendingDraftReplay) {
    replayRestoredLiveInspectorDrafts(message.document)
  }
  const pendingSelection = liveInspectorPendingSelectedId.value
  if (
    message.document &&
    message.action !== 'select' &&
    pendingSelection &&
    findLiveInspectorNode(message.document.tree, pendingSelection)
  ) {
    postLiveInspectorCommand({ action: 'select-node', nodeId: pendingSelection })
  }
  if (message.action === 'hover') {
    liveInspectorHoveredId.value = typeof message.hoveredId === 'string' ? message.hoveredId : null
  }
  if (message.action === 'select' && message.selectedId && message.selectedRect) {
    liveInspectorSelectedId.value = message.selectedId
    liveInspectorSelectedRect.value = message.selectedRect
    liveInspectorPendingSelectedId.value = null
    // Reclaim native Design ownership when iframe selects (including same id).
    liveInspectorSelectionEpoch.value += 1
  } else if (message.selectedId === liveInspectorSelectedId.value && message.selectedRect) {
    liveInspectorSelectedRect.value = message.selectedRect
  }
}

export function markLiveInspectorFrameLoading(src: string) {
  const routeChanged = liveInspectorFrameSrc.value !== src
  if (routeChanged) {
    liveInspectorAuthHref.value = null
    setLiveInspectorRoute(null)
  }
  clearLiveInspectorDocumentState({
    preserveDrafts: !routeChanged,
    preserveSelection: !routeChanged
  })
  liveInspectorFrameSrc.value = src
  liveInspectorStatus.value = 'loading'
  liveInspectorAuthStatus.value = 'unknown'
}

export function markLiveInspectorFrameUnavailable(src: string) {
  if (liveInspectorFrameSrc.value !== src || liveInspectorStatus.value === 'connected') return
  clearLiveInspectorDocumentState({ preserveDrafts: true, preserveSelection: true })
  liveInspectorCommandChannel.clearWindowTarget()
  liveInspectorStatus.value = 'unavailable'
  liveInspectorAuthStatus.value = 'unavailable'
}

const RELOAD_COALESCE_MS = 400
const lastLiveInspectorReloadAtByFrame = new Map<string, number>()

export function liveInspectorReloadTickFor(frameId: string): number {
  return liveInspectorReloadTicks.value.get(frameId) ?? 0
}

export function reloadLiveInspectorFrame(frameId = liveInspectorActiveFrameId.value) {
  if (!frameId) return false
  const now = Date.now()
  const previousReloadAt = lastLiveInspectorReloadAtByFrame.get(frameId) ?? 0
  if (now - previousReloadAt < RELOAD_COALESCE_MS) return false
  lastLiveInspectorReloadAtByFrame.set(frameId, now)
  clearLiveInspectorDocumentState({ preserveDrafts: true, preserveSelection: true })
  liveInspectorStatus.value = 'loading'
  liveInspectorAuthStatus.value = 'unknown'
  const reloadTicks = new Map(liveInspectorReloadTicks.value)
  reloadTicks.set(frameId, (reloadTicks.get(frameId) ?? 0) + 1)
  liveInspectorReloadTicks.value = reloadTicks
  return true
}

export function setLiveInspectorInteractionMode(mode: LiveInspectorInteractionMode) {
  requestedLiveInspectorInteractionMode = mode
  liveInspectorInteractionMode.value = mode
  postLiveInspectorCommand({ action: 'set-interaction-mode', mode })
}

export function setLiveInspectorActiveFrame(frameId: string | null) {
  if (liveInspectorActiveFrameId.value === frameId) return
  // Selection, hover and command routing are frame-local. Keeping these
  // transient values while switching runtimes leaves the previous frame's
  // invisible selection chrome over the new iframe and routes the first
  // command to the old window.
  liveInspectorHoveredId.value = null
  liveInspectorSelectedId.value = null
  liveInspectorSelectedRect.value = null
  liveInspectorPendingSelectedId.value = null
  liveInspectorCommandChannel.clearWindowTarget()
  liveInspectorActiveFrameId.value = frameId
}

export function enterLiveInspectorContainerSelection(frameId: string) {
  setLiveInspectorActiveFrame(frameId)
  setLiveInspectorInteractionMode('select')
  const rootId = liveInspectorDocument.value?.tree.id
  if (rootId) return selectLiveInspectorNode(rootId)
  return postLiveInspectorCommand({ action: 'request-tree' })
}

export function enterLiveInspectorPreviewMode() {
  if (liveInspectorPreviewMode.value) return
  liveInspectorPreviewReturnMode = liveInspectorInteractionMode.value
  liveInspectorPreviewMode.value = true
  setLiveInspectorInteractionMode('interact')
}

export function exitLiveInspectorPreviewMode() {
  if (!liveInspectorPreviewMode.value) return
  liveInspectorPreviewMode.value = false
  setLiveInspectorInteractionMode(liveInspectorPreviewReturnMode)
}

export function selectLiveInspectorNode(id: string) {
  if (!findLiveInspectorNode(liveInspectorDocument.value?.tree, id)) return false
  if (liveInspectorInteractionMode.value !== 'select') {
    setLiveInspectorInteractionMode('select')
  }
  // Claim the known document node immediately. The iframe confirmation still
  // replaces these values with its authoritative live bounds, while pooled
  // canvases no longer leave Assets/Layers clicks looking unselected during
  // command-target handoff.
  liveInspectorSelectedId.value = id
  liveInspectorSelectedRect.value = findLiveInspectorNodeRect(liveInspectorDocument.value?.tree, id)
  liveInspectorPendingSelectedId.value = id
  // Always reclaim Design ownership even when the live id is unchanged
  // (e.g. user clicked a native copy, then the same live container again).
  liveInspectorSelectionEpoch.value += 1
  return postLiveInspectorCommand({ action: 'select-node', nodeId: id })
}

export function clearLiveInspectorSelection() {
  postLiveInspectorCommand({ action: 'select-node' })
  liveInspectorSelectedId.value = null
  liveInspectorSelectedRect.value = null
  liveInspectorPendingSelectedId.value = null
  liveInspectorHoveredId.value = null
}

/** Force native store to select the live app frame after a live container claim. */
export function claimLiveInspectorNativeOwnership() {
  liveInspectorSelectionEpoch.value += 1
}

export function setLiveInspectorPatchDraft(
  draft: LiveInspectorPatchDraft | null,
  options: { coalesceKey?: string; label?: string } = {}
) {
  if (!draft) {
    clearLiveInspectorPatchDraft()
    return
  }
  const drafts = new Map(liveInspectorPatchDrafts.value)
  drafts.set(draft.nodeId, copyLiveInspectorPatchDraft(draft))
  if (
    !liveInspectorDraftHistory.commit(drafts, {
      coalesceKey: options.coalesceKey,
      label: options.label,
      nodeId: draft.nodeId
    })
  )
    return
  void persistLiveInspectorDrafts()
}

export function clearLiveInspectorPatchDraft(nodeId = liveInspectorSelectedId.value ?? undefined) {
  if (!nodeId) return
  const drafts = new Map(liveInspectorPatchDrafts.value)
  drafts.delete(nodeId)
  if (!liveInspectorDraftHistory.commit(drafts, { label: 'Reset live layer', nodeId })) return
  void persistLiveInspectorDrafts()
}

export function clearAllLiveInspectorPatchDrafts() {
  const drafts = new Map<string, LiveInspectorPatchDraft>()
  if (!liveInspectorDraftHistory.commit(drafts)) return
  void persistLiveInspectorDrafts()
}

/**
 * Return the Current frame to its production DOM and keep saved alternates intact.
 * The empty draft set is persisted before the iframe reloads, so reconnecting
 * cannot replay an edit that the user explicitly reset.
 */
export function resetLiveInspectorToProduction() {
  const drafts = new Map<string, LiveInspectorPatchDraft>()
  liveInspectorDraftHistory.commit(drafts, { label: 'Reset Current to production' })
  pendingRestoredDrafts = []
  pendingDraftReplay = false
  void persistLiveInspectorDrafts()
  postLiveInspectorCommand({ action: 'clear-preview-style' })
  reloadLiveInspectorFrame()
}

export function undoLiveInspectorDraft() {
  return liveInspectorDraftHistory.undo()
}

export function redoLiveInspectorDraft() {
  return liveInspectorDraftHistory.redo()
}

export function beginLiveInspectorDraftTransaction(key: string) {
  liveInspectorDraftHistory.beginTransaction(key)
}

export function endLiveInspectorDraftTransaction(key: string) {
  liveInspectorDraftHistory.endTransaction(key)
}

export function liveInspectorPatchDraftFor(nodeId: string) {
  return liveInspectorPatchDrafts.value.get(nodeId) ?? null
}

export function setLiveInspectorClipboardHtml(nodeId: string, html: string) {
  const copies = new Map(liveInspectorClipboardHtmlByNode.value)
  copies.set(nodeId, html)
  liveInspectorClipboardHtmlByNode.value = copies
}

export function liveInspectorClipboardHtmlFor(nodeId: string) {
  return liveInspectorClipboardHtmlByNode.value.get(nodeId) ?? null
}

export function previewLiveInspectorDraft(
  draft: LiveInspectorPatchDraft,
  options: { coalesceKey?: string; label?: string } = {}
) {
  setLiveInspectorPatchDraft(draft, options)
  return postLiveInspectorPreview(draft)
}

export function resetLiveInspectorPreview(nodeId?: string) {
  const targetNodeId = nodeId ?? liveInspectorSelectedId.value ?? undefined
  if (targetNodeId) clearLiveInspectorPatchDraft(targetNodeId)
  return postLiveInspectorCommand({ action: 'clear-preview-style', nodeId: targetNodeId })
}

export function setLiveInspectorCommandTarget(target: Window | null, targetOrigin?: string | null) {
  liveInspectorCommandChannel.setWindowTarget(target, targetOrigin)
}

export function setLiveInspectorDirectCommandTarget(
  frameId: string,
  dispatch: LiveInspectorDirectCommandDispatcher | null
) {
  liveInspectorCommandChannel.setDirectTarget(frameId, dispatch)
}

export function postLiveInspectorCommand(command: LiveInspectorCommand) {
  return liveInspectorCommandChannel.post(command)
}
