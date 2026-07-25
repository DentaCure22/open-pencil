import { watch } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'
import type { LiveInspectorPatchDraft } from '@/app/smylr-live-inspector/patch'
import {
  findLiveInspectorNode,
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorPatchDrafts,
  liveInspectorRoute,
  liveInspectorSelectedId,
  liveInspectorSelectedRect,
  liveInspectorSelectionEpoch
} from '@/app/smylr-live-inspector/session'

import { changesForNarratedTraceNodeUpdate } from './activity'
import { narratedTraceAnnotationTool } from './annotation'
import { isNarratedTraceCanvasInkNode } from './canvas-ink'
import { narratedTraceScopeForStore } from './scope'
import {
  appendNarratedTraceEvent,
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
  timer: ReturnType<typeof setTimeout>
}

const ACTIVITY_SESSION_IDLE_MS = 900
const COMPLETED_EDIT_IDLE_MS = 650
const SELECTION_COALESCE_MS = 1200

let stops: StopBinding[] = []
let nodeSnapshots = new Map<string, SceneNode>()
let previousLiveDrafts = new Map<string, LiveInspectorPatchDraft>()
let pendingNodeActivities = new Map<string, PendingTargetActivity>()
let pendingCreations = new Map<string, PendingCreation>()
let pendingLiveActivities = new Map<string, PendingTargetActivity>()
let ownedActivitySessionId: string | null = null
let activitySessionTimer: ReturnType<typeof setTimeout> | null = null
let lastSelectionKey = ''
let lastSelectionAt = 0
let lastSelectedNodeIds = new Set<string>()

function copyLiveDrafts(source: Map<string, LiveInspectorPatchDraft>) {
  return new Map(
    [...source].map(([id, draft]) => [
      id,
      {
        ...draft,
        add: [...draft.add],
        remove: [...draft.remove],
        source: draft.source ? structuredClone(draft.source) : undefined,
        styles: draft.styles ? { ...draft.styles } : undefined
      }
    ])
  )
}

function snapshotGraph(editor: EditorStore) {
  nodeSnapshots = new Map([...editor.graph.nodes].map(([id, node]) => [id, structuredClone(node)]))
}

function routeForNode(node: SceneNode): string | undefined {
  return node.pluginData.find((entry) => entry.key === 'route')?.value
}

function sceneNodePath(editor: EditorStore, node: SceneNode): string[] {
  const path: string[] = []
  let current: SceneNode | undefined = node
  let depth = 0
  while (current && depth < 32) {
    path.unshift(current.name || current.type)
    current = current.parentId ? editor.graph.getNode(current.parentId) : undefined
    depth += 1
  }
  return path
}

