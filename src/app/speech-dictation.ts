import { computed, ref } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

export const speechDictationActiveOwner = ref<string | null>(null)
export const speechDictationError = ref<string | null>(null)
export const speechDictationAvailable = computed(
  () => IS_BROWSER && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition)
)

let recognition: SpeechRecognition | null = null
let generation = 0

function recognitionConstructor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function stopSpeechDictation(ownerId?: string) {
  if (ownerId && speechDictationActiveOwner.value !== ownerId) return
  generation += 1
  recognition?.stop()
  recognition = null
  speechDictationActiveOwner.value = null
}

export function startSpeechDictation(
  ownerId: string,
  currentText: string,
  updateText: (text: string) => void
) {
  stopSpeechDictation()
  speechDictationError.value = null
  const Recognition = recognitionConstructor()
  if (!Recognition) {
    speechDictationError.value =
      'Dictation is unavailable in this browser. Typed input still works.'
    return false
  }

  const currentGeneration = ++generation
  const transcriptBase = currentText.trim()
  recognition = new Recognition()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = navigator.language || 'en-US'
  recognition.onresult = (event) => {
    if (currentGeneration !== generation) return
    let transcript = ''
    for (const result of Array.from(event.results)) {
      transcript += result[0]?.transcript ?? ''
    }
    updateText([transcriptBase, transcript.trim()].filter(Boolean).join(' '))
  }
  recognition.onerror = (event) => {
    if (currentGeneration !== generation) return
    speechDictationError.value =
      event.error === 'not-allowed'
        ? 'Microphone access was denied. Typed input still works.'
        : 'Dictation stopped unexpectedly. Typed input still works.'
    stopSpeechDictation(ownerId)
  }
  recognition.onend = () => {
    if (currentGeneration !== generation) return
    recognition = null
    speechDictationActiveOwner.value = null
  }
  recognition.start()
  speechDictationActiveOwner.value = ownerId
  return true
}
