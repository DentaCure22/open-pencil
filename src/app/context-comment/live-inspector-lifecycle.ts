import { closeContextComment, contextCommentState } from './state'

type LiveInspectorContextCommentInput = {
  active: boolean
  open: () => boolean
  selectedId: string | null
}

export function reconcileLiveInspectorContextComment(input: LiveInspectorContextCommentInput) {
  const current = contextCommentState.draft
  if (!input.active || !input.selectedId) {
    closeLiveInspectorContextComment()
    return false
  }
  if (
    current?.target?.kind === 'live-container' &&
    current.target.stableIds[0] === input.selectedId
  ) {
    return true
  }
  return input.open()
}

export function closeLiveInspectorContextComment() {
  if (contextCommentState.draft?.target?.kind !== 'live-container') return false
  closeContextComment()
  return true
}
