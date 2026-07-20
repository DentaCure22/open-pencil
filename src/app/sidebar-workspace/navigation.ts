import type { ViewportInsets } from '@open-pencil/core/editor'

import type { EditorStore } from '@/app/editor/session'
import { visibleElementRect } from '@/app/editor/viewport-insets'
import {
  isSmylrFlowPageNode,
  isSmylrLiveAppFrameNode,
  smylrLiveAppFrameState
} from '@/app/smylr-production/workspace'

const VIEWPORT_SAFE_GAP = 14

/** Describe the canvas area that remains readable around floating editor chrome. */
export function sidebarWorkspaceViewportInsets(): ViewportInsets {
  const canvas = visibleElementRect('[data-test-id="canvas-area"]')
  if (!canvas) return {}

  const leftPanel =
    visibleElementRect('[data-test-id="layers-shell"]') ??
    visibleElementRect('[data-test-id="layers-panel"]')
  const rightPanel = visibleElementRect('[data-test-id="properties-panel"]')
  const toolbar = visibleElementRect('[data-test-id="toolbar"]')
  const boardDock = visibleElementRect('[data-test-id="board-dock"]')
  const mobileDrawer = visibleElementRect('[data-test-id="mobile-drawer"]')
  const canvasCenterX = canvas.left + canvas.width / 2
  const propertiesOnRight = rightPanel && rightPanel.left >= canvasCenterX ? rightPanel : null
  let bottom = VIEWPORT_SAFE_GAP
  if (mobileDrawer) {
    bottom = Math.max(VIEWPORT_SAFE_GAP, canvas.bottom - mobileDrawer.top + VIEWPORT_SAFE_GAP)
  } else if (boardDock) {
    bottom = Math.max(VIEWPORT_SAFE_GAP, canvas.bottom - boardDock.top + VIEWPORT_SAFE_GAP)
  }

  return {
    bottom,
    left: leftPanel
      ? Math.max(VIEWPORT_SAFE_GAP, leftPanel.right - canvas.left + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP,
    right: propertiesOnRight
      ? Math.max(VIEWPORT_SAFE_GAP, canvas.right - propertiesOnRight.left + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP,
    top: toolbar
      ? Math.max(VIEWPORT_SAFE_GAP, toolbar.bottom - canvas.top + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP
  }
}

function primaryBoardTileId(store: EditorStore, pageId: string): string | undefined {
  if (isSmylrFlowPageNode(store.graph.getNode(pageId))) return undefined
  const frames = store.graph.getChildren(pageId).filter(isSmylrLiveAppFrameNode)
  return frames.find((node) => smylrLiveAppFrameState(node) === 'current')?.id ?? frames[0]?.id
}

/** First visit focuses the primary tile; later visits keep focal point and zoom. */
export async function switchSidebarWorkspaceBoard(store: EditorStore, pageId: string) {
  await store.switchPage(pageId, {
    fitNodeIdOnFirstVisit: primaryBoardTileId(store, pageId),
    fitOnFirstVisit: true,
    viewportInsets: sidebarWorkspaceViewportInsets()
  })
}
