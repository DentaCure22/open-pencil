import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '@/app/agent-chat/conversations'
import { restoredAgentPanelLocation } from '@/app/agent-chat/panel-history-lifecycle'

function thread(id: string): AgentConversationThread {
  return { id } as AgentConversationThread
}

describe('agent panel history lifecycle', () => {
  test('preserves a valid selection and recovers a stale or empty one', () => {
    expect(
      restoredAgentPanelLocation([thread('agent:first')], {
        selectedId: 'agent:first',
        view: 'conversation'
      })
    ).toEqual({ selectedId: 'agent:first', view: 'conversation' })

    expect(
      restoredAgentPanelLocation([thread('agent:first')], {
        selectedId: 'agent:missing',
        view: 'conversation'
      })
    ).toEqual({ selectedId: 'agent:first', view: 'conversation' })

    expect(
      restoredAgentPanelLocation([], { selectedId: 'agent:missing', view: 'conversation' })
    ).toEqual({ selectedId: null, view: 'list' })
  })
})
