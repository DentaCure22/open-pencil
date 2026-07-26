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
export const narratedTraceVoiceLevel = ref(0)

let recognition: SpeechRecognition | null = null
let restartRecognition = false
let restartTimer: ReturnType<typeof setTimeout> | null = null
let voiceAnalyser: AnalyserNode | null = null
let voiceContext: AudioContext | null = null
let voiceFrame = 0
let voiceMonitorToken = 0
let voiceSource: MediaStreamAudioSourceNode | null = null
let voiceStream: MediaStream | null = null

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
      const transcript = result[0].transcript.trim()
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

function stopNarratedTraceVoiceMonitor() {
  voiceMonitorToken += 1
  cancelAnimationFrame(voiceFrame)
  voiceFrame = 0
  voiceSource?.disconnect()
  voiceAnalyser?.disconnect()
  for (const track of voiceStream?.getTracks() ?? []) track.stop()
  if (voiceContext) void voiceContext.close().catch(() => undefined)
  voiceAnalyser = null
  voiceContext = null
  voiceSource = null
  voiceStream = null
  narratedTraceVoiceLevel.value = 0
}

async function startNarratedTraceVoiceMonitor() {
  stopNarratedTraceVoiceMonitor()
  if (typeof AudioContext === 'undefined') return
  const mediaDevices = navigator.mediaDevices

  const token = ++voiceMonitorToken
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      }
    })
    if (token !== voiceMonitorToken || narratedTraceStatus.value !== 'recording') {
      for (const track of stream.getTracks()) track.stop()
      return
    }

    const context = new AudioContext()
    const analyser = context.createAnalyser()
    const source = context.createMediaStreamSource(stream)
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.72
    source.connect(analyser)
    try {
      await context.resume()
    } catch (error) {
      source.disconnect()
      analyser.disconnect()
      for (const track of stream.getTracks()) track.stop()
      void context.close().catch(() => undefined)
      throw error
    }

    voiceStream = stream
    voiceContext = context
    voiceAnalyser = analyser
    voiceSource = source

    const samples = new Uint8Array(analyser.fftSize)
    let lastPublishedAt = 0
    let smoothedLevel = 0
    const sampleVoice = (timestamp: number) => {
      if (token !== voiceMonitorToken || narratedTraceStatus.value !== 'recording') return
      analyser.getByteTimeDomainData(samples)
      let sumSquares = 0
      for (const sample of samples) {
        const centered = (sample - 128) / 128
        sumSquares += centered * centered
      }
      const rms = Math.sqrt(sumSquares / samples.length)
      const normalized = Math.min(1, Math.max(0, (rms - 0.024) * 5.6))
      const easedLevel = normalized * normalized * (3 - 2 * normalized)
      const response = easedLevel > smoothedLevel ? 0.14 : 0.03
      smoothedLevel += (easedLevel - smoothedLevel) * response
      if (
        timestamp - lastPublishedAt >= 60 &&
        Math.abs(narratedTraceVoiceLevel.value - smoothedLevel) >= 0.01
      ) {
        narratedTraceVoiceLevel.value = Math.round(smoothedLevel * 1000) / 1000
        lastPublishedAt = timestamp
      }
      voiceFrame = requestAnimationFrame(sampleVoice)
    }
    voiceFrame = requestAnimationFrame(sampleVoice)
  } catch {
    if (token === voiceMonitorToken) narratedTraceVoiceLevel.value = 0
  }
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
    void startNarratedTraceVoiceMonitor()
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
  stopNarratedTraceVoiceMonitor()
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
