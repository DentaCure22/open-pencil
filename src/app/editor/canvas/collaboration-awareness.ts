import { tryOnScopeDispose } from '@vueuse/core'

import type { useCollabInjected } from '@/app/collab/use'
import type { EditorStore } from '@/app/editor/active-store'

type Collaboration =
  | Pick<NonNullable<ReturnType<typeof useCollabInjected>>, 'updateCursor' | 'updateSelection'>
  | undefined

export function useCanvasCollaborationAwareness(store: EditorStore, collab: Collaboration) {
  let cursorFrameId: number | null = null
  let pendingCursor: { x: number; y: number; pageId: string } | null = null

  function flushCursor() {
    cursorFrameId = null
    const cursor = pendingCursor
    pendingCursor = null
    if (cursor) collab?.updateCursor(cursor.x, cursor.y, cursor.pageId)
  }

  function updateCursor(cx: number, cy: number) {
    store.state.cursorCanvasX = cx
    store.state.cursorCanvasY = cy
    if (!collab) return
    pendingCursor = { x: cx, y: cy, pageId: store.state.currentPageId }
    if (cursorFrameId !== null) return
    cursorFrameId = requestAnimationFrame(flushCursor)
  }

  const stopSelectionListener = store.onEditorEvent('selection:changed', (ids) =>
    collab?.updateSelection(ids)
  )
  tryOnScopeDispose(() => {
    stopSelectionListener()
    if (cursorFrameId !== null) cancelAnimationFrame(cursorFrameId)
  })

  return { updateCursor }
}
