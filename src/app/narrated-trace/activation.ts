import type { EditorStore } from '@/app/editor/session'

import {
  narratedTraceAnnotationTool,
  resetNarratedTraceAnnotationState,
  setNarratedTraceAnnotationToolState
} from './annotation'
import type { NarratedTraceActiveAnnotationTool, NarratedTraceAnnotationTool } from './annotation'
import {
  narratedTraceMicPhase,
  narratedTraceMicPinned,
  startNarratedTraceMic,
  stopNarratedTraceMic
} from './mic'

export function setNarratedTraceAnnotationTool(tool: NarratedTraceAnnotationTool) {
  // A pinned mic belongs to the user, not to the Focus tool: leaving Focus must not silence it.
  if (
    narratedTraceAnnotationTool.value === 'focus' &&
    tool !== 'focus' &&
    !narratedTraceMicPinned.value
  ) {
    stopNarratedTraceMic()
  }
  setNarratedTraceAnnotationToolState(tool)
}

export async function activateNarratedTraceAnnotationTool(
  store: EditorStore,
  tool: NarratedTraceActiveAnnotationTool
) {
  if (tool === 'ink') store.setTool('SELECT')
  setNarratedTraceAnnotationTool(tool)
  if (tool !== 'focus' || narratedTraceMicPhase.value === 'listening') return true
  return startNarratedTraceMic(store)
}

/** Pins the mic on for continuous recording, or unpins and stops it (unless Focus still needs it). */
export async function toggleNarratedTraceMicPinned(store: EditorStore) {
  if (narratedTraceMicPinned.value) {
    narratedTraceMicPinned.value = false
    if (narratedTraceAnnotationTool.value !== 'focus') stopNarratedTraceMic()
    return true
  }
  narratedTraceMicPinned.value = true
  const started =
    narratedTraceMicPhase.value === 'listening' ? true : await startNarratedTraceMic(store)
  if (!started) narratedTraceMicPinned.value = false
  return started
}

export function resetNarratedTraceAnnotations() {
  if (narratedTraceAnnotationTool.value === 'focus' && !narratedTraceMicPinned.value) {
    stopNarratedTraceMic()
  }
  resetNarratedTraceAnnotationState()
}
