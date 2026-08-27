import { describe, expect, test } from 'bun:test'

import { computed, ref } from 'vue'

import { useConversationTitleRename } from '@/app/agent-chat/conversation-title-rename'
import type { AgentConversationThread } from '@/app/agent-chat/conversations'
import { agentConversationDisplayTitle } from '@/app/agent-chat/thread-preferences'

function thread(): AgentConversationThread {
  const id = crypto.randomUUID()
  return {
    canFollowUp: true,
    createdAt: '2026-08-26T12:00:00.000Z',
    effort: 'medium',
    id: `agent:${id}`,
    messages: [],
    model: 'gpt-5.6-sol',
    nativeThreadId: id,
    pendingUiRequests: [],
    recentUpdate: '',
    state: 'completed',
    task: 'Original task',
    title: 'Original task',
    updatedAt: '2026-08-26T12:00:00.000Z'
  }
}

describe('conversation title rename', () => {
  test('starts from the display title and commits one trimmed name', () => {
    const selected = ref<AgentConversationThread | null>(thread())
    const rename = useConversationTitleRename(computed(() => selected.value))

    rename.beginTitleRename()
    expect(rename.renamingTitle.value).toBeTrue()
    expect(rename.renamingTitleDraft.value).toBe('Original task')

    rename.renamingTitleDraft.value = '  Clearer task  '
    rename.commitTitleRename()
    expect(rename.renamingTitle.value).toBeFalse()
    expect(agentConversationDisplayTitle(selected.value as AgentConversationThread)).toBe(
      'Clearer task'
    )
  })
})
