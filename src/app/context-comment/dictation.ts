import { computed } from 'vue'

import {
  speechDictationActiveOwner,
  speechDictationAvailable,
  speechDictationError,
  startSpeechDictation,
  stopSpeechDictation
} from '@/app/speech-dictation'

const CONTEXT_COMMENT_OWNER = 'context-comment'

export const contextCommentDictationActive = computed(
  () => speechDictationActiveOwner.value === CONTEXT_COMMENT_OWNER
)
export const contextCommentDictationAvailable = speechDictationAvailable
export const contextCommentDictationError = speechDictationError

export function stopContextCommentDictation() {
  stopSpeechDictation(CONTEXT_COMMENT_OWNER)
}

export function startContextCommentDictation(
  currentText: string,
  updateText: (text: string) => void
) {
  return startSpeechDictation(CONTEXT_COMMENT_OWNER, currentText, updateText)
}
