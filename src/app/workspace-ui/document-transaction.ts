import {
  deserializeSceneGraph,
  serializeSceneGraph,
  type SerializedSceneGraph
} from '@open-pencil/core/kiwi'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { Color } from '@open-pencil/scene-graph'

import { persistOpenPencilDocument } from '@/app/document/persistence-target'
import type { EditorStore } from '@/app/editor/session'
import {
  hydrateActiveKnowledgeWorkspaces,
  serializeActiveKnowledgeWorkspaces
} from '@/app/workspace'

import { persistKnowledgeWorkspacesToScene } from './persistence'

type SceneDocumentSnapshot = {
  currentPageId: string
  graph: SerializedSceneGraph
  pageColor: Color
  selectedIds: string[]
  viewport: { panX: number; panY: number; zoom: number }
  workspaceRegistry: string
}

function snapshotDocument(store: EditorStore): SceneDocumentSnapshot {
  return {
    currentPageId: store.state.currentPageId,
    graph: structuredClone(serializeSceneGraph(store.graph)),
    pageColor: { ...store.state.pageColor },
    selectedIds: [...store.state.selectedIds],
    viewport: {
      panX: store.state.panX,
      panY: store.state.panY,
      zoom: store.state.zoom
    },
    workspaceRegistry: serializeActiveKnowledgeWorkspaces()
  }
}

async function restoreDocument(store: EditorStore, snapshot: SceneDocumentSnapshot) {
  store.replaceGraph(deserializeSceneGraph(structuredClone(snapshot.graph)))
  hydrateActiveKnowledgeWorkspaces(snapshot.workspaceRegistry)
  persistKnowledgeWorkspacesToScene(store.graph)
  await store.switchPage(snapshot.currentPageId)
  store.select(snapshot.selectedIds)
  store.state.panX = snapshot.viewport.panX
  store.state.panY = snapshot.viewport.panY
  store.state.zoom = snapshot.viewport.zoom
  store.state.pageColor = { ...snapshot.pageColor }
  computeAllLayouts(store.graph, snapshot.currentPageId)
  store.requestRender()
  store.requestRepaint()
  return persistOpenPencilDocument(store)
}

export async function runWorkspaceDocumentTransaction<T>(
  store: EditorStore,
  input: { historyEntryId: string; label: string },
  mutation: () => Promise<T>
): Promise<T> {
  const before = snapshotDocument(store)
  let value: T
  try {
    value = await mutation()
  } catch (error) {
    await restoreDocument(store, before)
    throw error
  }
  const after = snapshotDocument(store)
  store.pushUndoEntry({
    forward: () => void restoreDocument(store, after),
    inverse: () => void restoreDocument(store, before),
    label: `${input.label} · ${input.historyEntryId}`
  })
  return value
}
