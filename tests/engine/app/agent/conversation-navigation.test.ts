import { describe, expect, test } from 'bun:test'

import type { AiMessage } from '@/app/agent-chat/types'
import { conversationNavigationItems } from '@/components/ai-elements/conversation-navigation'

function message(
  id: string,
  role: AiMessage['role'],
  text: string,
  overrides: Partial<AiMessage> = {}
): AiMessage {
  return {
    createdAt: '2026-08-22T00:00:00.000Z',
    id,
    role,
    text,
    ...overrides
  }
}

describe('conversation chapter navigation', () => {
  test('creates one stable chapter per user message with its assistant preview', () => {
    expect(
      conversationNavigationItems([
        message('user-1', 'user', 'First prompt'),
        message('tool-1', 'assistant', '', {
          parts: [{ input: '{}', name: 'read_file', state: 'success', type: 'tool' }]
        }),
        message('assistant-1', 'assistant', 'First answer'),
        message('assistant-2', 'assistant', 'More detail'),
        message('user-2', 'user', 'Second prompt'),
        message('assistant-3', 'assistant', 'Second answer')
      ])
    ).toEqual([
      {
        id: 'user-1',
        prompt: 'First prompt',
        response: 'First answer\n\nMore detail'
      },
      { id: 'user-2', prompt: 'Second prompt', response: 'Second answer' }
    ])
  })

  test('uses the last commentary as the chapter response when there is no answer bubble', () => {
    expect(
      conversationNavigationItems([
        message('user-1', 'user', 'Add a spinner.'),
        message('note-1', 'assistant', '', {
          parts: [
            {
              state: 'complete',
              text: 'The spinner is on the open chat and the thread list.',
              type: 'commentary'
            }
          ]
        })
      ])
    ).toEqual([
      {
        id: 'user-1',
        prompt: 'Add a spinner.',
        response: 'The spinner is on the open chat and the thread list.'
      }
    ])
  })

  test('uses durable attachment and image labels when a prompt has no text', () => {
    expect(
      conversationNavigationItems([
        message('user-attachment', 'user', '', {
          parts: [
            { mediaType: 'application/pdf', name: 'brief.pdf', type: 'attachment' },
            { alt: 'Reference image', type: 'image', url: 'blob:reference' }
          ]
        })
      ])
    ).toEqual([
      {
        id: 'user-attachment',
        prompt: 'Attachment: brief.pdf\n\nReference image',
        response: ''
      }
    ])
  })

  test('bounds large previews without changing their stable message identity', () => {
    const [item] = conversationNavigationItems([
      message('user-large', 'user', 'P'.repeat(600)),
      message('assistant-large', 'assistant', 'R'.repeat(2_000))
    ])

    expect(item?.id).toBe('user-large')
    expect(item?.prompt).toHaveLength(400)
    expect(item?.prompt.endsWith('…')).toBe(true)
    expect(item?.response).toHaveLength(1_600)
    expect(item?.response.endsWith('…')).toBe(true)
  })
})
