import { getActiveEditorStoreOrNull } from '@/app/editor/active-store'

import { resetNarratedTraceAnnotations, setNarratedTraceAnnotationTool } from './annotation'
import { narratedTraceScopeForStore } from './scope'
import {
  beginNarratedTraceSession,
  continueNarratedTraceRecord,
  finishNarratedTraceSession,
  narratedTraceStatus,
  pauseNarratedTraceSession,
  resumeNarratedTraceSession,
  setNarratedTraceError
} from './state'

function currentScope() {
  const store = getActiveEditorStoreOrNull()
  return store ? narratedTraceScopeForStore(store) : undefined
}

export function startNarratedTraceRecording() {
  startNarratedTraceActionRecording()
  return true
}

export function startNarratedTraceActionRecording() {
  resetNarratedTraceAnnotations()
  beginNarratedTraceSession(currentScope())
}

export function pauseNarratedTraceRecording() {
  pauseNarratedTraceSession()
}

export function resumeNarratedTraceRecording() {
  resumeNarratedTraceSession()
}

export async function continueNarratedTraceRecording(sessionId: string) {
  resetNarratedTraceAnnotations()
  const resumed = await continueNarratedTraceRecord(sessionId)
  if (!resumed) return false
  return true
}

export function stopNarratedTraceRecording() {
  setNarratedTraceAnnotationTool('none')
  setNarratedTraceError(null)
  finishNarratedTraceSession()
}

export function toggleNarratedTraceRecording() {
  const isActive =
    narratedTraceStatus.value === 'recording' || narratedTraceStatus.value === 'paused'
  if (isActive) {
    stopNarratedTraceRecording()
    return 'stopped' as const
  }
  startNarratedTraceRecording()
  return 'started' as const
}
