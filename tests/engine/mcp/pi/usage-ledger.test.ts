import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import {
  appendUsageTurn,
  buildLiveUsageTurn,
  buildUsageTurnRecord,
  cacheHitPercent,
  defaultUsageLedgerPath,
  parseUsageTokens,
  parseUsageTurnRecord,
  promptTokens,
  readUsageTurns,
  rollupUsageSnapshot
} from '#mcp/pi/usage-ledger'

function thread(): AgentConversationThread {
  return {
    canFollowUp: true,
    contextUsage: {
      autoCompactionEnabled: true,
      compacting: false,
      contextWindow: 500_000,
      lastCompactedAt: '2026-08-23T00:00:08.000Z',
      percent: 16,
      tokens: 82_000
    },
    createdAt: '2026-08-23T00:00:00.000Z',
    effort: 'high',
    id: 'thread-1',
    messages: [
      {
        createdAt: '2026-08-23T00:00:00.000Z',
        id: 'user-1',
        role: 'user',
        text: 'first'
      },
      {
        completedAt: '2026-08-23T00:00:03.000Z',
        createdAt: '2026-08-23T00:00:02.000Z',
        id: 'asst-1',
        role: 'assistant',
        text: 'ok'
      },
      {
        createdAt: '2026-08-23T00:00:06.000Z',
        id: 'user-2',
        parts: [{ input: '{}', name: 'read', output: 'file', state: 'success', type: 'tool' }],
        role: 'user',
        text: 'again'
      },
      {
        completedAt: '2026-08-23T00:00:09.000Z',
        createdAt: '2026-08-23T00:00:08.000Z',
        id: 'asst-2',
        parts: [{ input: '{}', name: 'read', output: 'file', state: 'success', type: 'tool' }],
        role: 'assistant',
        text: 'done'
      }
    ],
    model: 'xai-auth/grok-4.6',
    recentUpdate: '',
    sessionId: 'session-1',
    state: 'completed',
    task: 'Task',
    updatedAt: '2026-08-23T00:00:09.000Z',
    workerId: 'worker-1'
  }
}

describe('usage ledger', () => {
  test('computes token-weighted cache hit percent from prompt buckets', () => {
    expect(promptTokens({ cacheRead: 72_000, cacheWrite: 0, input: 8_000 })).toBe(80_000)
    expect(cacheHitPercent({ cacheRead: 72_000, cacheWrite: 0, input: 8_000 })).toBe(90)
    expect(cacheHitPercent({ cacheRead: 0, cacheWrite: 0, input: 0 })).toBe(0)
  })

  test('builds a live turn without prompt text', () => {
    const record = buildLiveUsageTurn(thread(), {
      at: '2026-08-23T00:00:09.000Z',
      tokens: {
        cacheRead: 28_800,
        cacheWrite: 0,
        input: 145,
        output: 40,
        reasoning: 12
      },
      usageSource: 'pi-event'
    })
    expect(record).toMatchObject({
      cacheHitPercent: 99.5,
      cacheRead: 28_800,
      compacted: true,
      gapMs: 6_000,
      input: 145,
      model: 'grok-4.6',
      promptTokens: 28_945,
      provider: 'xai-auth',
      source: 'live',
      threadId: 'session-1',
      toolsPresent: true,
      turnIndex: 2,
      usageSource: 'pi-event'
    })
    expect(JSON.stringify(record)).not.toContain('again')
  })

  test('resolves the ledger path from env and appends JSONL', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-usage-ledger-'))
    const filePath = path.join(root, 'turns.jsonl')
    try {
      expect(defaultUsageLedgerPath({ OPENPENCIL_MODEL_METER_LOG: filePath })).toBe(filePath)
      const first = buildUsageTurnRecord({
        at: '2026-08-23T00:00:01.000Z',
        model: 'antigravity/gemini-3-7-flash',
        source: 'probe',
        threadId: 'probe-1',
        tokens: parseUsageTokens({ cacheRead: 20_331, input: 4_207, output: 80 }),
        turnIndex: 2,
        usageSource: 'agy-sqlite',
        scenario: 'warmup',
        waitMs: 0
      })
      await appendUsageTurn(first, filePath)
      await appendUsageTurn(
        buildUsageTurnRecord({
          at: '2026-08-23T00:00:02.000Z',
          model: 'antigravity/gemini-3-7-flash',
          source: 'probe',
          threadId: 'probe-1',
          tokens: parseUsageTokens({ cacheRead: 0, input: 25_228, output: 60 }),
          turnIndex: 5,
          usageSource: 'agy-sqlite',
          scenario: 'warmup'
        }),
        filePath
      )
      const text = await readFile(filePath, 'utf8')
      expect(text.split('\n').filter(Boolean)).toHaveLength(2)
      const turns = await readUsageTurns(filePath)
      expect(turns.map((turn) => turn.cacheHitPercent)).toEqual([82.9, 0])
      expect(parseUsageTurnRecord({ ...first, extra: true })).toMatchObject({
        cacheHitPercent: 82.9,
        scenario: 'warmup'
      })
      const snapshot = rollupUsageSnapshot(turns, 7)
      expect(snapshot.series).toHaveLength(2)
      expect(snapshot.rows[0]).toMatchObject({
        callHitPercent: 50,
        model: 'gemini-3-7-flash',
        provider: 'antigravity',
        tokenCachePercent: 40.9,
        turns: 2
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
