import { computed, reactive } from 'vue'

import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { NarratedTraceEvidence } from '@/app/narrated-trace'

import type {
  ContextCommentBoardCapture,
  ContextCommentAnnotationAnchor,
  ContextCommentCaptureSource,
  ContextCommentDestination,
  ContextCommentDraft,
  ContextCommentFlow,
  ContextCommentImageAnnotation,
  ContextCommentTarget
} from './types'

type ContextCommentState = {
  captureMode: boolean
  capturePreparing: boolean
  dispatching: boolean
  draft: ContextCommentDraft | null
  error: string | null
}

export const contextCommentState = reactive<ContextCommentState>({
  captureMode: false,
  capturePreparing: false,
  dispatching: false,
  draft: null,
  error: null
})

export const contextCommentOpen = computed(() => contextCommentState.draft !== null)

function releaseCaptureSource() {
  const imageUrl = contextCommentState.draft?.captureSource?.imageUrl
  if (imageUrl?.startsWith('blob:')) URL.revokeObjectURL(imageUrl)
}

export function openContextComment(
  target: ContextCommentTarget,
  flow: ContextCommentFlow = 'comment'
) {
  releaseCaptureSource()
  contextCommentState.captureMode = false
  contextCommentState.capturePreparing = false
  contextCommentState.dispatching = false
  contextCommentState.error = null
  contextCommentState.draft = {
    annotations: [],
    capture: null,
    captureContext: null,
    captureSource: null,
    flow,
    id: globalThis.crypto.randomUUID(),
    target,
    text: ''
  }
}

export function openAgentImageComment(
  capture: NarratedTraceEvidence,
  destination: ContextCommentDestination
) {
  releaseCaptureSource()
  contextCommentState.captureMode = false
  contextCommentState.capturePreparing = false
  contextCommentState.dispatching = false
  contextCommentState.error = null
  contextCommentState.draft = {
    annotations: [],
    capture,
    captureContext: null,
    captureSource: null,
    destination,
    flow: 'screenshot',
    id: globalThis.crypto.randomUUID(),
    target: null,
    text: ''
  }
}

export function closeContextComment() {
  releaseCaptureSource()
  contextCommentState.captureMode = false
  contextCommentState.capturePreparing = false
  contextCommentState.dispatching = false
  contextCommentState.error = null
  contextCommentState.draft = null
}

export function setContextCommentText(text: string) {
  if (contextCommentState.draft) contextCommentState.draft.text = text
}

export function setContextCommentCapture(
  capture: NarratedTraceEvidence | null,
  captureContext: ContextCommentBoardCapture | null = null
) {
  const draft = contextCommentState.draft
  if (!draft) return
  if (draft.capture?.evidenceId !== capture?.evidenceId) draft.annotations = []
  draft.capture = capture
  draft.captureContext = captureContext
}

export function setContextCommentCaptureSource(source: ContextCommentCaptureSource | null) {
  const draft = contextCommentState.draft
  if (!draft) return
  const previousUrl = draft.captureSource?.imageUrl
  if (previousUrl?.startsWith('blob:') && previousUrl !== source?.imageUrl) {
    URL.revokeObjectURL(previousUrl)
  }
  draft.captureSource = source
}

export function setContextCommentCapturePreparing(preparing: boolean) {
  contextCommentState.capturePreparing = preparing
}

function normalizedCoordinate(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function addContextCommentImageAnnotation(
  point: Vector,
  anchor?: ContextCommentAnnotationAnchor
) {
  const draft = contextCommentState.draft
  if (!draft?.capture) return null
  const annotation: ContextCommentImageAnnotation = {
    comment: '',
    id: globalThis.crypto.randomUUID(),
    ...(anchor ? { anchor } : {}),
    x: normalizedCoordinate(point.x),
    y: normalizedCoordinate(point.y)
  }
  draft.annotations.push(annotation)
  return annotation.id
}

export function updateContextCommentImageAnnotation(id: string, comment: string) {
  const annotation = contextCommentState.draft?.annotations.find((item) => item.id === id)
  if (annotation) annotation.comment = comment
}

export function removeContextCommentImageAnnotation(id: string) {
  const draft = contextCommentState.draft
  if (!draft) return
  draft.annotations = draft.annotations.filter((annotation) => annotation.id !== id)
}

export function startContextCommentCapture() {
  if (!contextCommentState.draft || contextCommentState.dispatching) return
  contextCommentState.error = null
  contextCommentState.captureMode = true
}

export function stopContextCommentCapture() {
  contextCommentState.captureMode = false
  contextCommentState.capturePreparing = false
}
