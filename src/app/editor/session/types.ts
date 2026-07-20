import { createDefaultEditorState, type EditorState } from '@open-pencil/core/editor'

import type { NodeEditState } from '@/app/editor/vector-edit/types'
import type { SmylrLiveContainerDocument } from '@/app/smylr-live-container/types'

export function createInitialAppEditorState(pageId: string): AppEditorState {
  return {
    ...createDefaultEditorState(pageId),
    showUI: true,
    showRulers: false,
    showRemoteCursors: true,
    activeRibbonTab: 'panels',
    panelMode: 'design',
    actionToast: null,
    mobileDrawerSnap: 'closed',
    clipboardHtml: '',
    autosaveEnabled: false,
    smylrLiveContainer: null,
    cursorCanvasX: null,
    cursorCanvasY: null,
    nodeEditState: null,
    scrubInputFocused: false
  }
}

export type AppEditorState = EditorState & {
  showUI: boolean
  showRulers: boolean
  showRemoteCursors: boolean
  activeRibbonTab: 'panels' | 'code' | 'ai'
  panelMode: 'layers' | 'design'
  actionToast: string | null
  mobileDrawerSnap: 'closed' | 'half' | 'full'
  clipboardHtml: string
  autosaveEnabled: boolean
  smylrLiveContainer: SmylrLiveContainerDocument | null
  cursorCanvasX: number | null
  cursorCanvasY: number | null
  nodeEditState: NodeEditState | null
  scrubInputFocused: boolean
}
