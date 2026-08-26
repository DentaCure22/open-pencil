import { describe, expect, test } from 'bun:test'

import {
  alignStreamedText,
  nextStreamedLength,
  sliceStreamedText,
  splitStreamedTextTail
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
        incoming: 24
      })
    ).toBeGreaterThan(5)
    expect(
      nextStreamedLength({
        displayed: 5,
        elapsedMs: 40,
        incoming: 24
      })
    ).toBeLessThan(24)
    expect(
      nextStreamedLength({
        displayed: 5,
        elapsedMs: 40,
        finishing: true,
        incoming: 24
      })
    ).toBeGreaterThan(5)
  })

  test('catches up faster when the live text is far behind', () => {
    const small = nextStreamedLength({
      displayed: 0,
      elapsedMs: 16,
      incoming: 20
    })
    const large = nextStreamedLength({
      displayed: 0,
      elapsedMs: 16,
      incoming: 160
    })
    expect(large).toBeGreaterThan(small)
    expect(
      nextStreamedLength({
        displayed: 10,
        elapsedMs: 16,
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

  test('keeps stable glyph keys while the animated tail grows', () => {
    const first = splitStreamedTextTail('Smooth text')
    const next = splitStreamedTextTail('Smooth text!')
    const firstGlyphKeys = first.tail.flatMap((segment) =>
      (segment.glyphs ?? []).map((glyph) => glyph.key)
    )
    const nextGlyphKeys = next.tail.flatMap((segment) =>
      (segment.glyphs ?? []).map((glyph) => glyph.key)
    )
    expect(nextGlyphKeys.slice(0, firstGlyphKeys.length)).toEqual(firstGlyphKeys)
    expect(nextGlyphKeys.at(-1)).toBe('glyph-11-!')
  })

  test('meters ordinary live polling updates without burst-stop jumps', () => {
    let displayed = 0
    let incoming = 6
    const steps: number[] = []
    for (let frame = 0; frame < 20; frame += 1) {
      if (frame > 0 && frame % 5 === 0) incoming += 6
      const next = nextStreamedLength({
        displayed,
        elapsedMs: 1_000 / 60,
        incoming
      })
      steps.push(next - displayed)
      displayed = next
    }
    expect(steps.every((step) => step >= 1 && step <= 2)).toBe(true)
  })
})
