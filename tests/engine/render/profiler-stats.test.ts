import { describe, expect, test } from 'bun:test'

import { FrameStats, MAX_COUNTED_FRAME_GAP_MS } from '#core/profiler/frame/stats'

describe('profiler frame stats', () => {
  test('ignores idle gaps so a page hop does not look like a 14s frame', () => {
    const stats = new FrameStats()
    const now = { value: 1_000 }
    const originalNow = performance.now
    performance.now = () => now.value
    try {
      stats.recordFrame(4)
      now.value += 16
      stats.recordFrame(5)
      now.value += MAX_COUNTED_FRAME_GAP_MS + 8_000
      stats.recordFrame(6)
      now.value += 16
      stats.recordFrame(4)
      expect(stats.maxFrameTime).toBeLessThan(40)
      expect(stats.avgFrameTime).toBeGreaterThan(10)
      expect(stats.avgFrameTime).toBeLessThan(20)
    } finally {
      performance.now = originalNow
    }
  })
})
