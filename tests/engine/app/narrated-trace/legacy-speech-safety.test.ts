import { afterEach, describe, expect, test } from 'bun:test'

import {
  pauseNarratedTraceRecording,
  resumeNarratedTraceRecording,
  startNarratedTraceRecording,
  stopNarratedTraceRecording
} from '@/app/narrated-trace/controller'
import {
  checkNarratedTraceSpeechAvailability,
  narratedTraceSpeechAvailability,
  startNarratedTraceSpeech
} from '@/app/narrated-trace/speech'
import { narratedTraceSession, narratedTraceStatus } from '@/app/narrated-trace/state'

afterEach(() => {
  stopNarratedTraceRecording()
  narratedTraceSession.value = null
  narratedTraceStatus.value = 'idle'
})

describe('Narrated Trace legacy speech safety', () => {
  test('keeps legacy recording controls action-only', () => {
    expect(startNarratedTraceRecording()).toBe(true)
    expect(narratedTraceStatus.value).toBe('recording')
    expect(narratedTraceSession.value?.events).toEqual([])

    pauseNarratedTraceRecording()
    expect(narratedTraceStatus.value).toBe('paused')
    resumeNarratedTraceRecording()
    expect(narratedTraceStatus.value).toBe('recording')
    expect(narratedTraceSession.value?.events).toEqual([])
  })

  test('keeps the deprecated speech compatibility shim fail-closed', async () => {
    const [controller, index, speech] = await Promise.all([
      Bun.file('src/app/narrated-trace/controller.ts').text(),
      Bun.file('src/app/narrated-trace/index.ts').text(),
      Bun.file('src/app/narrated-trace/speech.ts').text()
    ])

    expect(checkNarratedTraceSpeechAvailability()).toBe(false)
    expect(startNarratedTraceSpeech()).toBe(false)
    expect(narratedTraceSpeechAvailability.value).toBe('unavailable')
    expect(controller).not.toContain('startNarratedTraceSpeech')
    expect(index).not.toContain("export * from './speech'")
    expect(speech).not.toContain('SpeechRecognition')
    expect(speech).not.toContain('getUserMedia')
    expect(speech).not.toContain('appendNarratedTraceEvent')
  })
})
