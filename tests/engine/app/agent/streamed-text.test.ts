import { describe, expect, test } from 'bun:test'

import {
  alignStreamedText,
  nextStreamedLength,
  sliceStreamedText
} from '@/components/ai-elements/streamed-text'

describe('streamed text reveal', () => {
  test('keeps growing text and snaps when the incoming line is rewritten', () => {
    expect(alignStreamedText('Hello', 'Hello world')).toEqual({
      displayed: 'Hello',
      from: 5,
      incoming: 'Hello world',
      snap: false
    })
    expect(alignStreamedText('Hello world', 'Hi there')).toEqual({
      displayed: 'Hi there',
      from: 8,
      incoming: 'Hi there',
      snap: true
    })
  })

  test('eases a dump in instead of painting the whole chunk at once', () => {
    expect(
      nextStreamedLength({
        displayed: 5,
        elapsedMs: 40,
        from: 5,
        incoming: 24
      })
    ).toBeGreaterThan(5)
    expect(
      nextStreamedLength({
        displayed: 5,
        elapsedMs: 40,
        from: 5,
        incoming: 24
      })
    ).toBeLessThan(24)
    expect(
      nextStreamedLength({
        displayed: 5,
        elapsedMs: 280,
        from: 5,
        incoming: 24
      })
    ).toBe(24)
  })

  test('catches up faster when the live text is far behind', () => {
    const small = nextStreamedLength({
      displayed: 0,
      elapsedMs: 16,
      from: 0,
      incoming: 20
    })
    const large = nextStreamedLength({
      displayed: 0,
      elapsedMs: 16,
      from: 0,
      incoming: 160
    })
    expect(large).toBeGreaterThan(small)
    expect(
      nextStreamedLength({
        displayed: 10,
        elapsedMs: 16,
        from: 10,
        incoming: 12,
        reduceMotion: true
      })
    ).toBe(12)
  })

  test('does not split a surrogate pair', () => {
    expect(sliceStreamedText('Hi 👋', 4)).toBe('Hi ')
    expect(sliceStreamedText('Hi 👋', 5)).toBe('Hi 👋')
    expect(sliceStreamedText('Hi 👋', 6)).toBe('Hi 👋')
  })
})
