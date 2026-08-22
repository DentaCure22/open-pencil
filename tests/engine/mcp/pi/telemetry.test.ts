import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import {
  applyPiEventTelemetry,
  applyPiSessionStats,
  applyPiStateTelemetry,
  hydrateEstimatedAntigravityTelemetry
} from '#mcp/pi/telemetry'

function thread(): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-21T00:00:00.000Z',
    effort: 'high',
    id: 'thread-1',
    messages: [],
    model: 'xai-auth/grok-4.6',
    recentUpdate: '',
    sessionId: 'thread-1',
    state: 'running',
    task: 'Task',
    updatedAt: '2026-08-21T00:00:00.000Z',
    workerId: 'worker-1'
  }
}

function timing() {
  return {
    firstTokenAt: null as number | null,
    generatedCharacters: 0,
    generationBaseTokens: null as number | null
  }
}

describe('Pi conversation telemetry', () => {
  test('measures provider output tokens across the streamed generation interval', () => {
    const conversation = thread()
    const generation = timing()

    expect(
      applyPiStateTelemetry(conversation, {
        autoCompactionEnabled: true,
        isCompacting: false,
        model: { contextWindow: 500_000 }
      })
    ).toBe(true)
    applyPiEventTelemetry(
      conversation,
      generation,
      { message: { role: 'assistant' }, type: 'message_start' },
      1_000
    )
    expect(
      applyPiEventTelemetry(
        conversation,
        generation,
        {
          assistantMessageEvent: { contentIndex: 0, delta: 'First', type: 'text_delta' },
          type: 'message_update',
          usage: { output: 0 }
        },
        2_000
      )
    ).toBe(false)
    expect(conversation.contextUsage?.tokensPerSecond).toBeUndefined()
    expect(
      applyPiEventTelemetry(
        conversation,
        generation,
        {
          assistantMessageEvent: { contentIndex: 0, delta: ' second', type: 'text_delta' },
          type: 'message_update',
          usage: { output: 1_000 }
        },
        3_000
      )
    ).toBe(true)
    expect(conversation.contextUsage).toMatchObject({
      tokensPerSecond: 1_000,
      tokensPerSecondBasis: 'streamed-output'
    })
    expect(
      applyPiEventTelemetry(
        conversation,
        generation,
        {
          message: {
            role: 'assistant',
            usage: {
              cacheRead: 72_000,
              cacheWrite: 0,
              input: 8_000,
              output: 2_000,
              totalTokens: 82_000
            }
          },
          type: 'message_end'
        },
        4_000
      )
    ).toBe(true)

    expect(conversation.contextUsage).toEqual({
      autoCompactionEnabled: true,
      cacheHitPercent: 90,
      compacting: false,
      contextWindow: 500_000,
      percent: 16.4,
      tokens: 82_000,
      tokensPerSecond: 1_000,
      tokensPerSecondBasis: 'streamed-output'
    })
  })

  test('hydrates persisted stats and marks completed compaction for recalculation', () => {
    const conversation = thread()
    const generation = timing()
    applyPiStateTelemetry(conversation, {
      autoCompactionEnabled: true,
      model: { contextWindow: 500_000 }
    })

    expect(
      applyPiSessionStats(conversation, {
        contextUsage: { contextWindow: 500_000, percent: 18, tokens: 90_000 },
        tokens: { cacheRead: 80_000, cacheWrite: 0, input: 20_000 }
      })
    ).toBe(true)
    applyPiEventTelemetry(conversation, generation, { type: 'compaction_start' }, 4_000)
    expect(conversation.contextUsage?.compacting).toBe(true)
    applyPiEventTelemetry(
      conversation,
      generation,
      { aborted: false, result: { estimatedTokensAfter: 20_000 }, type: 'compaction_end' },
      5_000
    )

    expect(conversation.contextUsage).toMatchObject({
      cacheHitPercent: 80,
      compacting: false,
      lastCompactedAt: '1970-01-01T00:00:05.000Z',
      percent: null,
      tokens: null
    })
  })

  test('estimates live and completed Antigravity telemetry when the bridge reports zero usage', () => {
    const conversation = thread()
    conversation.model = 'antigravity/gemini-3-7-flash'
    conversation.messages.push({
      createdAt: '2026-08-21T00:00:00.000Z',
      id: 'prompt-1',
      role: 'user',
      text: 'Inspect the selected Board object.'
    })
    const generation = timing()
    applyPiStateTelemetry(conversation, {
      autoCompactionEnabled: true,
      model: { contextWindow: 1_000_000 }
    })

    applyPiEventTelemetry(
      conversation,
      generation,
      { message: { role: 'assistant' }, type: 'message_start' },
      1_000
    )
    applyPiEventTelemetry(
      conversation,
      generation,
      {
        assistantMessageEvent: {
          contentIndex: 0,
          delta: 'Reading the Board and preparing the response.',
          type: 'thinking_delta'
        },
        type: 'message_update'
      },
      2_000
    )

    expect(conversation.contextUsage).toMatchObject({
      contextWindow: 1_000_000,
      tokensEstimated: true
    })
    expect(conversation.contextUsage?.tokens).toBeGreaterThan(0)
    expect(conversation.contextUsage?.tokensPerSecond).toBeUndefined()

    applyPiEventTelemetry(
      conversation,
      generation,
      {
        message: {
          content: [
            { thinking: '[agy tool: view_file]\n', type: 'thinking' },
            { text: 'The Board object is configured.', type: 'text' }
          ],
          provider: 'antigravity',
          role: 'assistant',
          usage: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, totalTokens: 0 }
        },
        type: 'message_end'
      },
      3_000
    )

    expect(conversation.contextUsage).toMatchObject({
      contextWindow: 1_000_000,
      tokensEstimated: true
    })
    expect(conversation.contextUsage?.tokens).toBeGreaterThan(0)
    expect(conversation.contextUsage?.tokensPerSecond).toBeUndefined()
  })

  test('hydrates persisted Antigravity threads that were saved with a frozen zero meter', () => {
    const conversation = thread()
    conversation.model = 'antigravity/gemini-3-7-flash'
    conversation.contextUsage = {
      autoCompactionEnabled: true,
      compacting: false,
      contextWindow: 1_000_000,
      percent: 0,
      tokens: 0
    }
    conversation.messages.push(
      {
        createdAt: '2026-08-21T00:00:00.000Z',
        id: 'prompt-1',
        role: 'user',
        text: 'Inspect the Board.'
      },
      {
        completedAt: '2026-08-21T00:00:04.000Z',
        createdAt: '2026-08-21T00:00:04.000Z',
        id: 'response-1',
        role: 'assistant',
        text: 'The Board is ready.'
      }
    )

    expect(hydrateEstimatedAntigravityTelemetry(conversation)).toBe(true)
    expect(conversation.contextUsage).toMatchObject({ tokensEstimated: true })
    expect(conversation.contextUsage.tokens).toBeGreaterThan(0)
    expect(conversation.contextUsage.tokensPerSecond).toBeUndefined()
  })
})
