import type { Vector } from '@open-pencil/scene-graph'
import {
  cancelEditorPresentationUpdate,
  scheduleEditorPresentationUpdate,
  type EditorPresentationUpdateCallback
} from '@open-pencil/vue'

import type { EditorStore } from '@/app/editor/active-store'
import { IS_BROWSER } from '@/constants'

export type DragPreviewPhase = 'active' | 'cancelled' | 'terminal'

export type DragPreviewMessage = {
  gestureId: string
  nodeId: string
  pageId: string
  phase: DragPreviewPhase
  sequence: number
  sessionId: string
  x: number
  y: number
}

export type OutboundDragPreview = Omit<DragPreviewMessage, 'sessionId'>

export type DragPreviewTransport = {
  publishDragPreview: (preview: OutboundDragPreview) => void
  sessionId: string
  subscribeDragPreview: (listener: (preview: DragPreviewMessage) => void) => () => void
  subscribeSessionDisconnect: (listener: (sessionId: string) => void) => () => void
}

type DragPreviewTimer = number | ReturnType<typeof setTimeout>

type DragPreviewSessionOptions = {
  activeTimeoutMs?: number
  cancelUpdate?: (callback: EditorPresentationUpdateCallback) => void
  clearTimer?: (timer: DragPreviewTimer) => void
  interpolationMs?: number
  now?: () => number
  scheduleTimer?: (callback: () => void, delayMs: number) => DragPreviewTimer
  scheduleUpdate?: (callback: EditorPresentationUpdateCallback) => void
  store: EditorStore
  terminalGraceMs?: number
  terminalTimeoutMs?: number
  transport: DragPreviewTransport
}

type LocalGesture = {
  gestureId: string
  nodeId: string
  pageId: string
  pending: Vector | null
  sequence: number
}

type RemoteProjection = {
  authoritativeMatched: boolean
  durationMs: number
  expiresAt: number
  expiryTimer: DragPreviewTimer | null
  gestureId: string
  lastReceivedAt: number
  nodeId: string
  pageId: string
  phase: Exclude<DragPreviewPhase, 'cancelled'>
  sequence: number
  sessionId: string
  startedAt: number
  startX: number
  startY: number
  targetX: number
  targetY: number
}

type ClearRemoteProjectionOptions = {
  restorePresentation?: boolean
  tombstone?: boolean
}

type CurrentProjectionResolution = {
  accepted: boolean
  projection: RemoteProjection | null
}

const DEFAULT_ACTIVE_TIMEOUT_MS = 3_000
const DEFAULT_INTERPOLATION_MS = 48
const DEFAULT_TERMINAL_GRACE_MS = 60
const DEFAULT_TERMINAL_TIMEOUT_MS = 3_000
const MIN_INTERPOLATION_MS = 24
const MAX_TERMINAL_WATERMARKS = 256

function samePosition(left: Vector, right: Vector): boolean {
  return left.x === right.x && left.y === right.y
}

function onlyTranslates(changes: Record<string, unknown>): boolean {
  const keys = Object.keys(changes)
  return keys.length > 0 && keys.every((key) => key === 'x' || key === 'y')
}

function gestureKey(preview: Pick<DragPreviewMessage, 'gestureId' | 'sessionId'>): string {
  return `${preview.sessionId}:${preview.gestureId}`
}

function interpolationDuration(packetIntervalMs: number, maximumMs: number): number {
  if (packetIntervalMs <= 0) return maximumMs
  return Math.min(maximumMs, Math.max(MIN_INTERPOLATION_MS, packetIntervalMs * 1.5))
}

