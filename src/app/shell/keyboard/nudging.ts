import { useEventListener } from '@vueuse/core'

import { activeCodeObjectInteractionFrameId } from '@/app/code-object/interaction'
import type { EditorStore } from '@/app/editor/active-store'
import type { SpatialNavigationDirection } from '@/app/editor/spatial-navigation'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { isEditing } from '@/app/shell/keyboard/focus'
import { isReservedModShortcut } from '@/app/shell/keyboard/reserved'
import {
  liveInspectorInteractionMode,
  selectAdjacentLiveInspectorNode,
  type LiveInspectorNavigationDirection
} from '@/app/smylr-live-inspector/session'

const NUDGE_DELTAS: Partial<Record<string, [number, number]>> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0]
}

const SPATIAL_NAVIGATION_DIRECTIONS: Partial<Record<string, SpatialNavigationDirection>> = {
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up'
}

interface TextControlSpaceSnapshot {
  selectionEnd: number
  selectionStart: number
  target: HTMLInputElement | HTMLTextAreaElement
  value: string
}

function captureTextControlSpace(event: KeyboardEvent): TextControlSpaceSnapshot | null {
  if (event.repeat) return null
  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return null
  if (target.selectionStart === null || target.selectionEnd === null) return null
  return {
    selectionEnd: target.selectionEnd,
    selectionStart: target.selectionStart,
    target,
    value: target.value
  }
}

function restoreTextControlSpace(snapshot: TextControlSpaceSnapshot | null): void {
  if (!snapshot?.target.isConnected) return
  const prototype =
    snapshot.target instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (valueSetter) valueSetter.call(snapshot.target, snapshot.value)
  else snapshot.target.value = snapshot.value
  snapshot.target.dispatchEvent(new Event('input', { bubbles: true }))
  snapshot.target.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd)
}

export function spatialNavigationDirectionForCode(
  code: string
): SpatialNavigationDirection | undefined {
  return SPATIAL_NAVIGATION_DIRECTIONS[code]
}

const LIVE_CONTAINER_NAVIGATION_DIRECTIONS: Partial<
  Record<string, LiveInspectorNavigationDirection>
> = {
  ArrowDown: 'next',
  ArrowLeft: 'parent',
  ArrowRight: 'child',
  ArrowUp: 'previous'
}

function hasPrimaryModifier(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey
}

function navigateLiveContainerSelection(event: KeyboardEvent): boolean {
  if (liveInspectorInteractionMode.value !== 'select') return false
  const direction = LIVE_CONTAINER_NAVIGATION_DIRECTIONS[event.code]
  if (direction && !event.shiftKey) selectAdjacentLiveInspectorNode(direction)
  return true
}

export function navigateArrowSelection(
  store: EditorStore,
  event: KeyboardEvent,
  direction: SpatialNavigationDirection
): boolean {
  if (navigateLiveContainerSelection(event)) return true
  if (event.shiftKey) return false
  return navigateBoardSelection(store, direction)
}

export function navigateBoardSelection(
  store: EditorStore,
  direction: SpatialNavigationDirection
): boolean {
  return (
    store.containerNavigation.navigateInDirection(direction) ||
    store.spatialSelectionNavigation.navigateInDirection(direction, editorViewportInsets())
  )
}

function handleNudgeKey(store: EditorStore, event: KeyboardEvent): void {
  if (isEditing(event) || store.state.editingTextId) return
  if (isReservedModShortcut(event)) event.preventDefault()

  const delta = NUDGE_DELTAS[event.code]
  if (!delta) return

  if (hasPrimaryModifier(event) || event.altKey) return
  const direction = SPATIAL_NAVIGATION_DIRECTIONS[event.code]
  if (direction && activeCodeObjectInteractionFrameId.value) return
  if (direction && navigateArrowSelection(store, event, direction)) {
    event.preventDefault()
    return
  }

  if (direction && !event.shiftKey && store.state.selectedIds.size === 1) {
    event.preventDefault()
    return
  }

  if (store.state.selectedIds.size === 0) return
  const step = event.shiftKey ? 10 : 1
  store.nudgeSelected(delta[0] * step, delta[1] * step)
  event.preventDefault()
}

export function bindNudgeKeys(store: EditorStore, enabled: () => boolean = () => true) {
  let boardNavigationOverrideHeld = false
  let textControlSpaceSnapshot: TextControlSpaceSnapshot | null = null

  useEventListener(
    window,
    'keydown',
    (event: KeyboardEvent) => {
      if (!enabled()) return
      if (event.code === 'Space') {
        const textControlSnapshot = captureTextControlSpace(event)
        if (
          !store.state.editingTextId &&
          (!isEditing(event) || textControlSnapshot) &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.shiftKey
        ) {
          boardNavigationOverrideHeld = true
          textControlSpaceSnapshot = textControlSnapshot
        }
        return
      }

      const direction = spatialNavigationDirectionForCode(event.code)
      if (boardNavigationOverrideHeld && direction && store.state.selectedIds.size === 1) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (event.repeat) return
        restoreTextControlSpace(textControlSpaceSnapshot)
        textControlSpaceSnapshot = null
        navigateBoardSelection(store, direction)
        return
      }

      handleNudgeKey(store, event)
    },
    { capture: true }
  )
  useEventListener(window, 'keyup', (event: KeyboardEvent) => {
    if (event.code !== 'Space') return
    boardNavigationOverrideHeld = false
    textControlSpaceSnapshot = null
  })
  useEventListener(window, 'blur', () => {
    boardNavigationOverrideHeld = false
    textControlSpaceSnapshot = null
  })
}
