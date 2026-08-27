import { describe, expect, test } from 'bun:test'

import { botPresencePhase } from '@/components/ai-elements/bot-presence'
import type { ConversationRun } from '@/components/ai-elements/conversation-runs'

function run(overrides: Partial<ConversationRun> = {}): ConversationRun {
  return {
    activity: [],
    boardChanges: [],
    id: 'run:1',
    missingResponse: false,
    visible: [],
    ...overrides
  }
}

describe('Bot presence', () => {
  test('starts by thinking and reports active reasoning', () => {
    expect(botPresencePhase(run())).toBe('thinking')
    expect(
      botPresencePhase(
        run({
          activity: [
            {
              createdAt: '2026-08-27T00:00:00.000Z',
              id: 'reasoning:1',
              parts: [{ state: 'streaming', text: 'Considering the request', type: 'reasoning' }],
              role: 'assistant',
              text: ''
            }
          ]
        })
      )
    ).toBe('thinking')
  })

  test('reports tool and commentary activity as working', () => {
    expect(
      botPresencePhase(
        run({
          activity: [
            {
              createdAt: '2026-08-27T00:00:00.000Z',
              id: 'tool:1',
              parts: [{ name: 'imagegen', state: 'running', type: 'tool' }],
              role: 'assistant',
              text: ''
            }
          ]
        })
      )
    ).toBe('working')
    expect(
      botPresencePhase(
        run({
          activity: [
            {
              createdAt: '2026-08-27T00:00:00.000Z',
              id: 'commentary:1',
              parts: [{ state: 'streaming', text: 'Making the image', type: 'commentary' }],
              role: 'assistant',
              text: ''
            }
          ]
        })
      )
    ).toBe('working')
  })

  test('reports an unfinished answer as typing', () => {
    expect(
      botPresencePhase(
        run({
          visible: [
            {
              createdAt: '2026-08-27T00:00:00.000Z',
              id: 'answer:1',
              role: 'assistant',
              text: 'Here is the result'
            }
          ]
        })
      )
    ).toBe('typing')
  })
})
