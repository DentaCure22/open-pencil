import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { checkUsageTurns } from '../src/check'
import { readUsageTurns } from '../src/ledger'
import { parsePiUsage } from '../src/parse'
import { paddedPrompt } from '../src/probe'
import { formatUsageRollup, rollupUsageTurns } from '../src/rollup'
import {
  buildUsageTurnRecord,
  cacheHitPercent,
  promptTokens,
  usageFromParsed
} from '../src/schema'

const fixtures = path.join(import.meta.dir, 'fixtures')

describe('pi-model-meter schema', () => {
  test('reuses the grok-eval Pi usage parser and computes prompt cache percent', () => {
    const parsed = parsePiUsage(
      `${JSON.stringify({
        message: {
          usage: { cacheRead: 28800, cacheWrite: 0, input: 145, output: 12, totalTokens: 28957 }
        },
        type: 'message_end'
      })}\n`
    )
    const tokens = usageFromParsed(parsed)
    expect(tokens).toMatchObject({ cacheRead: 28800, cacheWrite: 0, input: 145, output: 12 })
    expect(promptTokens(tokens)).toBe(28945)
    expect(cacheHitPercent(tokens)).toBe(99.5)
    const record = buildUsageTurnRecord({
      at: '2026-08-23T14:00:10.000Z',
      modelId: 'xai-auth/grok-4.6',
      source: 'probe',
      threadId: 'meter-warmup-xai-auth',
      tokens,
      turnIndex: 4,
      usageSource: 'pi-event'
    })
    expect(JSON.stringify(record)).not.toContain('Reply with')
  })

  test('pads a stable prefix to the target token size', () => {
    const prompt = paddedPrompt(7_000, 'Reply with OK.')
    expect(prompt.endsWith('Reply with OK.')).toBe(true)
    expect(prompt.length).toBeGreaterThan(7_000 * 3)
  })
})

describe('pi-model-meter fixtures', () => {
  test('accepts the known Grok warmup shape and the 4s Gemini miss', async () => {
    const grok = await readUsageTurns(path.join(fixtures, 'grok-warmup.jsonl'))
    const delay = await readUsageTurns(path.join(fixtures, 'agy-delay.jsonl'))
    expect(grok).toHaveLength(5)
    expect(grok[4]?.cacheHitPercent).toBe(99.8)
    expect(delay[1]).toMatchObject({ cacheRead: 0, waitMs: 4_000 })
    expect(delay[2]).toMatchObject({ cacheRead: 4_076, waitMs: 30_000 })
    expect(checkUsageTurns([...grok, ...delay])).toEqual([])
  })

  test('flags the known Antigravity warmup drop after a hit', async () => {
    const turns = await readUsageTurns(path.join(fixtures, 'agy-warmup.jsonl'))
    expect(checkUsageTurns(turns).map((failure) => failure.code)).toEqual(['drop-after-hit'])
  })

  test('fails miss, drop, plateau, and estimated-when-measured fixtures', async () => {
    const turns = await readUsageTurns(path.join(fixtures, 'failures.jsonl'))
    expect(checkUsageTurns(turns).map((failure) => failure.code).sort()).toEqual([
      'drop-after-hit',
      'estimated-when-measured',
      'flat-while-growing',
      'miss-after-warmup',
      'miss-after-warmup'
    ])
  })

  test('rolls up token-weighted cache percent by model', async () => {
    const turns = await readUsageTurns(path.join(fixtures, 'grok-warmup.jsonl'))
    const rows = rollupUsageTurns(turns)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      callHitPercent: 80,
      estimatedPercent: 0,
      model: 'grok-4.6',
      provider: 'xai-auth',
      turns: 5
    })
    expect(rows[0]?.tokenCachePercent).toBeGreaterThan(40)
    expect(formatUsageRollup(rows)).toContain('xai-auth/grok-4.6')
  })
})
