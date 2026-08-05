import { IS_BROWSER } from '@open-pencil/core/constants'
import type { Editor, EditorState } from '@open-pencil/core/editor'

import { readSessionCacheText, writeSessionCacheText } from '@/app/cache'

type ReloadViewport = {
  panX: number
  panY: number
  zoom: number
}

export type ReloadStateSnapshot = {
  viewport: ReloadViewport
  pageId: string
}

export type ReloadStateStorage = Pick<Storage, 'getItem' | 'setItem'>

const RELOAD_STATE_PREFIX = 'openpencil:workspace-reload-state:v1'

function reloadStateKey(workspaceId: string) {
  return `${RELOAD_STATE_PREFIX}:${workspaceId}`
}

function browserReloadStateStorage(): ReloadStateStorage | null {
  if (!IS_BROWSER) return null
  return {
    getItem: readSessionCacheText,
    setItem(key, value) {
      writeSessionCacheText(key, value)
    }
  }
}

function parseReloadState(value: unknown): ReloadStateSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ReloadStateSnapshot>
  const viewport = candidate.viewport
  if (
    typeof candidate.pageId !== 'string' ||
    !viewport ||
    !Number.isFinite(viewport.panX) ||
    !Number.isFinite(viewport.panY) ||
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom <= 0
  ) {
    return null
  }
  return {
    pageId: candidate.pageId,
    viewport: {
      panX: viewport.panX,
      panY: viewport.panY,
      zoom: viewport.zoom
    }
  }
}

export function captureReloadState(state: EditorState): ReloadStateSnapshot {
  return {
    viewport: { panX: state.panX, panY: state.panY, zoom: state.zoom },
    pageId: state.currentPageId
  }
}

/**
 * Keep the exact visible Board in tab-scoped synchronous storage. Unlike the
 * full view-memory write, this survives an immediate reload without waiting
 * for an IndexedDB read or a debounce to finish.
 */
export function saveReloadState(
  workspaceId: string,
  state: EditorState,
  storage: ReloadStateStorage | null = browserReloadStateStorage()
): boolean {
  if (!storage) return false
  try {
    storage.setItem(reloadStateKey(workspaceId), JSON.stringify(captureReloadState(state)))
    return true
  } catch {
    return false
  }
}

export function loadReloadState(
  workspaceId: string,
  storage: ReloadStateStorage | null = browserReloadStateStorage()
): ReloadStateSnapshot | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(reloadStateKey(workspaceId))
    return raw ? parseReloadState(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export async function restoreReloadState(
  editor: Editor,
  snapshot: ReloadStateSnapshot
): Promise<void> {
  editor.clearSelection()
  const savedPage = editor.graph.getNode(snapshot.pageId)
  const pageId =
    savedPage?.type === 'CANVAS' && savedPage.parentId === editor.graph.rootId
      ? savedPage.id
      : (editor.graph.getPages()[0]?.id ?? editor.graph.rootId)
  await editor.switchPage(pageId)
  editor.setViewport(snapshot.viewport)
}
