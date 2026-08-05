import { ref } from 'vue'

export type NarratedTraceSpeechAvailability = 'unknown' | 'ready' | 'unavailable'

export const narratedTraceSpeechAvailability = ref<NarratedTraceSpeechAvailability>('unavailable')
export const narratedTraceVoiceLevel = ref(0)

/**
 * @deprecated Browser speech is available only through the explicit consent and
 * capability flow in `mic.ts`.
 */
export function checkNarratedTraceSpeechAvailability(): boolean {
  narratedTraceSpeechAvailability.value = 'unavailable'
  return false
}

/**
 * @deprecated Browser speech is available only through the explicit consent and
 * capability flow in `mic.ts`.
 */
export function startNarratedTraceSpeech(): boolean {
  return false
}

/**
 * @deprecated Browser speech is available only through the explicit consent and
 * capability flow in `mic.ts`.
 */
export function stopNarratedTraceSpeech() {
  narratedTraceVoiceLevel.value = 0
}
