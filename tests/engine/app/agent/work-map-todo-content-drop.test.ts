import { describe, expect, test } from 'bun:test'

import { carriesWorkMapTodoContentTypes } from '@/app/agent-chat/work-map-todo-content-drop'
import { BROWSER_CAPTURE_DRAG_TYPE } from '@/app/browser-inspector/drag'

describe('Work Map Todo content drops', () => {
  test('accepts files, browser captures, and plain text', () => {
    expect(carriesWorkMapTodoContentTypes(['Files'])).toBeTrue()
    expect(carriesWorkMapTodoContentTypes([BROWSER_CAPTURE_DRAG_TYPE])).toBeTrue()
    expect(carriesWorkMapTodoContentTypes(['text/plain'])).toBeTrue()
    expect(carriesWorkMapTodoContentTypes(['text/html'])).toBeFalse()
  })

  test('keeps Todo status moves out of the content-drop path', () => {
    expect(
      carriesWorkMapTodoContentTypes([
        'application/x-openpencil-work-map-todo',
        'text/plain',
        'Files'
      ])
    ).toBeFalse()
  })
})
