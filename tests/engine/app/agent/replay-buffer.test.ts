import { describe, expect, test } from 'bun:test'

import {
  LOADED_TRANSCRIPT_FULL_TURN_LIMIT,
  boundLoadedTranscript
} from '@/app/agent-chat/replay-buffer'
import type { AiMessage } from '@/app/agent-chat/types'

function turn(index: number, output: string): AiMessage[] {
  return [
    {
      createdAt: `2026-08-23T12:0${String(index)}:00.000Z`,
      id: `user-${String(index)}`,
      role: 'user',
      text: `Prompt ${String(index)}`
    },
    {
      createdAt: `2026-08-23T12:0${String(index)}:10.000Z`,
      id: `assistant-${String(index)}`,
      parts: [
        {
          name: 'read',
          output,
          state: 'success',
          type: 'tool'
        }
      ],
      role: 'assistant',
      text: `Answer ${String(index)}`
    }
  ]
}

describe('loaded transcript replay buffer', () => {
  test('clips leftover tool dumps older than the live turns', () => {
    const fat = `HEAD${'x'.repeat(8_000)}TAIL`
    const messages = [...turn(1, fat), ...turn(2, fat), ...turn(3, fat)]
    const bounded = boundLoadedTranscript(messages)
    const first = bounded[1]?.parts?.[0]
    const live = bounded[bounded.length - 1]?.parts?.[0]

    expect(LOADED_TRANSCRIPT_FULL_TURN_LIMIT).toBe(2)
    expect(first && 'output' in first ? String(first.output) : '').toContain('\n…\n')
    expect(first && 'output' in first ? String(first.output) : '').toContain('HEAD')
    expect(first && 'output' in first ? String(first.output) : '').toContain('TAIL')
    expect(live && 'output' in live ? String(live.output) : '').toBe(fat)
    expect(first && 'output' in first ? String(first.output).length : 0).toBeLessThan(fat.length)
  })
})
