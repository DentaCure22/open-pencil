import { describe, expect, test } from 'bun:test'

import {
  selectSpeechDictationTranscript,
  speechDictationText,
  speechPcm16,
  speechWaveformLevels
} from '@/app/speech-dictation'

const bands = [
  [1, 3],
  [3, 6],
  [6, 12],
  [12, 24],
  [24, 48]
] as const

function frequencies(values: readonly number[]) {
  const result = new Uint8Array(128)
  for (const [index, [start, end]] of bands.entries()) {
    result.fill(values[index] ?? 0, start, end)
  }
  return result
}

describe('speech dictation waveform meter', () => {
  test('replaces the live dictated portion while preserving text that was already in the composer', () => {
    expect(speechDictationText('Keep this draft', 'Open pensil')).toBe(
      'Keep this draft Open pensil'
    )
    expect(speechDictationText('Keep this draft', 'Open Pencil streams live')).toBe(
      'Keep this draft Open Pencil streams live'
    )
  })

  test('shows the immediate browser draft until the contextual CLI transcript catches up', () => {
    expect(selectSpeechDictationTranscript('', 'turn it blue')).toBe('turn it blue')
    expect(selectSpeechDictationTranscript('turn it', 'turn it blue')).toBe('turn it blue')
    expect(selectSpeechDictationTranscript('Open Pencil', 'open pensil')).toBe('Open Pencil')
    expect(selectSpeechDictationTranscript('Open Pencil streams live', 'open pensil streams')).toBe(
      'Open Pencil streams live'
    )
  })

  test('maps measured voice energy into distinct responsive bars', () => {
    const resting = speechWaveformLevels(frequencies([18, 14, 10, 6, 3]), [0, 0, 0, 0, 0])
    const speaking = speechWaveformLevels(frequencies([120, 95, 70, 45, 25]), [0, 0, 0, 0, 0])

    expect(speaking).toHaveLength(5)
    expect(speaking.every((level, index) => level > (resting[index] ?? 0))).toBe(true)
    expect(new Set(speaking.map((level) => level.toFixed(3))).size).toBeGreaterThan(3)
  })

  test('smooths a falling signal instead of snapping every bar to zero', () => {
    const speaking = speechWaveformLevels(frequencies([120, 95, 70, 45, 25]), [0, 0, 0, 0, 0])
    const falling = speechWaveformLevels(new Uint8Array(128), speaking)

    expect(falling.every((level, index) => level > 0 && level < (speaking[index] ?? 0))).toBe(true)
  })

  test('encodes browser microphone samples as 16 kHz mono PCM for the CLI bridge', () => {
    const pcm = speechPcm16(new Float32Array([-1, -1, 0.5, 0.5, 1, 1]), 32_000)
    const samples = new Int16Array(pcm)

    expect([...samples]).toEqual([-32768, 16383, 32767])
  })
})
