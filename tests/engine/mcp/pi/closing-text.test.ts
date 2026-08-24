import { describe, expect, test } from 'bun:test'

import { FALLBACK_PI_MODELS } from '#mcp/pi/catalog'
import {
  closingTextForFamily,
  closingTextFromAssistantMessage,
  isConfiguredClosingModel,
  piClosingFamily
} from '#mcp/pi/closing-text'

describe('Pi closing capture', () => {
  test('configures every enabled catalog model to a known family', () => {
    expect(new Set(FALLBACK_PI_MODELS.map((model) => model.id))).toEqual(
      new Set([
        'antigravity/gemini-3-1-pro',
        'antigravity/gemini-3-7-flash',
        'cursor/composer-2.5-fast',
        'cursor/cursor-grok-4.6-fast',
        'openai-codex/gpt-5.6-luna',
        'openai-codex/gpt-5.6-sol',
        'openai-codex/gpt-5.6-terra',
        'xai-auth/grok-4.6',
        'xai-auth/grok-composer-2.5-fast'
      ])
    )
    expect(
      new Set(FALLBACK_PI_MODELS.map((model) => piClosingFamily(undefined, model.id)))
    ).toEqual(new Set(['antigravity', 'cursor-xai', 'openai-codex']))
    for (const model of FALLBACK_PI_MODELS) {
      expect(isConfiguredClosingModel(model.id)).toBe(true)
    }
  })

  test('takes the last unphased stop text for Cursor and xAI', () => {
    const message = {
      content: [
        { thinking: 'Checking the header.', type: 'thinking' },
        { text: 'The New task button is in.', type: 'text' }
      ],
      provider: 'cursor',
      role: 'assistant',
      stopReason: 'stop'
    }
    expect(closingTextFromAssistantMessage(message, 'cursor/cursor-grok-4.6-fast')).toBe(
      'The New task button is in.'
    )
    expect(
      closingTextFromAssistantMessage({ ...message, provider: 'xai-auth' }, 'xai-auth/grok-4.6')
    ).toBe('The New task button is in.')
    expect(closingTextFromAssistantMessage({ ...message, content: [], stopReason: 'stop' })).toBe(
      ''
    )
  })

  test('prefers final_answer over earlier commentary for every login family', () => {
    for (const [provider, model] of [
      ['openai-codex', 'openai-codex/gpt-5.6-sol'],
      ['cursor', 'cursor/cursor-grok-4.6-fast'],
      ['xai-auth', 'xai-auth/grok-4.6'],
      ['antigravity', 'antigravity/gemini-3-7-flash']
    ] as const) {
      expect(
        closingTextFromAssistantMessage(
          {
            content: [
              {
                text: 'I will inspect the header.',
                textSignature: JSON.stringify({ id: 'msg-1', phase: 'commentary', v: 1 }),
                type: 'text'
              },
              {
                text: 'The spinner replaced the status dot.',
                textSignature: JSON.stringify({ id: 'msg-2', phase: 'final_answer', v: 1 }),
                type: 'text'
              }
            ],
            provider,
            role: 'assistant',
            stopReason: 'stop'
          },
          model
        )
      ).toBe('The spinner replaced the status dot.')
    }
  })

  test('prefers OpenAI Codex final_answer over earlier commentary', () => {
    expect(
      closingTextFromAssistantMessage(
        {
          content: [
            { thinking: 'Planning the edit.', type: 'thinking' },
            {
              text: 'I will inspect the header.',
              textSignature: JSON.stringify({ id: 'msg-1', phase: 'commentary', v: 1 }),
              type: 'text'
            },
            {
              text: 'The spinner replaced the status dot.',
              textSignature: JSON.stringify({ id: 'msg-2', phase: 'final_answer', v: 1 }),
              type: 'text'
            }
          ],
          provider: 'openai-codex',
          role: 'assistant',
          stopReason: 'stop'
        },
        'openai-codex/gpt-5.6-sol'
      )
    ).toBe('The spinner replaced the status dot.')
  })

  test('falls back to the last Codex text when the close is unphased or commentary-tagged', () => {
    expect(
      closingTextForFamily('openai-codex', [
        { phase: 'commentary', text: 'Working.' },
        { text: 'Done. The button is in.' }
      ])
    ).toBe('Done. The button is in.')
    expect(
      closingTextFromAssistantMessage({
        content: [
          {
            text: 'The button is in.',
            textSignature: JSON.stringify({ id: 'msg-final', phase: 'commentary', v: 1 }),
            type: 'text'
          }
        ],
        provider: 'openai-codex',
        role: 'assistant',
        stopReason: 'stop'
      })
    ).toBe('The button is in.')
  })

  test('keeps only the last Antigravity text when one stop concatenates earlier wrap-ups', () => {
    expect(
      closingTextFromAssistantMessage(
        {
          content: [
            { thinking: 'First wrap-up.', type: 'thinking' },
            { text: 'Apple Stock chart is ready.', type: 'text' },
            { thinking: 'Second wrap-up.', type: 'thinking' },
            { text: 'The Smylr Market report is on the Board.', type: 'text' }
          ],
          provider: 'antigravity',
          role: 'assistant',
          stopReason: 'stop'
        },
        'antigravity/gemini-3-7-flash'
      )
    ).toBe('The Smylr Market report is on the Board.')
  })

  test('ignores tool turns and empty aborted stops', () => {
    expect(
      closingTextFromAssistantMessage({
        content: [
          { text: 'I will inspect it.', type: 'text' },
          { id: 'call-1', name: 'read', type: 'toolCall' }
        ],
        role: 'assistant',
        stopReason: 'toolUse'
      })
    ).toBe('')
    expect(
      closingTextFromAssistantMessage({
        content: [],
        role: 'assistant',
        stopReason: 'aborted'
      })
    ).toBe('')
  })
})
