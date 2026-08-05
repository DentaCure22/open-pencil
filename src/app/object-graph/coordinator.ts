import type { Editor } from '@open-pencil/core/editor'
import { isObjectGraphConnectionNode, type SceneNode } from '@open-pencil/scene-graph'

import { normalizeLegacyCodeObjectConnections } from '@/app/code-object/connection-migration'
import { normalizeObjectGraphConnectionRecords } from '@/app/object-graph/records'

type ObjectGraphCoordinatorState = {
  currentPageId: string
}

export type ObjectGraphCoordinator = {
  dispose: () => void
  subscribe: (listener: () => void) => () => void
  synchronizeAll: () => void
}

const PROJECTION_KEYS = new Set<keyof SceneNode>([
  'height',
  'name',
  'parentId',
  'pluginData',
  'rotation',
  'visible',
  'width',
  'x',
  'y'
])

function changesProjection(changes: Partial<SceneNode>): boolean {
  return (Object.keys(changes) as (keyof SceneNode)[]).some((key) => PROJECTION_KEYS.has(key))
}

export function createObjectGraphCoordinator(
  editor: Editor,
  state: ObjectGraphCoordinatorState
): ObjectGraphCoordinator {
  const listeners = new Set<() => void>()
  let synchronizing = false

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function synchronizeAll(): void {
    if (synchronizing) return
    synchronizing = true
    try {
      const migrated = normalizeLegacyCodeObjectConnections({ graph: editor.graph, state })
      if (normalizeObjectGraphConnectionRecords(editor.graph, state.currentPageId) || migrated) {
        editor.requestRender()
      }
    } finally {
      synchronizing = false
    }
  }

  function publish(normalize: boolean): void {
    if (synchronizing) return
    if (normalize) synchronizeAll()
    notify()
  }

  function nodeAffectsProjection(nodeId: string, changes: Partial<SceneNode>): boolean {
    const node = editor.graph.getNode(nodeId)
    if (!node || !changesProjection(changes)) return false
    return nodeId !== state.currentPageId && editor.graph.isDescendant(nodeId, state.currentPageId)
  }

  const unsubscribes = [
    editor.onEditorEvent('graph:replaced', () => publish(true)),
    editor.onEditorEvent('page:changed', () => publish(true)),
    editor.onEditorEvent('selection:changed', () => publish(false)),
    editor.onEditorEvent('hover:changed', () => publish(false)),
    editor.onEditorEvent('node:created', (node) => {
      if (isObjectGraphConnectionNode(node)) publish(true)
      else publish(false)
    }),
    editor.onEditorEvent('node:deleted', () => publish(true)),
    editor.onEditorEvent('node:reparented', () => publish(true)),
    editor.onEditorEvent('node:reordered', () => publish(false)),
    editor.onEditorEvent('node:previewUpdated', (nodeId, changes) => {
      if (nodeAffectsProjection(nodeId, changes)) publish(false)
    }),
    editor.onEditorEvent('node:updated', (nodeId, changes) => {
      const normalize =
        nodeId === state.currentPageId || isObjectGraphConnectionNode(editor.graph.getNode(nodeId))
      if (normalize || nodeAffectsProjection(nodeId, changes)) publish(normalize)
    })
  ]

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function dispose(): void {
    for (const unsubscribe of unsubscribes) unsubscribe()
    listeners.clear()
  }

  synchronizeAll()

  return { dispose, subscribe, synchronizeAll }
}
