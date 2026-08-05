import { useEventListener } from '@vueuse/core'

import type { EditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import type { ObjectGraphNavigationDirection } from '@/app/object-graph/navigation'
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

function navigateObjectGraph(store: EditorStore, code: string): boolean {
  const direction = GRAPH_NAVIGATION_DIRECTIONS[code]
  return direction
    ? store.objectGraphNavigation.navigateSelectedNodeInDirection(direction, editorViewportInsets())
    : false
}

function hasPrimaryModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}

function navigateObjectGraphWithPrimaryModifier(store: EditorStore, event: KeyboardEvent): boolean {
  return (
    hasPrimaryModifier(event) &&
    !event.altKey &&
    !event.shiftKey &&
    navigateObjectGraph(store, event.code)
  )
}

function navigateArrowSelection(
  store: EditorStore,
  event: KeyboardEvent,
  direction: ObjectGraphNavigationDirection
): boolean {
  if (event.shiftKey) return false
  return (
    store.objectGraphNavigation.navigateSelectionInDirection(direction, editorViewportInsets()) ||
    store.containerNavigation.navigateInDirection(direction)
  )
}

function handleNudgeKey(store: EditorStore, event: KeyboardEvent): void {
  if (isEditing(event) || store.state.editingTextId) return
  if (isReservedModShortcut(event)) event.preventDefault()

  const delta = NUDGE_DELTAS[event.code]
  if (!delta) return

  if (navigateObjectGraphWithPrimaryModifier(store, event)) {
    event.preventDefault()
    return
  }

  if (hasPrimaryModifier(event) || event.altKey) return
  const direction = GRAPH_NAVIGATION_DIRECTIONS[event.code]
  if (direction && navigateArrowSelection(store, event, direction)) {
    event.preventDefault()
    return
  }

  if (store.state.selectedIds.size === 0) return
  const step = event.shiftKey ? 10 : 1
  store.nudgeSelected(delta[0] * step, delta[1] * step)
  event.preventDefault()
}

export function bindNudgeKeys(store: EditorStore, enabled: () => boolean = () => true) {
  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (!enabled()) return
    handleNudgeKey(store, event)
  })
}
