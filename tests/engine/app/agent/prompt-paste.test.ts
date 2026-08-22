import { describe, expect, test } from 'bun:test'

import {
  createPastedTextAttachment,
  isPastedTextAttachment,
  LARGE_PASTE_CHARACTER_THRESHOLD,
  LARGE_PASTE_LINE_THRESHOLD,
  shouldAttachPastedText
} from '@/components/ai-elements/prompt-paste'

describe('agent prompt paste handling', () => {
  test('keeps ordinary pasted text editable', () => {
    expect(shouldAttachPastedText('A short follow-up pasted into the composer.')).toBe(false)
    expect(shouldAttachPastedText('x'.repeat(LARGE_PASTE_CHARACTER_THRESHOLD - 1))).toBe(false)
  })

  test('turns long or multiline pastes into text attachments', () => {
    expect(shouldAttachPastedText('x'.repeat(LARGE_PASTE_CHARACTER_THRESHOLD))).toBe(true)
    expect(
      shouldAttachPastedText(
        Array.from({ length: LARGE_PASTE_LINE_THRESHOLD }, () => 'x').join('\n')
      )
    ).toBe(true)
  })

  test('gives pasted text stable, distinct attachment names', async () => {
    const first = createPastedTextAttachment('First paste', [])
    const second = createPastedTextAttachment('Second paste', [first])

    expect(first.name).toBe('Pasted text.txt')
    expect(second.name).toBe('Pasted text 2.txt')
    expect(isPastedTextAttachment(first)).toBe(true)
    expect(
      isPastedTextAttachment(new File(['notes'], 'Pasted text.txt', { type: 'text/plain' }))
    ).toBe(false)
    expect(await first.text()).toBe('First paste')
  })
})
