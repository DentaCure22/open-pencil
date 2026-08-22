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

  test('moves files into the optimistic user turn until authoritative parts arrive', () => {
    const threadId = crypto.randomUUID()
    beginOptimisticConversation(threadId, 'Review these.', [
      new File(['png'], 'reference.png', { type: 'image/png' }),
      new File(['mov'], 'walkthrough.mov', { type: 'video/quicktime' })
    ])

    const optimistic = mergeOptimisticMessages(threadId, [])
    expect(optimistic[0]).toMatchObject({ role: 'user', text: 'Review these.' })
    expect(optimistic[0]?.parts).toHaveLength(2)
    expect(optimistic[0]?.parts?.[0]).toMatchObject({
      alt: 'reference.png',
      type: 'image',
      url: expect.stringMatching(/^blob:/)
    })
    expect(optimistic[0]?.parts?.[1]).toMatchObject({
      mediaType: 'video/quicktime',
      name: 'walkthrough.mov',
      size: 3,
      type: 'attachment'
    })

    const startedAt = optimisticConversation(threadId)?.startedAt ?? new Date().toISOString()
    const preview = mergeOptimisticMessages(threadId, [
      {
        createdAt: startedAt,
        id: 'server-user-preview',
        role: 'user',
        text: 'Review these.'
      }
    ])
    expect(preview[0]?.parts).toHaveLength(2)

    const authoritative = mergeOptimisticMessages(threadId, [
      {
        createdAt: startedAt,
        id: 'server-user-full',
        parts: [
          {
            alt: 'reference.png',
            type: 'image',
            url: 'data:image/png;base64,cG5n'
          },
          {
            mediaType: 'video/quicktime',
            name: 'walkthrough.mov',
            size: 3,
            type: 'attachment'
          }
        ],
        role: 'user',
        text: 'Review these.'
      }
    ])
    expect(authoritative[0]?.parts?.[0]).toMatchObject({
      type: 'image',
      url: 'data:image/png;base64,cG5n'
    })
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