export function createDragPreviewSession({
  activeTimeoutMs = DEFAULT_ACTIVE_TIMEOUT_MS,
  cancelUpdate,
  clearTimer = (timer) => clearTimeout(timer),
  interpolationMs = DEFAULT_INTERPOLATION_MS,
  now = () => performance.now(),
  scheduleTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  scheduleUpdate,
  store,
  terminalGraceMs = DEFAULT_TERMINAL_GRACE_MS,
  terminalTimeoutMs = DEFAULT_TERMINAL_TIMEOUT_MS,
  transport
}: DragPreviewSessionOptions) {
  const authoritativePositions = new Map<string, Vector>()
  const localCancelGenerations = new Map<string, number>()
  const localGestures = new Map<string, LocalGesture>()
  const remoteProjections = new Map<string, RemoteProjection>()
  const terminalWatermarks = new Map<string, number>()
  let applyingRemotePresentation = false
  let disposed = false
  let updateScheduled = false

  const schedule =
    scheduleUpdate ?? ((callback) => scheduleEditorPresentationUpdate(store, callback))
  const cancel = cancelUpdate ?? ((callback) => cancelEditorPresentationUpdate(store, callback))
  const maximumInterpolationMs = Math.max(MIN_INTERPOLATION_MS, interpolationMs)

  function snapshotAuthoritativePositions() {
    authoritativePositions.clear()
    for (const node of store.graph.getAllNodes()) {
      authoritativePositions.set(node.id, { x: node.x, y: node.y })
    }
  }

  function publish(gesture: LocalGesture, phase: DragPreviewPhase, position: Vector) {
    gesture.sequence += 1
    transport.publishDragPreview({
      gestureId: gesture.gestureId,
      nodeId: gesture.nodeId,
      pageId: gesture.pageId,
      phase,
      sequence: gesture.sequence,
      x: position.x,
      y: position.y
    })
  }

  function setTerminalWatermark(key: string) {
    terminalWatermarks.delete(key)
    terminalWatermarks.set(key, now() + terminalTimeoutMs)
    if (terminalWatermarks.size <= MAX_TERMINAL_WATERMARKS) return
    const oldest = terminalWatermarks.keys().next().value
    if (oldest) terminalWatermarks.delete(oldest)
  }

  function invalidateLocalCancellation(nodeId: string) {
    localCancelGenerations.set(nodeId, (localCancelGenerations.get(nodeId) ?? 0) + 1)
  }

  function clearProjectionTimer(projection: RemoteProjection) {
    if (projection.expiryTimer === null) return
    clearTimer(projection.expiryTimer)
    projection.expiryTimer = null
  }

  function cancelScheduledUpdateIfIdle() {
    if (
      !updateScheduled ||
      remoteProjections.size > 0 ||
      [...localGestures.values()].some((gesture) => gesture.pending !== null)
    ) {
      return
    }
    cancel(flushUpdate)
    updateScheduled = false
  }

  function clearRemoteProjection(
    nodeId: string,
    { restorePresentation = true, tombstone = true }: ClearRemoteProjectionOptions = {}
  ) {
    const projection = remoteProjections.get(nodeId)
    if (!projection) return
    remoteProjections.delete(nodeId)
    clearProjectionTimer(projection)
    cancelScheduledUpdateIfIdle()
    if (tombstone) setTerminalWatermark(gestureKey(projection))
    if (!restorePresentation) return
    applyingRemotePresentation = true
    try {
      store.graph.clearNodePositionPresentation(nodeId)
    } finally {
      applyingRemotePresentation = false
    }
    store.requestRepaint()
  }

  function armProjectionExpiry(projection: RemoteProjection) {
    clearProjectionTimer(projection)
    const delayMs = Math.max(0, projection.expiresAt - now())
    projection.expiryTimer = scheduleTimer(() => {
      projection.expiryTimer = null
      if (disposed || remoteProjections.get(projection.nodeId) !== projection) return
      if (projection.expiresAt > now()) {
        armProjectionExpiry(projection)
        return
      }
      clearRemoteProjection(projection.nodeId)
    }, delayMs)
  }

  function cancelLocalGesture(nodeId: string) {
    const gesture = localGestures.get(nodeId)
    if (!gesture) return
    invalidateLocalCancellation(nodeId)
    const position = authoritativePositions.get(nodeId) ?? { x: 0, y: 0 }
    applyingRemotePresentation = true
    try {
      store.graph.clearNodePositionPresentation(nodeId)
    } finally {
      applyingRemotePresentation = false
    }
    store.requestRepaint()
    publish(gesture, 'cancelled', position)
    localGestures.delete(nodeId)
    cancelScheduledUpdateIfIdle()
  }

  function scheduleNextUpdate() {
    if (updateScheduled || disposed) return
    updateScheduled = true
    schedule(flushUpdate)
  }

  function flushUpdate(timestamp: number) {
    updateScheduled = false
    if (disposed) return

    for (const gesture of localGestures.values()) {
      if (!gesture.pending) continue
      const pending = gesture.pending
      gesture.pending = null
      publish(gesture, 'active', pending)
    }

    let needsAnotherUpdate = false
    for (const projection of remoteProjections.values()) {
      const node = store.graph.getNode(projection.nodeId)
      if (
        !node ||
        projection.pageId !== store.state.currentPageId ||
        localGestures.has(projection.nodeId) ||
        timestamp >= projection.expiresAt
      ) {
        clearRemoteProjection(projection.nodeId)
        continue
      }

      const progress = Math.min(
        1,
        Math.max(0, (timestamp - projection.startedAt) / projection.durationMs)
      )
      const position = {
        x: projection.startX + (projection.targetX - projection.startX) * progress,
        y: projection.startY + (projection.targetY - projection.startY) * progress
      }
      const displayed = store.graph.getPresentedNodePosition(projection.nodeId)
      if (!samePosition(displayed, position)) {
        applyingRemotePresentation = true
        try {
          store.graph.setNodePositionPresentation(projection.nodeId, position)
        } finally {
          applyingRemotePresentation = false
        }
        store.requestRepaint()
      }

      const reachedTarget =
        progress >= 1 ||
        samePosition(position, {
          x: projection.targetX,
          y: projection.targetY
        })
      if (reachedTarget && projection.phase === 'terminal' && projection.authoritativeMatched) {
        clearRemoteProjection(projection.nodeId)
        continue
      }
      if (!reachedTarget) needsAnotherUpdate = true
    }

    if (
      needsAnotherUpdate ||
      [...localGestures.values()].some((gesture) => gesture.pending !== null)
    ) {
      scheduleNextUpdate()
    }
  }

  function consumeTerminalWatermark(key: string, receivedAt: number): boolean {
    const watermarkExpiresAt = terminalWatermarks.get(key)
    if (watermarkExpiresAt === undefined) return true
    if (watermarkExpiresAt > receivedAt) return false
    terminalWatermarks.delete(key)
    return true
  }

  function resolveCurrentProjection(preview: DragPreviewMessage): CurrentProjectionResolution {
    const current = remoteProjections.get(preview.nodeId)
    if (!current) return { accepted: true, projection: null }

    const sameGesture =
      current.sessionId === preview.sessionId && current.gestureId === preview.gestureId
    if (sameGesture) {
      return {
        accepted: preview.sequence > current.sequence,
        projection: current
      }
    }

    const replacesSettlingGesture =
      current.sessionId === preview.sessionId &&
      current.phase === 'terminal' &&
      preview.phase === 'active'
    if (!replacesSettlingGesture) return { accepted: false, projection: current }
    clearRemoteProjection(preview.nodeId, { restorePresentation: false })
    return { accepted: true, projection: null }
  }

  function receive(preview: DragPreviewMessage) {
    if (disposed || preview.sessionId === transport.sessionId) return
    if (preview.pageId !== store.state.currentPageId) return
    if (localGestures.has(preview.nodeId)) return
    const node = store.graph.getNode(preview.nodeId)
    if (!node || !store.graph.isDescendant(preview.nodeId, preview.pageId)) return

    const receivedAt = now()
    const key = gestureKey(preview)
    if (!consumeTerminalWatermark(key, receivedAt)) return
    const resolution = resolveCurrentProjection(preview)
    if (!resolution.accepted) return
    const current = resolution.projection

    if (preview.phase === 'cancelled') {
      setTerminalWatermark(key)
      if (current) clearRemoteProjection(preview.nodeId, { tombstone: false })
      return
    }

    const displayed = store.graph.getPresentedNodePosition(preview.nodeId)
    const durationMs = current
      ? interpolationDuration(receivedAt - current.lastReceivedAt, maximumInterpolationMs)
      : maximumInterpolationMs
    if (current) clearProjectionTimer(current)
    const projection: RemoteProjection = {
      authoritativeMatched:
        preview.phase === 'terminal' && samePosition(node, { x: preview.x, y: preview.y }),
      durationMs,
      expiresAt: receivedAt + (preview.phase === 'terminal' ? terminalTimeoutMs : activeTimeoutMs),
      expiryTimer: null,
      gestureId: preview.gestureId,
      lastReceivedAt: receivedAt,
      nodeId: preview.nodeId,
      pageId: preview.pageId,
      phase: preview.phase,
      sequence: preview.sequence,
      sessionId: preview.sessionId,
      startedAt: receivedAt,
      startX: displayed.x,
      startY: displayed.y,
      targetX: preview.x,
      targetY: preview.y
    }
    remoteProjections.set(preview.nodeId, projection)
    armProjectionExpiry(projection)
    if (preview.phase === 'terminal') setTerminalWatermark(key)
    scheduleNextUpdate()
  }

  function onPreviewUpdated(nodeId: string, changes: Record<string, unknown>) {
    if (disposed || applyingRemotePresentation || !onlyTranslates(changes)) return
    if (!store.state.selectedIds.has(nodeId)) return
    const node = store.graph.getNode(nodeId)
    if (!node || !store.graph.isDescendant(nodeId, store.state.currentPageId)) return

    clearRemoteProjection(nodeId)
    invalidateLocalCancellation(nodeId)
    let gesture = localGestures.get(nodeId)
    if (!gesture) {
      gesture = {
        gestureId: crypto.randomUUID(),
        nodeId,
        pageId: store.state.currentPageId,
        pending: null,
        sequence: 0
      }
      localGestures.set(nodeId, gesture)
    }
    gesture.pending = store.graph.getPresentedNodePosition(nodeId)
    scheduleNextUpdate()

    const authoritative = authoritativePositions.get(nodeId)
    if (!authoritative || !samePosition(node, authoritative)) return
    const generation = localCancelGenerations.get(nodeId)
    queueMicrotask(() => {
      if (disposed || generation !== localCancelGenerations.get(nodeId)) return
      const active = localGestures.get(nodeId)
      const currentPosition = store.graph.getPresentedNodePosition(nodeId)
      if (!active || !samePosition(currentPosition, authoritative)) return
      active.pending = null
      cancelLocalGesture(nodeId)
    })
  }

  function reconcileRemoteAuthority(nodeId: string, position: Vector) {
    const projection = remoteProjections.get(nodeId)
    if (!projection) return
    if (projection.phase === 'terminal') {
      if (!samePosition(position, { x: projection.targetX, y: projection.targetY })) {
        clearRemoteProjection(nodeId)
        return
      }
      projection.authoritativeMatched = true
      if (
        samePosition(store.graph.getPresentedNodePosition(nodeId), {
          x: projection.targetX,
          y: projection.targetY
        })
      ) {
        clearRemoteProjection(nodeId)
        return
      }
      scheduleNextUpdate()
      return
    }

    projection.expiresAt = Math.min(projection.expiresAt, now() + terminalGraceMs)
    armProjectionExpiry(projection)
  }

  function onNodeUpdated(nodeId: string, changes: Record<string, unknown>) {
    const node = store.graph.getNode(nodeId)
    if (!node) return
    const previous = authoritativePositions.get(nodeId)
    const position = { x: node.x, y: node.y }
    authoritativePositions.set(nodeId, position)
    if (previous && !samePosition(previous, position)) {
      reconcileRemoteAuthority(nodeId, position)
    }
    if (!onlyTranslates(changes)) return
    const gesture = localGestures.get(nodeId)
    if (!gesture) return
    invalidateLocalCancellation(nodeId)
    gesture.pending = null
    publish(gesture, 'terminal', position)
    localGestures.delete(nodeId)
  }

  function onNodeStructureChanged(nodeId: string) {
    cancelLocalGesture(nodeId)
    clearRemoteProjection(nodeId)
    const node = store.graph.getNode(nodeId)
    if (node) authoritativePositions.set(nodeId, { x: node.x, y: node.y })
  }

  function reset() {
    for (const nodeId of localGestures.keys()) cancelLocalGesture(nodeId)
    for (const nodeId of remoteProjections.keys()) clearRemoteProjection(nodeId)
    localCancelGenerations.clear()
    snapshotAuthoritativePositions()
  }

  if (IS_BROWSER) {
    window.addEventListener('pagehide', reset, { capture: true })
  }

  const unsubscribes = [
    store.onEditorEvent('node:previewUpdated', (nodeId, changes) =>
      onPreviewUpdated(nodeId, changes)
    ),
    store.onEditorEvent('node:updated', (nodeId, changes) => onNodeUpdated(nodeId, changes)),
    store.onEditorEvent('node:created', (node) => {
      authoritativePositions.set(node.id, { x: node.x, y: node.y })
    }),
    store.onEditorEvent('node:deleted', (nodeId) => {
      cancelLocalGesture(nodeId)
      clearRemoteProjection(nodeId)
      localCancelGenerations.delete(nodeId)
      authoritativePositions.delete(nodeId)
    }),
    store.onEditorEvent('node:reparented', onNodeStructureChanged),
    store.onEditorEvent('node:reordered', onNodeStructureChanged),
    store.onEditorEvent('page:changed', reset),
    store.onEditorEvent('graph:replaced', reset),
    transport.subscribeDragPreview(receive),
    transport.subscribeSessionDisconnect((sessionId) => {
      for (const projection of remoteProjections.values()) {
        if (projection.sessionId === sessionId) clearRemoteProjection(projection.nodeId)
      }
    })
  ]

  snapshotAuthoritativePositions()

  return {
    dispose() {
      if (disposed) return
      for (const nodeId of localGestures.keys()) cancelLocalGesture(nodeId)
      disposed = true
      cancel(flushUpdate)
      updateScheduled = false
      for (const unsubscribe of unsubscribes) unsubscribe()
      if (IS_BROWSER) {
        window.removeEventListener('pagehide', reset, { capture: true })
      }
      for (const nodeId of remoteProjections.keys()) clearRemoteProjection(nodeId)
      localCancelGenerations.clear()
      terminalWatermarks.clear()
      authoritativePositions.clear()
    }
  }
}
