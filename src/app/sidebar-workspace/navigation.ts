import type { EditorStore } from '@/app/editor/session'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import {
  isSmylrFlowPageNode,
  isSmylrCodeObjectFrame,
  smylrCodeObjectFrameState
} from '@/app/smylr-production/workspace'

function primaryBoardTileId(store: EditorStore, pageId: string): string | undefined {
  if (isSmylrFlowPageNode(store.graph.getNode(pageId))) return undefined
  const frames = store.graph.getChildren(pageId).filter(isSmylrCodeObjectFrame)
  return frames.find((node) => smylrCodeObjectFrameState(node) === 'current')?.id ?? frames[0]?.id
}

/** First visit focuses the primary tile; later visits keep focal point and zoom. */
export async function switchSidebarWorkspaceBoard(store: EditorStore, pageId: string) {
  await store.switchPage(pageId, {
    fitNodeIdOnFirstVisit: primaryBoardTileId(store, pageId),
    fitOnFirstVisit: true,
    viewportInsets: editorViewportInsets()
  })
}
