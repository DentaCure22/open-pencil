import { describe, expect, test } from 'bun:test'

import {
  parseCodexUsage,
  parseFooter,
  parseGrokUsage,
  parsePiFinalText,
  parsePiUsage
} from '../src/parse'

describe('pi-grok-eval parse', () => {
  test('reads Pi usage from a jsonl turn', () => {
    const line = JSON.stringify({
      message: {
        usage: { cacheRead: 10, cacheWrite: 4, input: 100, output: 20, reasoning: 5, totalTokens: 139 }
      },
      type: 'message_end'
    })
    expect(parsePiUsage(`${line}\n`)).toEqual({
      cacheRead: 10,
      cacheWrite: 4,
      input: 100,
      output: 20,
      reasoning: 5,
      total: 139
    })
  })

  test('reads Grok CLI usage from a json object', () => {
    const stdout = JSON.stringify({
      text: 'PONG',
      usage: {
        cache_read_input_tokens: 128,
        input_tokens: 18000,
        output_tokens: 26,
        reasoning_tokens: 20,
        total_tokens: 18174
      }
    })
    expect(parseGrokUsage(stdout)).toEqual({
      cacheRead: 128,
      cacheWrite: 0,
      input: 18000,
      output: 26,
      reasoning: 20,
      total: 18174
    })
  })

  test('reads Codex usage from a turn.completed event', () => {
    const line = JSON.stringify({
      type: 'turn.completed',
      usage: {
        cached_input_tokens: 100,
        input_tokens: 500,
        output_tokens: 20,
        reasoning_output_tokens: 8
      }
    })
    expect(parseCodexUsage(`${line}\n`)).toEqual({
      cacheRead: 100,
      cacheWrite: 0,
      input: 500,
      output: 20,
      reasoning: 8,
      total: 520
    })
  })

  test('reads Pi final text from message_end and streamed deltas', () => {
    const messageEnd = JSON.stringify({
      message: {
        content: [{ text: 'USED=read\nCODE=lumen-47\nOK=yes', type: 'text' }],
        role: 'assistant'
      },
      type: 'message_end'
    })
    expect(parsePiFinalText(`${messageEnd}\n`)).toBe('USED=read\nCODE=lumen-47\nOK=yes')
    const streamed = [
      JSON.stringify({
        assistantMessageEvent: { delta: 'USED=bash\n', type: 'text_delta' },
        type: 'message_update'
      }),
      JSON.stringify({
        assistantMessageEvent: { delta: 'LINES=4\nOK=yes', type: 'text_delta' },
        type: 'message_update'
      })
    ].join('\n')
    expect(parsePiFinalText(`${streamed}\n`)).toBe('USED=bash\nLINES=4\nOK=yes')
  })

  test('reads task footer lines', () => {
    expect(parseFooter('USED=read\nCODE=lumen-47\nOK=yes')).toEqual({
      code: 'lumen-47',
      edit: null,
      file: null,
      lines: null,
      name: null,
      ok: true,
      used: 'read',
      write: null
    })
  })
})
