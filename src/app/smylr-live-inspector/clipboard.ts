import type { EditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import { liveInspectorNodeOuterHtml } from '@/app/smylr-live-inspector/outer-html'
import {
  enterLiveInspectorContainerSelection,
  liveInspectorActiveFrameId,
  liveInspectorInteractionMode,
  selectedLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'
import { writeTauriClipboardText } from '@/app/tauri/clipboard'

async function writeBrowserClipboardText(text: string) {
  await navigator.clipboard.writeText(text)
  return true
}

async function copySelectedLiveContainer() {
  const outerHtml = liveInspectorNodeOuterHtml(selectedLiveInspectorNode.value)
  if (!outerHtml) {
    toast.info('Select a container to copy')
    return true
  }

  try {
    const copied =
      (await writeTauriClipboardText(outerHtml)) || (await writeBrowserClipboardText(outerHtml))
    if (!copied) throw new Error('Clipboard unavailable')
    toast.info('Container outerHTML copied')
  } catch {
    toast.error('Could not copy container outerHTML')
  }
  return true
}

function selectedLiveAppFrameId(store: EditorStore) {
  if (store.state.selectedIds.size !== 1) return null
  const [selectedId] = store.state.selectedIds
  const selected = selectedId ? store.graph.getNode(selectedId) : null
  return selectedId && isSmylrProductionAppCodeObjectFrame(selected) ? selectedId : null
}

export function isLiveContainerCopyContext(store: EditorStore) {
  return selectedLiveAppFrameId(store) !== null
}

export async function handleLiveContainerCopyCommand(store: EditorStore) {
  const selectedId = selectedLiveAppFrameId(store)
  if (!selectedId) return false

  if (
    liveInspectorActiveFrameId.value === selectedId &&
    liveInspectorInteractionMode.value === 'select'
  ) {
    return copySelectedLiveContainer()
  }

  enterLiveInspectorContainerSelection(selectedId)
  return true
}
