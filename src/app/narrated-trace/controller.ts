import { getActiveEditorStoreOrNull } from '@/app/editor/active-store'

import { resetNarratedTraceAnnotations, setNarratedTraceAnnotationTool } from './annotation'
import { narratedTraceScopeForStore } from './scope'
import {
  checkNarratedTraceSpeechAvailability,
  startNarratedTraceSpeech,
  stopNarratedTraceSpeech
} from './speech'
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
  const speechReady = checkNarratedTraceSpeechAvailability()
  resetNarratedTraceAnnotations()
  beginNarratedTraceSession(currentScope())
  if (speechReady) startNarratedTraceSpeech()
  else
    setNarratedTraceError('Speech recognition is unavailable. Canvas actions are still recording.')
  return true
}

export function startNarratedTraceActionRecording() {
  resetNarratedTraceAnnotations()
  beginNarratedTraceSession(currentScope())
}

export function pauseNarratedTraceRecording() {
  stopNarratedTraceSpeech()
  pauseNarratedTraceSession()
}

export function resumeNarratedTraceRecording() {
  resumeNarratedTraceSession()
  startNarratedTraceSpeech()
}

export async function continueNarratedTraceRecording(sessionId: string) {
  resetNarratedTraceAnnotations()
  const resumed = await continueNarratedTraceRecord(sessionId)
  if (!resumed) return false
  startNarratedTraceSpeech()
  return true
}

export function stopNarratedTraceRecording() {
  setNarratedTraceAnnotationTool('none')
  stopNarratedTraceSpeech()
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
