import { computed, reactive } from 'vue'

import type { NarratedTraceEvidence } from '@/app/narrated-trace'

import type { ContextCommentDraft, ContextCommentTarget } from './types'

type ContextCommentState = {
  captureMode: boolean
  dispatching: boolean
  draft: ContextCommentDraft | null
  error: string | null
}

export const contextCommentState = reactive<ContextCommentState>({
  captureMode: false,
  dispatching: false,
  draft: null,
  error: null
})

export const contextCommentOpen = computed(() => contextCommentState.draft !== null)
export function openContextComment(target: ContextCommentTarget) {
  contextCommentState.captureMode = false
  contextCommentState.dispatching = false
  contextCommentState.error = null
  contextCommentState.draft = {
    capture: null,
    id: globalThis.crypto.randomUUID(),
    target,
    text: ''
  }
}

export function closeContextComment() {
  contextCommentState.captureMode = false
  contextCommentState.dispatching = false
  contextCommentState.error = null
  contextCommentState.draft = null
}

export function setContextCommentText(text: string) {
  if (contextCommentState.draft) contextCommentState.draft.text = text
}

export function setContextCommentCapture(capture: NarratedTraceEvidence | null) {
  if (contextCommentState.draft) contextCommentState.draft.capture = capture
}

export function startContextCommentCapture() {
  if (!contextCommentState.draft || contextCommentState.dispatching) return
  contextCommentState.error = null
  contextCommentState.captureMode = true
}

export function stopContextCommentCapture() {
  contextCommentState.captureMode = false
}
