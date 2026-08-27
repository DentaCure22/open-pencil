import { describe, expect, test } from 'bun:test'

import { computed, ref } from 'vue'

import type { AgentPromptAnnotation } from '@/app/agent-chat/models'
import type { AiMessage, AiTurnChanges } from '@/app/agent-chat/types'
import { useConversationDiffReview } from '@/components/ai-elements/useConversationDiffReview'

const changes: AiTurnChanges = {
  additions: 2,
  capturedAt: '2026-08-26T12:00:00.000Z',
  deletions: 1,
  files: [{ additions: 2, deletions: 1, path: 'src/example.ts', status: 'modified' }]
}

describe('conversation diff review', () => {
  test('persists selection and reconciles review comments through one interface', () => {
    const annotations = ref<AgentPromptAnnotation[]>([])
    const messages = ref<AiMessage[]>([
      {
        changes,
        createdAt: changes.capturedAt,
        id: 'assistant-diff',
        role: 'assistant',
        text: 'Implemented'
      }
    ])
    const threadId = ref(`diff-review-${crypto.randomUUID()}`)
    const view = ref<'conversation' | 'list' | 'plan'>('conversation')
    const review = useConversationDiffReview({
      annotations,
      messages: computed(() => messages.value),
      threadId: computed(() => threadId.value),
      view
    })

    review.open(changes, 'src/example.ts')
    expect(review.state.value).toMatchObject({
      capturedAt: changes.capturedAt,
      open: true,
      selectedPath: 'src/example.ts'
    })
    expect(review.changes.value).toEqual(changes)

    review.addComment({
      capturedAt: changes.capturedAt,
      endIndex: 4,
      path: 'src/example.ts',
      quote: '+const answer = 42',
      rangeLabel: 'line 4',
      startIndex: 4,
      text: 'Keep this named.'
    })
    expect(review.comments.value).toMatchObject([
      { path: 'src/example.ts', text: 'Keep this named.' }
    ])

    const comment = review.comments.value[0]
    if (!comment) throw new Error('Diff comment missing')
    review.deleteComment(comment.id)
    expect(review.comments.value).toEqual([])
  })
})
