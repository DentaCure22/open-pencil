import { describe, expect, test } from 'bun:test'

import {
  CONVERSATION_RUN_DEFAULT_HEIGHT,
  conversationPaintedRuns,
  conversationRunAlwaysIndexes,
  conversationRunHeightEstimate,
  conversationRunHeights,
  conversationRunWindow,
  conversationWindowFollowsLatest,
  nextConversationRunHeight
} from '@/components/ai-elements/conversation-window'

describe('conversation run window', () => {
  test('paints every short chat', () => {
    const heights = Array.from({ length: 6 }, () => 200)
    expect(conversationRunWindow(heights, { scrollTop: 800, viewportHeight: 600 })).toEqual({
      end: 6,
      leading: 0,
      start: 0,
      trailing: 0
    })
  })

  test('assumes the latest turns before the viewport has been measured', () => {
    const heights = Array.from({ length: 20 }, () => CONVERSATION_RUN_DEFAULT_HEIGHT)
    const window = conversationRunWindow(heights, { scrollTop: 0, viewportHeight: 0 })
    expect(window.start).toBe(18)
    expect(window.end).toBe(20)
    expect(window.leading).toBe(18 * CONVERSATION_RUN_DEFAULT_HEIGHT)
    expect(window.trailing).toBe(0)
  })

  test('keeps unmeasured Board cards on the latest turns only', () => {
    const heights = Array.from({ length: 6 }, () => 200)
    const window = conversationRunWindow(heights, { scrollTop: 0, viewportHeight: 0 })
    expect(window.start).toBe(4)
    expect(window.end).toBe(6)
    expect(window.leading).toBe(800)
    expect(window.trailing).toBe(0)
  })

  test('keeps only the visible slice plus overscan for a long transcript', () => {
    const heights = Array.from({ length: 20 }, () => CONVERSATION_RUN_DEFAULT_HEIGHT)
    const window = conversationRunWindow(heights, {
      scrollTop: 12 * CONVERSATION_RUN_DEFAULT_HEIGHT,
      viewportHeight: 560
    })
    expect(window.start).toBeGreaterThan(0)
    expect(window.end).toBeLessThan(20)
    expect(window.end - window.start).toBeLessThan(12)
    expect(window.leading).toBe(window.start * CONVERSATION_RUN_DEFAULT_HEIGHT)
    expect(window.trailing).toBe((20 - window.end) * CONVERSATION_RUN_DEFAULT_HEIGHT)
    expect(conversationPaintedRuns(heights, window).map((item) => item.runIndex)).toEqual(
      Array.from({ length: window.end - window.start }, (_, offset) => window.start + offset)
    )
  })

  test('forces a loaded chapter to stay mounted when the rail jumps to it', () => {
    const heights = Array.from({ length: 16 }, () => CONVERSATION_RUN_DEFAULT_HEIGHT)
    const window = conversationRunWindow(heights, {
      alwaysIndexes: [0],
      scrollTop: 14 * CONVERSATION_RUN_DEFAULT_HEIGHT,
      viewportHeight: 400
    })
    expect(window.start).toBe(0)
    expect(window.end).toBeGreaterThan(0)
    expect(window.leading).toBe(0)
  })

  test('maps measured heights and always-ids onto run indexes', () => {
    expect(conversationRunHeights(['a', 'b'], { a: 120 }, 200)).toEqual([120, 120])
    expect(
      conversationRunAlwaysIndexes(
        [
          { id: 'run-1', prompt: { id: 'user-1' } },
          { id: 'run-2', prompt: { id: 'user-2' } }
        ],
        ['user-2', null]
      )
    ).toEqual([1])
  })

  test('estimates unmeasured turns from nearby measured heights', () => {
    expect(conversationRunHeightEstimate({ a: 96, b: 110, c: 400 })).toBe(110)
    expect(conversationRunHeights(['a', 'b', 'c'], { a: 96, b: 110 })).toEqual([
      96,
      110,
      conversationRunHeightEstimate({ a: 96, b: 110 })
    ])
  })

  test('holds the latest painted turns still while a reply is streaming', () => {
    const heights = Array.from({ length: 20 }, () => CONVERSATION_RUN_DEFAULT_HEIGHT)
    expect(conversationWindowFollowsLatest(heights, 19 * CONVERSATION_RUN_DEFAULT_HEIGHT, 400)).toBe(
      true
    )
    expect(conversationRunWindow(heights, { live: true, scrollTop: 0, viewportHeight: 600 })).toEqual(
      {
        end: 20,
        leading: 12 * CONVERSATION_RUN_DEFAULT_HEIGHT,
        start: 12,
        trailing: 0
      }
    )
  })

  test('does not shrink the live turn height while it is streaming', () => {
    expect(nextConversationRunHeight(280, 312)).toBe(312)
    expect(nextConversationRunHeight(312, 280, { allowShrink: false })).toBeUndefined()
    expect(nextConversationRunHeight(312, 312.4)).toBeUndefined()
  })
})
