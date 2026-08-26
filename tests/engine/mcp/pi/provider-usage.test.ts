import { describe, expect, test } from 'bun:test'

import { parseXaiProviderUsageNotification } from '#mcp/pi/providers/xai/usage'

describe('Pi provider usage', () => {
  test('keeps only the bounded subscription summary needed by the model picker', () => {
    expect(
      parseXaiProviderUsageNotification(
        [
          'xAI usage (unofficial, revision-pinned):',
          'Subscription: SuperGrok',
          'Included usage: 2%',
          'Reset: 2026-08-28T00:00:00Z',
          'On-demand credits: $0.00 used of $50.00'
        ].join('\n'),
        '2026-08-21T20:00:00.000Z'
      )
    ).toEqual({
      provider: 'xAI',
      queriedAt: '2026-08-21T20:00:00.000Z',
      remainingPercent: 98,
      resetAt: '2026-08-28T00:00:00Z',
      subscription: 'SuperGrok',
      usedPercent: 2
    })
  })

  test('rejects missing or out-of-range percentages', () => {
    expect(parseXaiProviderUsageNotification('Subscription: SuperGrok')).toBeNull()
    expect(parseXaiProviderUsageNotification('Included usage: 101%')).toBeNull()
  })
})
