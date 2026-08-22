import { describe, expect, test } from 'bun:test'

import { promptWithAnnotations } from '@/app/agent-chat/annotations'

describe('chat annotations', () => {
  test('keeps annotation text out of the draft and adds it only to the submitted prompt', () => {
    expect(
      promptWithAnnotations('Why?', [
        {
          comment: 'Make this more concrete.',
          endOffset: 28,
          id: 'annotation-1',
          quote: 'First line\nSecond line',
          sourceMessageId: 'message-1',
          startOffset: 6
        }
      ])
    ).toBe(
      'Why?\n\nAnnotations:\n\nAnnotation 1:\n> First line\n> Second line\nComment: Make this more concrete.'
    )
  })
})
