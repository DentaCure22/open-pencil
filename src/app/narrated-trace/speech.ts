import { ref } from 'vue'

import {
  appendNarratedTraceEvent,
  narratedTraceStatus,
  setNarratedTraceError,
  setNarratedTraceInterimText
} from './state'

const TRACE_LANGUAGE = 'en-US'

export type NarratedTraceSpeechAvailability = 'unknown' | 'ready' | 'unavailable'

export const narratedTraceSpeechAvailability = ref<NarratedTraceSpeechAvailability>('unknown')

let recognition: SpeechRecognition | null = null
let restartRecognition = false
let restartTimer: ReturnType<typeof setTimeout> | null = null

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (!IS_BROWSER) return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function checkNarratedTraceSpeechAvailability(): boolean {
  const constructor = recognitionConstructor()
  if (!constructor) {
    narratedTraceSpeechAvailability.value = 'unavailable'
    return false
  }
  narratedTraceSpeechAvailability.value = 'ready'
  return true
}

function createRecognition(constructor: SpeechRecognitionConstructor): SpeechRecognition {
  const next = new constructor()
  next.continuous = true
  next.interimResults = true
  next.lang = TRACE_LANGUAGE
  next.maxAlternatives = 1
  if ('processLocally' in next) next.processLocally = false

  next.onresult = (event) => {
    const interim: string[] = []
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const transcript = result?.[0]?.transcript.trim()
      if (!transcript) continue
      if (result.isFinal) {
        appendNarratedTraceEvent(
          {
            kind: 'transcript',
            label: transcript,
            text: transcript
          },
          {
            coalesceKey: 'transcript',
            coalesceWindowMs: 5000,
            mergeText: true
          }
        )
      } else {
        interim.push(transcript)
      }
    }
    setNarratedTraceInterimText(interim.join(' '))
  }

  next.onerror = (event) => {
    const permissionError = event.error === 'not-allowed' || event.error === 'service-not-allowed'
    if (permissionError) restartRecognition = false
    setNarratedTraceError(
      permissionError
        ? 'Microphone access is blocked. Allow it for this site, then pause and resume.'
        : `Transcription paused: ${event.message || event.error}`
    )
  }

  next.onend = () => {
    if (!restartRecognition || narratedTraceStatus.value !== 'recording') return
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = null
      try {
        recognition?.start()
      } catch {
        setNarratedTraceError('Transcription could not restart.')
      }
    }, 150)
  }

  return next
}

export function startNarratedTraceSpeech() {
  const constructor = recognitionConstructor()
  if (!constructor) {
    setNarratedTraceError('Speech recognition is unavailable in this browser.')
    return false
  }

  try {
    recognition ??= createRecognition(constructor)
    restartRecognition = true
    recognition.start()
    setNarratedTraceError(null)
    return true
  } catch (error) {
    restartRecognition = false
    setNarratedTraceError(error instanceof Error ? error.message : 'Transcription could not start.')
    return false
  }
}

export function stopNarratedTraceSpeech() {
  restartRecognition = false
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = null
  setNarratedTraceInterimText('')
  try {
    recognition?.stop()
  } catch {
    recognition?.abort()
  }
}
import { IS_BROWSER } from '@open-pencil/core/constants'
