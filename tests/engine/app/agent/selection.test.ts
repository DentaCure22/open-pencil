import { describe, expect, test } from 'bun:test'

import { addSelectionToDraft, quotedChatSelection } from '@/components/ai-elements/selection'

describe('chat text selection', () => {
  test('quotes selected transcript text into a follow-up draft', () => {
    expect(quotedChatSelection('First line\nSecond line')).toBe('> First line\n> Second line')
    expect(addSelectionToDraft('', 'Selected answer')).toBe('> Selected answer\n\n')
    expect(addSelectionToDraft('Why?', 'Selected answer')).toBe('Why?\n\n> Selected answer\n\n')
  })
})
