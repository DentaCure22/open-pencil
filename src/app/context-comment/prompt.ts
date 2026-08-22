import { composeDirectedWorkPrompt } from '@/app/agent-chat/directed-work-prompt'

import { contextCommentTargetLines } from './selection-brief'
import type { ContextCommentDraft } from './types'

export function contextCommentPrompt(draft: ContextCommentDraft) {
  return composeDirectedWorkPrompt({
    exactWords: draft.text.trim(),
    namedTargetLines: contextCommentTargetLines(draft.target)
  })
}
