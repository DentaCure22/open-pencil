import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '@/app/agent-chat/client'
import { agentConversationTitle, plainConversationPreview } from '@/app/agent-chat/presentation'

function thread(input: Partial<AgentConversationThread>): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-16T00:00:00.000Z',
    effort: 'medium',
    id: 'thread-1',
    messages: [],
    model: 'xai-auth/grok-4.6',
    nativeThreadId: 'thread-1',
    recentUpdate: '',
    state: 'completed',
    task: 'Agent task',
    updatedAt: '2026-08-16T00:00:00.000Z',
    ...input
  }
}

describe('agent conversation presentation', () => {
  test('uses stable human Board names without chat implementation prefixes', () => {
    expect(
      agentConversationTitle(
        thread({
          task: 'OpenPencil contextual comment\nUser request: move this back to the right corner\nTarget: popover-anchor'
        })
      )
    ).toBe('Move this back to the right corner')
  })

  test('turns Markdown-heavy updates into one bounded task preview', () => {
    expect(
      plainConversationPreview(
        '**Done** | ID | Name |\n|---|---|\n| `0:7655` | [Live Board](https://example.test) |'
      )
    ).toBe('Done ID Name 0:7655 Live Board')
    expect(plainConversationPreview('a'.repeat(100))).toBe(`${'a'.repeat(87)}…`)
  })
})
