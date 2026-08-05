import type { SceneNode } from '@open-pencil/scene-graph'

import type { BoardPermissionDescriptor } from '@/app/board-permissions'
import type { EditorStore } from '@/app/editor/active-store'

import {
  createBoardComponentSession,
  removeTransientBoardComponentsByMarker,
  type BoardComponentSession
} from './components'
import {
  BOARD_EXPERIENCE_SCHEMA_VERSION,
  type BoardExperienceDocument,
  type BoardExperienceId,
  type BoardExperiencePoint,
  type BoardExperienceSession,
  type BoardExperienceSnapshot
} from './contracts'
import { boardExperienceDefinition } from './registry'

const BOARD_EXPERIENCE_PLUGIN_ID = 'openpencil-board-experience'
const BOARD_EXPERIENCE_DOCUMENT_KEY = 'document'
const BOARD_EXPERIENCE_OWNER_KEY = 'owner'

type SessionRecord = {
  components: BoardComponentSession
  key: string
  session: BoardExperienceSession
}

const sessions = new WeakMap<EditorStore, SessionRecord>()
const listeners = new WeakMap<EditorStore, Set<() => void>>()
const constructing = new WeakSet<EditorStore>()

function emitChange(store: EditorStore) {
  store.requestOverlayRepaint()
  for (const listener of listeners.get(store) ?? []) listener()
}

function normalizedDocument(value: unknown): BoardExperienceDocument | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Partial<BoardExperienceDocument>
  if (
    candidate.schemaVersion !== BOARD_EXPERIENCE_SCHEMA_VERSION ||
    candidate.definitionId !== 'tower-defense' ||
    !candidate.settings ||
    typeof candidate.settings !== 'object' ||
    Array.isArray(candidate.settings)
  ) {
    return null
  }
  return {
    definitionId: candidate.definitionId,
    schemaVersion: BOARD_EXPERIENCE_SCHEMA_VERSION,
    settings: structuredClone(candidate.settings)
  }
}

export function boardExperienceDocument(page: SceneNode | null): BoardExperienceDocument | null {
  const raw = page?.pluginData.find(
    (entry) =>
      entry.pluginId === BOARD_EXPERIENCE_PLUGIN_ID && entry.key === BOARD_EXPERIENCE_DOCUMENT_KEY
  )?.value
  if (!raw) return null
  try {
    return normalizedDocument(JSON.parse(raw))
  } catch {
    return null
  }
}

function boardExperiencePluginData(
  page: SceneNode,
  document: BoardExperienceDocument | null
): SceneNode['pluginData'] {
  const retained = page.pluginData.filter(
    (entry) =>
      entry.pluginId !== BOARD_EXPERIENCE_PLUGIN_ID || entry.key !== BOARD_EXPERIENCE_DOCUMENT_KEY
  )
  if (!document) return retained
  return [
    ...retained,
    {
      key: BOARD_EXPERIENCE_DOCUMENT_KEY,
      pluginId: BOARD_EXPERIENCE_PLUGIN_ID,
      value: JSON.stringify(document)
    }
  ]
}

function sessionKey(pageId: string, document: BoardExperienceDocument): string {
  return `${pageId}:${JSON.stringify(document)}`
}

function experienceOwner(
  pageId: string,
  document: BoardExperienceDocument,
  origin: BoardExperiencePoint
): BoardPermissionDescriptor {
  const actorId = `board-experience:${pageId}:${document.definitionId}`
  return {
    actorId,
    defaultOrigin: {
      height: 0,
      width: 0,
      x: origin.x,
      y: origin.y
    },
    labels: {
      create: 'Place Board Experience shape',
      delete: 'Delete Board Experience shape',
      update: 'Update Board Experience shape'
    },
    marker: {
      key: BOARD_EXPERIENCE_OWNER_KEY,
      pluginId: BOARD_EXPERIENCE_PLUGIN_ID,
      value: actorId
    },
    maxComponents: 96,
    name: document.definitionId,
    pageId,
    permissions: [
      'component.create',
      'component.delete',
      'component.update.geometry',
      'component.update.state'
    ]
  }
}

function removeInactiveExperienceTransients(store: EditorStore, pageId: string) {
  removeTransientBoardComponentsByMarker(store, {
    marker: {
      key: BOARD_EXPERIENCE_OWNER_KEY,
      pluginId: BOARD_EXPERIENCE_PLUGIN_ID,
      value: `board-experience:${pageId}:tower-defense`
    },
    pageId
  })
}

