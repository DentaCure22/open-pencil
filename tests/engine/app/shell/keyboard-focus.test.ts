import { describe, expect, test } from 'bun:test'

import { hasNativeTextSelection } from '@/app/shell/keyboard/focus'

function selection(text: string, isCollapsed = false): Selection {
  return {
    isCollapsed,
    toString: () => text
  } as Selection
}

describe('editor keyboard focus', () => {
  test('recognizes a native highlighted-text selection', () => {
    expect(hasNativeTextSelection(selection('selected transcript text'))).toBe(true)
  })

  test('ignores empty and collapsed selections', () => {
    expect(hasNativeTextSelection(selection(''))).toBe(false)
    expect(hasNativeTextSelection(selection('selected transcript text', true))).toBe(false)
    expect(hasNativeTextSelection(null)).toBe(false)
  })
})
