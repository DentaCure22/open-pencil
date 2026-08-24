import { describe, expect, test } from 'bun:test'

import {
  formatMeterPercent,
  formatMeterTokens,
  modelMeterAreaPath,
  modelMeterChartRows,
  modelMeterLinePath,
  modelMeterName,
  modelMeterProviderLabel,
  modelMeterShortName,
  modelMeterRingDash,
  modelMeterTotals
} from '@/app/model-meter/presentation'

describe('model meter presentation', () => {
  test('weights fleet cache by prompt tokens and names models', () => {
    expect(modelMeterProviderLabel('xai-auth')).toBe('xAI')
    expect(modelMeterName('gemini-3-7-flash')).toBe('Gemini 3.7 Flash')
    expect(modelMeterName('cursor-grok-4.6-fast')).toBe('Cursor Grok 4.6 Fast')
    expect(modelMeterShortName('gemini-3-7-flash')).toBe('Gemini 3.7')
    expect(modelMeterShortName('cursor-grok-4.6-fast')).toBe('Cursor 4.6')
    expect(formatMeterPercent(82.9)).toBe('82.9%')
    expect(formatMeterTokens(24_538)).toBe('25k')
    expect(
      modelMeterTotals({
        rows: [
          {
            callHitPercent: 80,
            estimatedPercent: 0,
            lastAt: '2026-08-23T21:00:00.000Z',
            model: 'grok-4.6',
            promptTokens: 80_000,
            provider: 'xai-auth',
            tokenCachePercent: 50,
            turns: 4
          },
          {
            callHitPercent: 20,
            estimatedPercent: 0,
            lastAt: '2026-08-23T21:00:00.000Z',
            model: 'gemini-3-7-flash',
            promptTokens: 20_000,
            provider: 'antigravity',
            tokenCachePercent: 0,
            turns: 1
          }
        ],
        turns: 5
      })
    ).toEqual({
      callHitPercent: 68,
      cacheTokens: 40_000,
      estimatedPercent: 0,
      models: 2,
      promptTokens: 100_000,
      tokenCachePercent: 40,
      turns: 5
    })
    expect(modelMeterLinePath([{ cachePercent: 0 }, { cachePercent: 100 }])).toBe(
      'M 0.00 40.00 L 100.00 0.00'
    )
    expect(modelMeterAreaPath([{ cachePercent: 50 }])).toContain('L 100 40 L 0 40 Z')
    const ring = modelMeterRingDash(50)
    expect(ring.dash).toBeCloseTo(ring.gap)
    expect(
      modelMeterChartRows([
        {
          callHitPercent: 80,
          estimatedPercent: 0,
          lastAt: '2026-08-23T21:00:00.000Z',
          model: 'grok-4.6',
          promptTokens: 80_000,
          provider: 'xai-auth',
          tokenCachePercent: 50,
          turns: 4
        },
        {
          callHitPercent: 20,
          estimatedPercent: 0,
          lastAt: '2026-08-23T21:00:00.000Z',
          model: 'gemini-3-7-flash',
          promptTokens: 20_000,
          provider: 'antigravity',
          tokenCachePercent: 0,
          turns: 1
        }
      ])
    ).toEqual([
      {
        cachePercent: 50,
        cacheShare: 50,
        callHitPercent: 80,
        freshShare: 50,
        key: 'xai-auth/grok-4.6',
        label: 'Grok 4.6',
        lastAt: '2026-08-23T21:00:00.000Z',
        promptTokens: 80_000,
        provider: 'xAI',
        share: 80,
        shortLabel: 'Grok 4.6',
        turns: 4
      },
      {
        cachePercent: 0,
        cacheShare: 0,
        callHitPercent: 20,
        freshShare: 25,
        key: 'antigravity/gemini-3-7-flash',
        label: 'Gemini 3.7 Flash',
        lastAt: '2026-08-23T21:00:00.000Z',
        promptTokens: 20_000,
        provider: 'Antigravity',
        share: 20,
        shortLabel: 'Gemini 3.7',
        turns: 1
      }
    ])
  })
})
