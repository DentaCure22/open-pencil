import { watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import {
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorSelectedId,
  liveInspectorSelectedRect,
  liveInspectorSelectionEpoch
} from '@/app/smylr-live-inspector/session'

import {
  changesForNarratedTraceNodeUpdate,
  snapshotNarratedTraceNode,
  type NarratedTraceNodeSnapshot
} from './activity'
import { narratedTraceAnnotationTool } from './annotation'
import { isNarratedTraceCanvasInkNode } from './canvas-ink'
import { narratedTraceTargetForLiveInspectorSelection } from './live-inspector-target'
import { narratedTraceScopeForStore } from './scope'
import {
  appendNarratedTraceEvent,
  beginNarratedTraceEpisode,
  beginNarratedTraceSession,
  finishNarratedTraceSession,
  narratedTraceSession,
  narratedTraceStatus
} from './state'
import { narratedTraceAnchorForCanvasPoint } from './target'
import type {
  NarratedTraceAppendOptions,
  NarratedTraceChange,
  NarratedTraceEventInput,
  NarratedTraceScope,
  NarratedTraceTarget
} from './types'

type StopBinding = () => void

type PendingTargetActivity = {
  changes: Map<string, NarratedTraceChange>
  scope: NarratedTraceScope
  target: NarratedTraceTarget
  timer: ReturnType<typeof setTimeout>
}

type PendingCreation = {
  intentConfirmed: boolean
  scope: NarratedTraceScope
}

const ACTIVITY_SESSION_IDLE_MS = 900
const COMPLETED_EDIT_IDLE_MS = 650
const SELECTION_COALESCE_MS = 1200

let stops: StopBinding[] = []
let nodeSnapshots = new Map<string, NarratedTraceNodeSnapshot>()
let pendingNodeActivities = new Map<string, PendingTargetActivity>()
let pendingCreations = new Map<string, PendingCreation>()
let creationFlushTimer: ReturnType<typeof setTimeout> | null = null
let ownedActivitySessionId: string | null = null
let activitySessionTimer: ReturnType<typeof setTimeout> | null = null
let lastSelectionKey = ''
let lastSelectionAt = 0
let lastSelectedNodeIds = new Set<string>()

function snapshotSelectedNodes(editor: EditorStore, selectedIds = editor.state.selectedIds) {
  nodeSnapshots = new Map(
    [...selectedIds].flatMap((id) => {
      const node = editor.graph.getNode(id)
      return node ? [[id, snapshotNarratedTraceNode(node)] as const] : []
    })
  )
}

function routeForNode(node: NarratedTraceNodeSnapshot): string | undefined {
  return node.pluginData.find((entry) => entry.key === 'route')?.value
}

function sceneNodePath(editor: EditorStore, node: NarratedTraceNodeSnapshot): string[] {
  const path: string[] = []
  let current: NarratedTraceNodeSnapshot | undefined = node
  let depth = 0
  while (current && depth < 32) {
    path.unshift(current.name || current.type)
    current = current.parentId ? editor.graph.getNode(current.parentId) : undefined
    depth += 1
  }
  return path
}

function sceneNodeTarget(
  editor: EditorStore,
  node: NarratedTraceNodeSnapshot
): NarratedTraceTarget {
  const liveNode = editor.graph.getNode(node.id)
  return {
    bounds: liveNode
      ? editor.graph.getAbsoluteBounds(node.id)
      : { height: node.height, width: node.width, x: node.x, y: node.y },
    name: node.name || node.type,
    path: sceneNodePath(editor, node),
    route: routeForNode(node),
    stableId: node.id
  }
}

function selectionAnchor(editor: EditorStore, target: NarratedTraceTarget) {
  const { cursorCanvasX, cursorCanvasY } = editor.state
  const bounds = target.bounds
  if (
    target.frameId ||
    typeof cursorCanvasX !== 'number' ||
    typeof cursorCanvasY !== 'number' ||
    !Number.isFinite(cursorCanvasX) ||
    !Number.isFinite(cursorCanvasY) ||
    !bounds ||
    cursorCanvasX < bounds.x ||
    cursorCanvasY < bounds.y ||
    cursorCanvasX > bounds.x + bounds.width ||
    cursorCanvasY > bounds.y + bounds.height
  ) {
    return undefined
  }
  return narratedTraceAnchorForCanvasPoint(editor, { x: cursorCanvasX, y: cursorCanvasY }, bounds)
}

function sameScope(left: NarratedTraceScope | undefined, right: NarratedTraceScope) {
  return (
    left?.documentId === right.documentId &&
    left.pageId === right.pageId &&
    left.workspaceId === right.workspaceId
  )
}

function finishOwnedActivitySession() {
  if (activitySessionTimer) clearTimeout(activitySessionTimer)
  activitySessionTimer = null
  if (
    ownedActivitySessionId &&
    narratedTraceSession.value?.id === ownedActivitySessionId &&
    narratedTraceStatus.value === 'recording'
  ) {
    finishNarratedTraceSession()
  }
  ownedActivitySessionId = null
}

function scheduleActivitySessionFinish() {
  if (!ownedActivitySessionId) return
  if (activitySessionTimer) clearTimeout(activitySessionTimer)
  activitySessionTimer = setTimeout(finishOwnedActivitySession, ACTIVITY_SESSION_IDLE_MS)
}

function ensureActivitySession(scope: NarratedTraceScope) {
  const currentSession = narratedTraceSession.value
  if (narratedTraceStatus.value === 'recording') {
    if (ownedActivitySessionId && currentSession?.id === ownedActivitySessionId) {
      if (sameScope(currentSession.scope, scope)) return true
      finishOwnedActivitySession()
    } else {
      return sameScope(currentSession?.scope, scope)
    }
  }
  beginNarratedTraceSession(scope)
  ownedActivitySessionId = narratedTraceSession.value?.id ?? null
  return ownedActivitySessionId !== null
}

function recordActivity(
  scope: NarratedTraceScope,
  event: NarratedTraceEventInput,
  options: NarratedTraceAppendOptions = {}
) {
  if (!ensureActivitySession(scope)) return null
  const sessionId = narratedTraceSession.value?.id
  const episodeId = event.origin?.episodeId ?? (sessionId ? `board:${sessionId}` : '')
  if (episodeId) {
    beginNarratedTraceEpisode(
      event.origin
        ? {
            id: episodeId,
            kind: event.origin.kind,
            sourceSessionId: event.origin.sourceSessionId
          }
        : { id: episodeId, kind: 'board', label: 'Board activity' }
    )
  }
  const eventId = appendNarratedTraceEvent(
    episodeId && !event.origin ? { ...event, origin: { episodeId, kind: 'board' } } : event,
    options
  )
  scheduleActivitySessionFinish()
  return eventId
}

export function recordNarratedTraceActivity(
  scope: NarratedTraceScope,
  event: NarratedTraceEventInput,
  options: NarratedTraceAppendOptions = {}
) {
  return recordActivity(scope, event, options)
}

function mergeChanges(existing: Map<string, NarratedTraceChange>, incoming: NarratedTraceChange[]) {
  for (const change of incoming) {
    const previous = existing.get(change.property)
    existing.set(change.property, {
      ...change,
      before: previous?.before ?? change.before
    })
  }
}

function flushNodeActivity(nodeId: string) {
  const pending = pendingNodeActivities.get(nodeId)
  if (!pending) return
  pendingNodeActivities.delete(nodeId)
  const changes = [...pending.changes.values()].filter((change) => change.before !== change.after)
  if (changes.length === 0) return
  recordActivity(pending.scope, {
    changes,
    kind: 'edit',
    label: `Edited ${pending.target.name}`,
    target: pending.target
  })
}

function queueNodeActivity(
  editor: EditorStore,
  node: SceneNode,
  changes: NarratedTraceChange[],
  scope = narratedTraceScopeForStore(editor)
) {
  if (changes.length === 0 || isNarratedTraceCanvasInkNode(node)) return
  const existing = pendingNodeActivities.get(node.id)
  if (existing) clearTimeout(existing.timer)
  const merged = existing?.changes ?? new Map<string, NarratedTraceChange>()
  mergeChanges(merged, changes)
  pendingNodeActivities.set(node.id, {
    changes: merged,
    scope,
    target: sceneNodeTarget(editor, node),
    timer: setTimeout(() => flushNodeActivity(node.id), COMPLETED_EDIT_IDLE_MS)
  })
}

function flushCreations(editor: EditorStore) {
  creationFlushTimer = null
  const creations = pendingCreations
  pendingCreations = new Map()
  for (const [nodeId, pending] of creations) {
    const node = editor.graph.getNode(nodeId)
    if (!pending.intentConfirmed || !node || isNarratedTraceCanvasInkNode(node)) continue
    const target = sceneNodeTarget(editor, node)
    recordActivity(pending.scope, {
      kind: 'shape',
      label: `Created ${target.name}`,
      target
    })
  }
}

function scheduleCreationFlush(editor: EditorStore) {
  if (creationFlushTimer) return
  creationFlushTimer = setTimeout(() => flushCreations(editor), COMPLETED_EDIT_IDLE_MS)
}

function queueCreation(editor: EditorStore, node: SceneNode) {
  if (editor.state.loading || isNarratedTraceCanvasInkNode(node)) return
  const existing = pendingCreations.get(node.id)
  pendingCreations.set(node.id, {
    intentConfirmed: existing?.intentConfirmed ?? editor.state.selectedIds.has(node.id),
    scope: existing?.scope ?? narratedTraceScopeForStore(editor)
  })
  scheduleCreationFlush(editor)
}

function recordSelection(editor: EditorStore, target: NarratedTraceTarget) {
  const scope = narratedTraceScopeForStore(editor)
  const key = [
    scope.workspaceId ?? '',
    scope.documentId,
    scope.pageId,
    target.frameId ?? '',
    target.route ?? '',
    target.stableId
  ].join(':')
  const now = Date.now()
  if (key === lastSelectionKey && now - lastSelectionAt <= SELECTION_COALESCE_MS) return
  lastSelectionKey = key
  lastSelectionAt = now
  const anchor = selectionAnchor(editor, target)
  recordActivity(
    scope,
    {
      ...(anchor ? { anchor } : {}),
      kind: 'selection',
      label: `Selected ${target.name}`,
      target
    },
    { coalesceKey: `selection:${key}`, coalesceWindowMs: SELECTION_COALESCE_MS }
  )
}

function bindEditorEvents(editor: EditorStore) {
  stops.push(
    editor.onEditorEvent('selection:changed', (selectedIds) => {
      lastSelectedNodeIds = new Set(selectedIds)
      snapshotSelectedNodes(editor, lastSelectedNodeIds)
      for (const selectedId of selectedIds) {
        const pendingCreation = pendingCreations.get(selectedId)
        if (pendingCreation) pendingCreation.intentConfirmed = true
      }
      if (editor.state.loading) return
      const node = selectedIds.length === 1 ? editor.graph.getNode(selectedIds[0]) : undefined
      if (!node || isNarratedTraceCanvasInkNode(node)) return
      recordSelection(editor, sceneNodeTarget(editor, node))
    }),
    editor.onEditorEvent('node:created', (node) => {
      queueCreation(editor, node)
    }),
    editor.onEditorEvent('node:updated', (id, changes) => {
      const selected = lastSelectedNodeIds.has(id)
      const previous = selected ? nodeSnapshots.get(id) : undefined
      const current = editor.graph.getNode(id)
      if (current && selected) nodeSnapshots.set(id, snapshotNarratedTraceNode(current))
      if (!current || editor.state.loading) return
      const pendingCreation = pendingCreations.get(id)
      if (pendingCreation) {
        scheduleCreationFlush(editor)
        return
      }
      if (!selected) return
      queueNodeActivity(editor, current, changesForNarratedTraceNodeUpdate(previous, changes))
    }),
    editor.onEditorEvent('node:deleted', (id) => {
      const previous = nodeSnapshots.get(id)
      nodeSnapshots.delete(id)
      const pendingCreation = pendingCreations.get(id)
      if (pendingCreation) {
        pendingCreations.delete(id)
        return
      }
      const pendingActivity = pendingNodeActivities.get(id)
      if (pendingActivity) {
        clearTimeout(pendingActivity.timer)
        pendingNodeActivities.delete(id)
      }
      if (
        editor.state.loading ||
        !lastSelectedNodeIds.has(id) ||
        !previous ||
        isNarratedTraceCanvasInkNode(previous)
      ) {
        return
      }
      recordActivity(narratedTraceScopeForStore(editor), {
        kind: 'edit',
        label: `Deleted ${previous.name || previous.type}`,
        target: sceneNodeTarget(editor, previous)
      })
    }),
    editor.onEditorEvent('node:reparented', (nodeId, oldParentId, newParentId) => {
      const node = editor.graph.getNode(nodeId)
      if (!node || editor.state.loading || !lastSelectedNodeIds.has(nodeId)) return
      nodeSnapshots.set(nodeId, snapshotNarratedTraceNode(node))
      queueNodeActivity(editor, node, [
        { after: newParentId, before: oldParentId ?? undefined, property: 'parentId' }
      ])
    }),
    editor.onEditorEvent('tool:changed', (tool, previousTool) => {
      if (editor.state.loading) return
      recordActivity(narratedTraceScopeForStore(editor), {
        changes: [{ after: tool, before: previousTool, property: 'tool' }],
        kind: 'tool',
        label: `Activated ${tool}`
      })
    }),
    editor.onEditorEvent('graph:replaced', () => {
      for (const pending of pendingNodeActivities.values()) clearTimeout(pending.timer)
      if (creationFlushTimer) clearTimeout(creationFlushTimer)
      creationFlushTimer = null
      pendingNodeActivities = new Map()
      pendingCreations = new Map()
      snapshotSelectedNodes(editor)
    })
  )
}

function clearPendingActivities() {
  for (const pending of pendingNodeActivities.values()) clearTimeout(pending.timer)
  if (creationFlushTimer) clearTimeout(creationFlushTimer)
  creationFlushTimer = null
  pendingNodeActivities = new Map()
  pendingCreations = new Map()
}

export function bindNarratedTraceEditor(editor: EditorStore) {
  for (const stop of stops) stop()
  stops = []
  finishOwnedActivitySession()
  clearPendingActivities()
  snapshotSelectedNodes(editor)
  lastSelectionKey = ''
  lastSelectionAt = 0
  lastSelectedNodeIds = new Set(editor.state.selectedIds)

  bindEditorEvents(editor)
  stops.push(
    watch(narratedTraceAnnotationTool, (tool, previousTool) => {
      if (tool === 'none' || editor.state.loading) return
      recordActivity(narratedTraceScopeForStore(editor), {
        changes: [{ after: tool, before: previousTool, property: 'traceTool' }],
        kind: 'tool',
        label: `Activated Trace ${tool === 'ink' ? 'Ink' : 'Focus'}`
      })
    }),
    watch(liveInspectorSelectionEpoch, () => {
      if (editor.state.loading) return
      const frameId = liveInspectorActiveFrameId.value
      const document = liveInspectorDocument.value
      const selectedId = liveInspectorSelectedId.value
      const selectedRect = liveInspectorSelectedRect.value
      const frame = frameId ? editor.graph.getNode(frameId) : undefined
      if (!frameId || !document || !selectedId || !selectedRect || !frame) return

      const target = narratedTraceTargetForLiveInspectorSelection({
        document,
        frameBounds: editor.graph.getAbsoluteBounds(frameId),
        frameId,
        framePath: sceneNodePath(editor, frame),
        selectedId,
        selectedRect
      })
      if (target) recordSelection(editor, target)
    })
  )
}
