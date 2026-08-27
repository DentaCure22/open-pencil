import { describe, expect, test } from 'bun:test'

import {
  createPiThread,
  createPiTodoDraftThread,
  type ValidatedPiRequest
} from '#mcp/pi/router-state'

function request(input: Partial<ValidatedPiRequest> = {}): ValidatedPiRequest {
  return {
    effort: 'medium',
    model: 'xai-auth/grok-4.6',
    prompt: 'Attached files:\n- chrome-selection-0a5853f5-686b-4990-bea8-f722f2f46b36.png',
    ...input
  }
}

function threadTask(input: Partial<ValidatedPiRequest>): string {
  return createPiThread(request(input), 'Starting Pi.', '2026-08-23T14:00:00.000Z', 'worker-1').task
}

describe('createPiThread task titles', () => {
  test('creates a Todo chat with the responsive Todo Code Object preset', () => {
    const thread = createPiTodoDraftThread(
      {
        brief: { goal: 'Shape the patient history panel', title: 'Patient history panel' },
        effort: 'high',
        model: 'xai-auth/grok-4.6',
        projectId: 'project:dental',
        threadId: 'todo-chat:history',
        title: 'Patient history panel',
        todoId: 'todo:history'
      },
      '2026-08-26T12:00:00.000Z',
      'worker-1'
    )

    expect(thread).toMatchObject({
      id: 'todo-chat:history',
      title: 'Patient history panel',
      todoDraft: { presetId: 'todo-document', todoId: 'todo:history' }
    })
  })

  test('persists Screenshot for chrome-selection image-only chats', () => {
    expect(
      threadTask({
        attachments: [
          {
            alt: 'chrome-selection-0a5853f5-686b-4990-bea8-f722f2f46b36.png',
            type: 'image',
            url: 'data:image/png;base64,cG5n'
          }
        ]
      })
    ).toBe('Screenshot')
  })

  test('persists Image for a generic image-only filename', () => {
    expect(
      threadTask({
        attachments: [{ alt: 'notes.png', type: 'image', url: 'data:image/png;base64,cG5n' }]
      })
    ).toBe('Image')
  })

  test('keeps a real displayPrompt instead of the attachment filename', () => {
    expect(
      threadTask({
        attachments: [
          {
            alt: 'chrome-selection-0a5853f5-686b-4990-bea8-f722f2f46b36.png',
            type: 'image',
            url: 'data:image/png;base64,cG5n'
          }
        ],
        displayPrompt: 'Move this card'
      })
    ).toBe('Move this card')
  })
})
