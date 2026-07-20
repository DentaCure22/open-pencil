import { watch } from 'vue'

import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

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

import { isNarratedTraceCanvasInkNode } from './canvas-ink'
import { appendNarratedTraceEvent, narratedTraceStatus } from './state'
import type { NarratedTraceChange, NarratedTraceTarget, NarratedTraceViewport } from './types'

type StopBinding = () => void

let stops: StopBinding[] = []
let nodeSnapshots = new Map<string, SceneNode>()
let previousLiveDrafts = new Map<string, LiveInspectorPatchDraft>()

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

function snapshotGraph(editor: Editor) {
  nodeSnapshots = new Map([...editor.graph.nodes].map(([id, node]) => [id, structuredClone(node)]))
}

function routeForNode(node: SceneNode): string | undefined {
  return node.pluginData.find((entry) => entry.key === 'route')?.value
}

function sceneNodePath(editor: Editor, node: SceneNode): string[] {
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

function sceneNodeTarget(editor: Editor, node: SceneNode): NarratedTraceTarget {
  return {
    bounds: { height: node.height, width: node.width, x: node.x, y: node.y },
    name: node.name || node.type,
    path: sceneNodePath(editor, node),
    route: routeForNode(node),
    stableId: node.id
  }
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

function traceValue(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  try {
    const serialized = JSON.stringify(value)
    return serialized.length > 500 ? `${serialized.slice(0, 497)}...` : serialized
  } catch {
    return String(value)
  }
}

function changesForNodeUpdate(
  previous: SceneNode | undefined,
  changes: Partial<SceneNode>
): NarratedTraceChange[] {
  return (Object.keys(changes) as Array<keyof SceneNode>).flatMap((property) => {
    if (property === 'pluginData') return []
    const after = traceValue(changes[property])
    const before = traceValue(previous?.[property])
    if (after === before) return []
    return [{ after, before, property: String(property) }]
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

function recordLiveDraftMutations(nextDrafts: Map<string, LiveInspectorPatchDraft>) {
  const nodeIds = new Set([...previousLiveDrafts.keys(), ...nextDrafts.keys()])
  for (const nodeId of nodeIds) {
    const changes = livePatchChanges(previousLiveDrafts.get(nodeId), nextDrafts.get(nodeId))
    if (changes.length === 0) continue
    const target = liveNodeTarget(nodeId)
    appendNarratedTraceEvent(
      {
        changes,
        kind: 'edit',
        label: `Edited ${target?.name ?? nodeId}`,
        target: target ?? undefined
      },
      { coalesceKey: `live-edit:${nodeId}`, coalesceWindowMs: 750 }
    )
  }
}

function bindEditorEvents(editor: Editor) {
  stops.push(
    editor.onEditorEvent('selection:changed', (selectedIds) => {
      if (
        narratedTraceStatus.value !== 'recording' ||
        (editor.state.activeTool === 'SMYLR_CONTAINER' && liveInspectorSelectedId.value)
      ) {
        return
      }
      const node = selectedIds.length === 1 ? editor.graph.getNode(selectedIds[0]) : undefined
      if (!node || isNarratedTraceCanvasInkNode(node)) return
      const target = sceneNodeTarget(editor, node)
      appendNarratedTraceEvent({
        kind: 'selection',
        label: `Selected ${target.name}`,
        target
      })
    }),
    editor.onEditorEvent('node:created', (node) => {
      nodeSnapshots.set(node.id, structuredClone(node))
      if (narratedTraceStatus.value !== 'recording' || isNarratedTraceCanvasInkNode(node)) return
      const target = sceneNodeTarget(editor, node)
      appendNarratedTraceEvent({
        kind: 'shape',
        label: `Created ${target.name}`,
        target
      })
    }),
    editor.onEditorEvent('node:updated', (id, changes) => {
      const previous = nodeSnapshots.get(id)
      const current = editor.graph.getNode(id)
      if (current) nodeSnapshots.set(id, structuredClone(current))
      if (narratedTraceStatus.value !== 'recording' || !current) return
      const recordedChanges = changesForNodeUpdate(previous, changes)
      if (recordedChanges.length === 0) return
      const properties = recordedChanges.map((change) => change.property).sort()
      const target = sceneNodeTarget(editor, current)
      appendNarratedTraceEvent(
        {
          changes: recordedChanges,
          kind: 'edit',
          label: `Edited ${target.name}`,
          target
        },
        { coalesceKey: `node-edit:${id}:${properties.join(',')}`, coalesceWindowMs: 750 }
      )
    }),
    editor.onEditorEvent('node:deleted', (id) => {
      const previous = nodeSnapshots.get(id)
      nodeSnapshots.delete(id)
      if (narratedTraceStatus.value !== 'recording' || !previous) return
      appendNarratedTraceEvent({
        kind: 'edit',
        label: `Deleted ${previous.name || previous.type}`,
        target: sceneNodeTarget(editor, previous)
      })
    }),
    editor.onEditorEvent('node:reparented', (nodeId, oldParentId, newParentId) => {
      const node = editor.graph.getNode(nodeId)
      if (node) nodeSnapshots.set(nodeId, structuredClone(node))
      if (!node || narratedTraceStatus.value !== 'recording') return
      appendNarratedTraceEvent({
        changes: [{ after: newParentId, before: oldParentId ?? undefined, property: 'parentId' }],
        kind: 'edit',
        label: `Moved ${node.name || node.type} to another container`,
        target: sceneNodeTarget(editor, node)
      })
    }),
    editor.onEditorEvent('viewport:changed', (viewport) => {
      const nextViewport: NarratedTraceViewport = viewport
      appendNarratedTraceEvent(
        { kind: 'viewport', label: 'Changed canvas view', viewport: nextViewport },
        { coalesceKey: 'viewport', coalesceWindowMs: 900 }
      )
    }),
    editor.onEditorEvent('page:changed', (pageId, previousPageId) => {
      if (narratedTraceStatus.value !== 'recording') return
      const page = editor.graph.getNode(pageId)
      const previousPage = editor.graph.getNode(previousPageId)
      appendNarratedTraceEvent({
        changes: [
          {
            after: page?.name ?? pageId,
            before: previousPage?.name ?? previousPageId,
            property: 'page'
          }
        ],
        kind: 'navigation',
        label: `Opened ${page?.name ?? 'page'}`,
        target: page ? sceneNodeTarget(editor, page) : undefined
      })
    }),
    editor.onEditorEvent('tool:changed', (tool, previousTool) => {
      if (narratedTraceStatus.value !== 'recording') return
      appendNarratedTraceEvent({
        changes: [{ after: tool, before: previousTool, property: 'tool' }],
        kind: 'tool',
        label: `Switched to ${tool}`
      })
    }),
    editor.onEditorEvent('graph:replaced', () => snapshotGraph(editor))
  )
}

export function bindNarratedTraceEditor(editor: Editor) {
  for (const stop of stops) stop()
  stops = []
  snapshotGraph(editor)
  previousLiveDrafts = copyLiveDrafts(liveInspectorPatchDrafts.value)

  bindEditorEvents(editor)
  stops.push(
    watch(narratedTraceStatus, (status, previousStatus) => {
      if (status === 'recording' && previousStatus !== 'recording') snapshotGraph(editor)
    }),
    watch(liveInspectorSelectionEpoch, () => {
      if (narratedTraceStatus.value !== 'recording') return
      const nodeId = liveInspectorSelectedId.value
      const target = nodeId ? liveNodeTarget(nodeId) : null
      if (!target) return
      appendNarratedTraceEvent({
        kind: 'selection',
        label: `C-selected ${target.name}`,
        target
      })
    }),
    watch(liveInspectorPatchDrafts, (nextDrafts) => {
      if (narratedTraceStatus.value === 'recording') recordLiveDraftMutations(nextDrafts)
      previousLiveDrafts = copyLiveDrafts(nextDrafts)
    })
  )
}
