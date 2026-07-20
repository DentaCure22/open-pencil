import { resetNarratedTraceAnnotations, setNarratedTraceAnnotationTool } from './annotation'
import {
  checkNarratedTraceSpeechAvailability,
  startNarratedTraceSpeech,
  stopNarratedTraceSpeech
} from './speech'
import {
  beginNarratedTraceSession,
  continueNarratedTraceRecord,
  finishNarratedTraceSession,
  pauseNarratedTraceSession,
  resumeNarratedTraceSession,
  setNarratedTraceError
} from './state'

export function startNarratedTraceRecording() {
  const speechReady = checkNarratedTraceSpeechAvailability()
  if (!speechReady) return false
  resetNarratedTraceAnnotations()
  beginNarratedTraceSession()
  startNarratedTraceSpeech()
  return true
}

export function startNarratedTraceActionRecording() {
  resetNarratedTraceAnnotations()
  beginNarratedTraceSession()
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
