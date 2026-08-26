import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '@/app/agent-chat/conversations'
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

  test('titles chrome-selection capture filenames as Screenshot', () => {
    expect(
      agentConversationTitle(
        thread({ task: 'chrome-selection-0a5853f5-686b-4990-bea8-f722f2f46b36.png' })
      )
    ).toBe('Screenshot')
  })

  test('titles macOS Screenshot dated filenames as Screenshot', () => {
    expect(
      agentConversationTitle(thread({ task: 'Screenshot 2026-08-23 at 9.02.25 AM.png' }))
    ).toBe('Screenshot')
  })

  test('titles a generic image filename such as notes.png as Image', () => {
    expect(agentConversationTitle(thread({ task: 'hello.png' }))).toBe('Image')
    expect(agentConversationTitle(thread({ task: 'notes.png' }))).toBe('Image')
  })

  test('keeps real prompt text such as Move this card', () => {
    expect(agentConversationTitle(thread({ task: 'Move this card' }))).toBe('Move this card')
  })

  test('prefers a generated semantic title over the provisional prompt title', () => {
    expect(
      agentConversationTitle(
        thread({ task: 'how can we get summarized names for chats', title: 'Generate chat titles' })
      )
    ).toBe('Generate chat titles')
  })

  test('titles comma-joined capture filenames as Screenshot', () => {
    expect(
      agentConversationTitle(
        thread({
          task: 'chrome-selection-0a5853f5-686b-4990-bea8-f722f2f46b36.png, Screenshot 2026-08-23 at 9.02.25 AM.png'
        })
      )
    ).toBe('Screenshot')
  })

  test('titles multiple generic image filenames as N images', () => {
    expect(agentConversationTitle(thread({ task: 'hello.png, notes.webp' }))).toBe('2 images')
  })
})