function sceneNodeTarget(editor: EditorStore, node: SceneNode): NarratedTraceTarget {
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

function liveNodePath(
  root: SmylrLiveContainerNode,
  targetId: string,
  ancestors: string[] = []
): string[] | null {
  const path = [...ancestors, root.label]
  if (root.id === targetId) return path
  for (const child of root.children ?? []) {
    const childPath = liveNodePath(child, targetId, path)
    if (childPath) return childPath
  }
  return null
}

function liveNodeTarget(nodeId: string): NarratedTraceTarget | null {
  const document = liveInspectorDocument.value
  const node = findLiveInspectorNode(document?.tree, nodeId)
  if (!document || !node) return null
  const rect =
    liveInspectorSelectedId.value === nodeId ? liveInspectorSelectedRect.value : node.rect
  return {
    bounds: rect ? { height: rect.height, width: rect.width, x: rect.x, y: rect.y } : undefined,
    frameId: liveInspectorActiveFrameId.value ?? undefined,
    name: node.label,
    path: liveNodePath(document.tree, nodeId) ?? [node.label],
    route: liveInspectorRoute.value ?? document.route,
    stableId: node.id
  }
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
  if (narratedTraceStatus.value === 'paused') return false
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
  const eventId = appendNarratedTraceEvent(event, options)
  scheduleActivitySessionFinish()
  return eventId
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

function flushCreation(editor: EditorStore, nodeId: string) {
  const pending = pendingCreations.get(nodeId)
  if (!pending) return
  pendingCreations.delete(nodeId)
  const node = editor.graph.getNode(nodeId)
  if (!pending.intentConfirmed || !node || isNarratedTraceCanvasInkNode(node)) return
  const target = sceneNodeTarget(editor, node)
  recordActivity(pending.scope, {
    kind: 'shape',
    label: `Created ${target.name}`,
    target
  })
}

function queueCreation(editor: EditorStore, node: SceneNode) {
  if (editor.state.loading || isNarratedTraceCanvasInkNode(node)) return
  const existing = pendingCreations.get(node.id)
  if (existing) clearTimeout(existing.timer)
  pendingCreations.set(node.id, {
    intentConfirmed: existing?.intentConfirmed ?? editor.state.selectedIds.has(node.id),
    scope: narratedTraceScopeForStore(editor),
    timer: setTimeout(() => flushCreation(editor, node.id), COMPLETED_EDIT_IDLE_MS)
  })
}

function livePatchValues(draft: LiveInspectorPatchDraft | undefined): Map<string, string> {
  const values = new Map(Object.entries(draft?.styles ?? {}))
  if (draft) {
    if (draft.add.length > 0) values.set('tokens.add', draft.add.join(' '))
    if (draft.remove.length > 0) values.set('tokens.remove', draft.remove.join(' '))
  }
  return values
}

function livePatchChanges(
  before: LiveInspectorPatchDraft | undefined,
  after: LiveInspectorPatchDraft | undefined
): NarratedTraceChange[] {
  const beforeValues = livePatchValues(before)
  const afterValues = livePatchValues(after)
  const properties = new Set([...beforeValues.keys(), ...afterValues.keys()])
  return [...properties]
    .filter((property) => beforeValues.get(property) !== afterValues.get(property))
    .map((property) => ({
      after: afterValues.get(property),
      before: beforeValues.get(property),
      property
    }))
}

function flushLiveActivity(nodeId: string) {
  const pending = pendingLiveActivities.get(nodeId)
  if (!pending) return
  pendingLiveActivities.delete(nodeId)
  const changes = [...pending.changes.values()].filter((change) => change.before !== change.after)
  if (changes.length === 0) return
  recordActivity(pending.scope, {
    changes,
    kind: 'edit',
    label: `Edited ${pending.target.name}`,
    target: pending.target
  })
}

function queueLiveActivity(editor: EditorStore, nodeId: string, changes: NarratedTraceChange[]) {
  const target = liveNodeTarget(nodeId)
  if (!target || changes.length === 0) return
  const existing = pendingLiveActivities.get(nodeId)
  if (existing) clearTimeout(existing.timer)
  const merged = existing?.changes ?? new Map<string, NarratedTraceChange>()
  mergeChanges(merged, changes)
  pendingLiveActivities.set(nodeId, {
    changes: merged,
    scope: narratedTraceScopeForStore(editor),
    target,
    timer: setTimeout(() => flushLiveActivity(nodeId), COMPLETED_EDIT_IDLE_MS)
  })
}

function recordLiveDraftMutations(
  editor: EditorStore,
  nextDrafts: Map<string, LiveInspectorPatchDraft>
) {
  const nodeIds = new Set([...previousLiveDrafts.keys(), ...nextDrafts.keys()])
  for (const nodeId of nodeIds) {
    queueLiveActivity(
      editor,
      nodeId,
      livePatchChanges(previousLiveDrafts.get(nodeId), nextDrafts.get(nodeId))
    )
  }
}

function recordSelection(editor: EditorStore, target: NarratedTraceTarget) {
  const scope = narratedTraceScopeForStore(editor)
  const key = [
    scope.workspaceId ?? '',
    scope.documentId,
    scope.pageId,
    target.frameId ?? '',
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
      for (const selectedId of selectedIds) {
        const pendingCreation = pendingCreations.get(selectedId)
        if (pendingCreation) pendingCreation.intentConfirmed = true
      }
      if (editor.state.loading) return
      if (editor.state.activeTool === 'SMYLR_CONTAINER' && liveInspectorSelectedId.value) return
      const node = selectedIds.length === 1 ? editor.graph.getNode(selectedIds[0]) : undefined
      if (!node || isNarratedTraceCanvasInkNode(node)) return
      recordSelection(editor, sceneNodeTarget(editor, node))
    }),
    editor.onEditorEvent('node:created', (node) => {
      nodeSnapshots.set(node.id, structuredClone(node))
      queueCreation(editor, node)
    }),
    editor.onEditorEvent('node:updated', (id, changes) => {
      const previous = nodeSnapshots.get(id)
      const current = editor.graph.getNode(id)
      if (current) nodeSnapshots.set(id, structuredClone(current))
      if (!current || editor.state.loading) return
      const pendingCreation = pendingCreations.get(id)
      if (pendingCreation) {
        clearTimeout(pendingCreation.timer)
        pendingCreations.set(id, {
          ...pendingCreation,
          timer: setTimeout(() => flushCreation(editor, id), COMPLETED_EDIT_IDLE_MS)
        })
        return
      }
      if (!lastSelectedNodeIds.has(id)) return
      queueNodeActivity(editor, current, changesForNarratedTraceNodeUpdate(previous, changes))
    }),
    editor.onEditorEvent('node:deleted', (id) => {
      const previous = nodeSnapshots.get(id)
      nodeSnapshots.delete(id)
      const pendingCreation = pendingCreations.get(id)
      if (pendingCreation) {
        clearTimeout(pendingCreation.timer)
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
      nodeSnapshots.set(nodeId, structuredClone(node))
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
      for (const pending of pendingCreations.values()) clearTimeout(pending.timer)
      pendingNodeActivities = new Map()
      pendingCreations = new Map()
      snapshotGraph(editor)
    })
  )
}

function clearPendingActivities() {
  for (const pending of pendingNodeActivities.values()) clearTimeout(pending.timer)
  for (const pending of pendingCreations.values()) clearTimeout(pending.timer)
  for (const pending of pendingLiveActivities.values()) clearTimeout(pending.timer)
  pendingNodeActivities = new Map()
  pendingCreations = new Map()
  pendingLiveActivities = new Map()
}

export function bindNarratedTraceEditor(editor: EditorStore) {
  for (const stop of stops) stop()
  stops = []
  finishOwnedActivitySession()
  clearPendingActivities()
  snapshotGraph(editor)
  previousLiveDrafts = copyLiveDrafts(liveInspectorPatchDrafts.value)
  lastSelectionKey = ''
  lastSelectionAt = 0
  lastSelectedNodeIds = new Set(editor.state.selectedIds)

  bindEditorEvents(editor)
  stops.push(
    watch(liveInspectorSelectionEpoch, () => {
      if (editor.state.loading) return
      const nodeId = liveInspectorSelectedId.value
      const target = nodeId ? liveNodeTarget(nodeId) : null
      if (target) recordSelection(editor, target)
    }),
    watch(liveInspectorPatchDrafts, (nextDrafts) => {
      if (!editor.state.loading) recordLiveDraftMutations(editor, nextDrafts)
      previousLiveDrafts = copyLiveDrafts(nextDrafts)
    }),
    watch(narratedTraceAnnotationTool, (tool, previousTool) => {
      if (tool === 'none' || editor.state.loading) return
      recordActivity(narratedTraceScopeForStore(editor), {
        changes: [{ after: tool, before: previousTool, property: 'traceTool' }],
        kind: 'tool',
        label: `Activated Trace ${tool === 'ink' ? 'Ink' : 'Focus'}`
      })
    })
  )
}
