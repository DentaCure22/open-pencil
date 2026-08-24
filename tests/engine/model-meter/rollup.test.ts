import { describe, expect, test } from 'bun:test'

import { parseModelMeterSnapshot } from '@/app/model-meter/load'
import { parseModelMeterTurns, rollupModelMeterTurns } from '@/app/model-meter/rollup'

describe('model meter rollup', () => {
  test('parses ledger rows and weights cache by prompt tokens', () => {
    const now = new Date().toISOString()
    const turns = parseModelMeterTurns(
      [
        JSON.stringify({
          at: now,
          cacheRead: 28_800,
          input: 145,
          model: 'grok-4.6',
          promptTokens: 28_945,
          provider: 'xai-auth',
          usageSource: 'pi-event'
        }),
        JSON.stringify({
          at: now,
          cacheRead: 0,
          input: 28_826,
          model: 'grok-4.6',
          promptTokens: 28_826,
          provider: 'xai-auth',
          usageSource: 'pi-event'
        }),
        'not-json'
      ].join('\n')
    )
    expect(turns).toHaveLength(2)
    const snapshot = rollupModelMeterTurns(turns, 7)
    expect(snapshot.turns).toBe(2)
    expect(snapshot.series).toHaveLength(2)
    expect(snapshot.series[0]?.cachePercent).toBeGreaterThan(90)
    expect(snapshot.series[1]?.cachePercent).toBe(0)
    expect(snapshot.rows[0]).toMatchObject({
      callHitPercent: 50,
      model: 'grok-4.6',
      provider: 'xai-auth',
      tokenCachePercent: 49.9,
      turns: 2
    })
  })

  test('accepts the local chat meter snapshot used by the web app', () => {
    expect(
      parseModelMeterSnapshot({
        available: true,
        days: 7,
        lastAt: '2026-08-23T21:00:00.000Z',
        rows: [
          {
            callHitPercent: 80,
            estimatedPercent: 0,
            lastAt: '2026-08-23T21:00:00.000Z',
            model: 'grok-4.6',
            promptTokens: 80_000,
            provider: 'xai-auth',
            tokenCachePercent: 41.2,
            turns: 5
          }
        ],
        turns: 5
      })
    ).toMatchObject({
      available: true,
      rows: [{ model: 'grok-4.6', tokenCachePercent: 41.2, turns: 5 }]
    })
    expect(parseModelMeterSnapshot({ available: false, rows: [] })).toBeNull()
  })
})
