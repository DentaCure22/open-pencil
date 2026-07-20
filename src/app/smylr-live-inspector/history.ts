import type { EditorStore } from '@/app/editor/active-store'

import {
  liveWorkspaceItemsForSync,
  replaceLiveWorkspaceItemsFromSync,
  type LiveWorkspaceItem
} from './workspace'

function restoreLiveWorkspaceHistoryState(store: EditorStore, items: LiveWorkspaceItem[]) {
  replaceLiveWorkspaceItemsFromSync(items)
  store.requestRender()
}

export function runLiveWorkspaceMutationWithUndo<T>(
  store: EditorStore,
  label: string,
  mutation: () => T
): T {
  const before = liveWorkspaceItemsForSync()
  const result = mutation()
  const after = liveWorkspaceItemsForSync()
  if (JSON.stringify(before) === JSON.stringify(after)) return result
  store.pushUndoEntry({
    forward: () => restoreLiveWorkspaceHistoryState(store, after),
    inverse: () => restoreLiveWorkspaceHistoryState(store, before),
    label
  })
  return result
}