function disposeSession(store: EditorStore) {
  const current = sessions.get(store)
  if (!current) return
  sessions.delete(store)
  try {
    current.session.runtime.dispose()
  } finally {
    current.components.dispose()
  }
}

export function syncBoardExperience(store: EditorStore): BoardExperienceSession | null {
  if (constructing.has(store)) return sessions.get(store)?.session ?? null
  const page = store.graph.getNode(store.state.currentPageId)
  const document = boardExperienceDocument(page ?? null)
  if (!page || !document) {
    constructing.add(store)
    try {
      disposeSession(store)
      if (page) removeInactiveExperienceTransients(store, page.id)
    } finally {
      constructing.delete(store)
    }
    return null
  }
  const definition = boardExperienceDefinition(document.definitionId)
  if (!definition) {
    disposeSession(store)
    return null
  }
  const key = sessionKey(page.id, document)
  const current = sessions.get(store)
  if (current?.key === key) return current.session
  disposeSession(store)

  const origin = definition.resolveOrigin(document.settings)
  const components = createBoardComponentSession(store, experienceOwner(page.id, document, origin))
  if (!components) return null
  constructing.add(store)
  let runtime: BoardExperienceSession['runtime']
  try {
    runtime = definition.createRuntime({
      board: () => components.board,
      deactivate: () => {
        deactivateBoardExperience(store)
      },
      invalidate: () => emitChange(store),
      origin,
      pageId: page.id
    })
  } catch (error) {
    components.dispose()
    throw error
  } finally {
    constructing.delete(store)
  }
  const session: BoardExperienceSession = {
    definition,
    document,
    pageId: page.id,
    runtime
  }
  sessions.set(store, { components, key, session })
  return session
}

export function activateBoardExperience(
  store: EditorStore,
  definitionId: BoardExperienceId
): BoardExperienceSession | null {
  const page = store.graph.getNode(store.state.currentPageId)
  const definition = boardExperienceDefinition(definitionId)
  if (page?.type !== 'CANVAS' || !definition) return null
  const center =
    typeof document === 'undefined'
      ? store.screenToCanvas(0, 0)
      : (() => {
          const canvasCenter = store.viewportCanvasCenter()
          return store.screenToCanvas(canvasCenter.x, canvasCenter.y)
        })()
  const experienceDocument: BoardExperienceDocument = {
    definitionId,
    schemaVersion: BOARD_EXPERIENCE_SCHEMA_VERSION,
    settings: definition.createSettings(center)
  }
  let session: BoardExperienceSession | null = null
  store.undo.runBatch(`Activate ${definition.label}`, () => {
    const current = boardExperienceDocument(page)
    if (JSON.stringify(current) !== JSON.stringify(experienceDocument)) {
      store.updateNodeWithUndo(
        page.id,
        { pluginData: boardExperiencePluginData(page, experienceDocument) },
        `Activate ${definition.label}`
      )
    }
    disposeSession(store)
    session = syncBoardExperience(store)
  })
  emitChange(store)
  return session
}

export function deactivateBoardExperience(store: EditorStore): boolean {
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page || !boardExperienceDocument(page)) return false
  store.updateNodeWithUndo(
    page.id,
    { pluginData: boardExperiencePluginData(page, null) },
    'Exit Board Experience'
  )
  disposeSession(store)
  emitChange(store)
  return true
}

export function boardExperienceSnapshot(store: EditorStore): BoardExperienceSnapshot | null {
  return syncBoardExperience(store)?.runtime.getSnapshot() ?? null
}

export function tickBoardExperience(store: EditorStore, elapsedMs: number) {
  syncBoardExperience(store)?.runtime.tick(elapsedMs)
}

export function subscribeBoardExperience(store: EditorStore, listener: () => void): () => void {
  const storeListeners = listeners.get(store) ?? new Set<() => void>()
  storeListeners.add(listener)
  listeners.set(store, storeListeners)
  return () => {
    storeListeners.delete(listener)
    if (storeListeners.size === 0) listeners.delete(store)
  }
}

export function disposeBoardExperience(store: EditorStore) {
  disposeSession(store)
  listeners.delete(store)
}
