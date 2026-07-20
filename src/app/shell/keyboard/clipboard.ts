import { useEventListener } from '@vueuse/core'

import type { EditorStore } from '@/app/editor/active-store'
import {
  copySelectionToTauriClipboard,
  pasteFromTauriClipboard
} from '@/app/editor/clipboard/system'
import { extractMediaEvidenceFilesFromClipboard } from '@/app/media-evidence/drop'
import { placeMediaEvidenceFiles } from '@/app/media-evidence/intake'
import { isEditing } from '@/app/shell/keyboard/focus'
import { toast } from '@/app/shell/ui'
import { parseSmylrLiveContainerClipboardText } from '@/app/smylr-live-container'
import {
  liveInspectorDocument,
  liveInspectorClipboardHtmlFor,
  selectedLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import { removeWorkspaceItemsForSelectedLiveFrames } from '@/app/smylr-production/live-frame-deletion'
import {
  findCurrentSmylrLiveAppFrame,
  isSmylrLiveAppFrameNode
} from '@/app/smylr-production/workspace'
import { isTauri } from '@/app/tauri/env'

function cursorPosition(store: EditorStore) {
  const { cursorCanvasX: ccx, cursorCanvasY: ccy } = store.state
  return ccx != null && ccy != null ? { x: ccx, y: ccy } : undefined
}

/** Prefer pasting beside the live frame when the cursor sits on top of it. */
function pastePosition(store: EditorStore) {
  const cursor = cursorPosition(store)
  const liveFrame = findCurrentSmylrLiveAppFrame(store)
  if (!liveFrame) return cursor
  if (!cursor) {
    return {
      x: liveFrame.x + liveFrame.width + 48,
      y: liveFrame.y + liveFrame.height / 2
    }
  }
  const insideFrame =
    cursor.x >= liveFrame.x &&
    cursor.x <= liveFrame.x + liveFrame.width &&
    cursor.y >= liveFrame.y &&
    cursor.y <= liveFrame.y + liveFrame.height
  if (!insideFrame) return cursor
  return {
    x: liveFrame.x + liveFrame.width + 48,
    y: cursor.y
  }
}

function writeLiveInspectorCopy(event: ClipboardEvent) {
  const document = liveInspectorDocument.value
  const selectedNode = selectedLiveInspectorNode.value
  if (!document || !selectedNode) return false

  const html = liveInspectorClipboardHtmlFor(selectedNode.id)
  if (!html) return false
  if (event.clipboardData) {
    event.clipboardData.setData('text/html', html)
    event.clipboardData.setData('text/plain', selectedNode.label)
    return true
  }

  try {
    void navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([selectedNode.label], { type: 'text/plain' })
      })
    ])
    return true
  } catch {
    return false
  }
}

export function bindEditorClipboard(store: EditorStore) {
  useEventListener(window, 'copy', (e: ClipboardEvent) => {
    if (isEditing(e)) return
    const hasNativeSelection = [...store.state.selectedIds].some((id) => {
      const node = store.graph.getNode(id)
      return Boolean(node && !isSmylrLiveAppFrameNode(node))
    })
    // Standard Cmd+C for the live selection (not only SMYLR_CONTAINER tool).
    if (!hasNativeSelection && selectedLiveInspectorNode.value) {
      e.preventDefault()
      const copied = writeLiveInspectorCopy(e)
      toast.info(copied ? 'Container copied' : 'Select a live container first')
      return
    }
    e.preventDefault()
    if (isTauri()) {
      void copySelectionToTauriClipboard(store)
      return
    }
    if (e.clipboardData) void store.writeCopyData(e.clipboardData)
  })

  useEventListener(window, 'cut', (e: ClipboardEvent) => {
    if (isEditing(e)) return
    e.preventDefault()
    if (isTauri()) {
      void copySelectionToTauriClipboard(store).then((copied) => {
        if (copied) {
          removeWorkspaceItemsForSelectedLiveFrames(store)
          store.deleteSelected()
        }
        return undefined
      })
      return
    }
    if (e.clipboardData) void store.writeCopyData(e.clipboardData)
    removeWorkspaceItemsForSelectedLiveFrames(store)
    store.deleteSelected()
  })

  useEventListener(window, 'paste', (e: ClipboardEvent) => {
    if (isEditing(e)) return
    e.preventDefault()

    const cursorPos = pastePosition(store)
    const text = e.clipboardData?.getData('text/plain') ?? ''
    try {
      const smylrDocument = parseSmylrLiveContainerClipboardText(text)
      if (smylrDocument) {
        void store.openSmylrLiveContainerDocument(smylrDocument)
        return
      }
    } catch (error) {
      console.warn('[Smylr Container]', error)
      return
    }

    const mediaFiles = extractMediaEvidenceFilesFromClipboard(e)
    if (mediaFiles.length) {
      const cx = cursorPos?.x ?? (-store.state.panX + window.innerWidth / 2) / store.state.zoom
      const cy = cursorPos?.y ?? (-store.state.panY + window.innerHeight / 2) / store.state.zoom
      void placeMediaEvidenceFiles(store, mediaFiles, cx, cy)
      return
    }

    const html = e.clipboardData?.getData('text/html') ?? ''
    if (html) {
      void store.pasteFromHTML(html, cursorPos)
      return
    }

    if (isTauri()) void pasteFromTauriClipboard(store, cursorPos)
  })
}
