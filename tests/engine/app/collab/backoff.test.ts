import { describe, expect, test } from 'bun:test'

import { exponentialBackoffDelay } from '@/app/collab/persistence/backoff'

describe('OpenPencil Cloud retry backoff', () => {
  test('grows exponentially and caps the retry delay', () => {
    const delays = [0, 1, 2, 3, 4].map((attempt) =>
      exponentialBackoffDelay({
        attempt,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        randomFraction: 0.5
      })
    )

    expect(delays).toEqual([1000, 2000, 4000, 5000, 5000])
  })

  test('keeps bounded jitter around the exponential delay', () => {
    expect(
      exponentialBackoffDelay({
        attempt: 2,
        baseDelayMs: 1000,
        jitterRatio: 0.2,
        maxDelayMs: 10_000,
        randomFraction: 0
      })
    ).toBe(3200)
    expect(
      exponentialBackoffDelay({
        attempt: 2,
        baseDelayMs: 1000,
        jitterRatio: 0.2,
        maxDelayMs: 10_000,
        randomFraction: 1
      })
    ).toBe(4800)
  })
})
