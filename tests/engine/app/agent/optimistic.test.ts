import { describe, expect, test } from 'bun:test'

import {
  acceptOptimisticConversation,
  beginOptimisticConversation,
  completeOptimisticConversation,
  failOptimisticConversation,
  mergeOptimisticMessages,
  optimisticConversation
} from '@/app/agent-chat/optimistic'

describe('agent chat optimistic lifecycle', () => {
  test('shows the user message immediately and reconciles the authoritative copy', () => {
    const threadId = crypto.randomUUID()
    const id = beginOptimisticConversation(threadId, 'Read only the package name')
    expect(mergeOptimisticMessages(threadId, [])).toMatchObject([
      { role: 'user', text: 'Read only the package name' }
    ])
    acceptOptimisticConversation(threadId, id)
    expect(optimisticConversation(threadId)?.state).toBe('thinking')
    const startedAt = optimisticConversation(threadId)?.startedAt ?? new Date().toISOString()
    const authoritative = [
      {
        createdAt: startedAt,
        id: 'server-user',
        role: 'user' as const,
        text: 'Read only the package name'
      }
    ]
    expect(mergeOptimisticMessages(threadId, authoritative)).toHaveLength(1)
  })

  test('keeps a failed request retryable instead of leaving a busy loader', () => {
    const threadId = crypto.randomUUID()
    const id = beginOptimisticConversation(threadId, 'Try once')
    failOptimisticConversation(threadId, id, 'Pi unavailable')
    expect(optimisticConversation(threadId)).toMatchObject({
      error: 'Pi unavailable',
      state: 'error'
    })
  })

  test('renders the completed Pi response in the originating conversation', () => {
    const threadId = crypto.randomUUID()
    const id = beginOptimisticConversation(threadId, 'Reply in this card')
    acceptOptimisticConversation(threadId, id)
    completeOptimisticConversation(threadId, id, 'Visible Pi response')

    expect(mergeOptimisticMessages(threadId, [])).toMatchObject([
      { role: 'user', text: 'Reply in this card' },
      { role: 'assistant', text: 'Visible Pi response' }
    ])
  })
})
