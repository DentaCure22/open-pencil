import { useEventListener } from '@vueuse/core'

import { isCodeObjectFrame } from '@/app/code-object/model'
import type { EditorStore } from '@/app/editor/active-store'
import {
  connectedObjectGraphNodeInDirection,
  type ObjectGraphNavigationDirection
} from '@/app/object-graph/navigation'
import { isEditing } from '@/app/shell/keyboard/focus'
import { isReservedModShortcut } from '@/app/shell/keyboard/reserved'

const NUDGE_DELTAS: Partial<Record<string, [number, number]>> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0]
}

const GRAPH_NAVIGATION_DIRECTIONS: Partial<Record<string, ObjectGraphNavigationDirection>> = {
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up'
}

function navigateConnectedCodeObject(store: EditorStore, code: string): boolean {
  if (store.state.selectedIds.size !== 1) return false
  const selectedId = store.state.selectedIds.values().next().value
  const selected = typeof selectedId === 'string' ? store.graph.getNode(selectedId) : null
  const direction = GRAPH_NAVIGATION_DIRECTIONS[code]
  if (!direction || !isCodeObjectFrame(selected)) return false
  const targetId = connectedObjectGraphNodeInDirection(
    store.graph,
    store.state.currentPageId,
    selected.id,
    direction
  )
  if (!targetId) return false
  store.select([targetId])
  return true
}

export function bindNudgeKeys(store: EditorStore) {
  useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (isEditing(e) || store.state.editingTextId) return
    if (isReservedModShortcut(e)) e.preventDefault()
    if (e.metaKey || e.ctrlKey || e.altKey) return

    const delta = NUDGE_DELTAS[e.code]
    if (!delta || store.state.selectedIds.size === 0) return

    if (e.shiftKey && navigateConnectedCodeObject(store, e.code)) {
      e.preventDefault()
      return
    }

    const step = e.shiftKey ? 10 : 1
    store.nudgeSelected(delta[0] * step, delta[1] * step)
    e.preventDefault()
  })
}
