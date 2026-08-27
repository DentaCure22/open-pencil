import { describe, expect, test } from 'bun:test'

import { computed, ref } from 'vue'

import { useConversationApprovals } from '@/app/agent-chat/conversation-approvals'
import type { AgentConversationThread } from '@/app/agent-chat/conversations'

const requestedAt = '2026-08-26T12:00:01.000Z'

function threadWithMessageApproval(): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-26T12:00:00.000Z',
    effort: 'medium',
    id: 'agent:thread-1',
    messages: [
      {
        createdAt: '2026-08-26T12:00:00.000Z',
        id: 'user-1',
        role: 'user',
        text: 'Send the update'
      }
    ],
    model: 'gpt-5.6-sol',
    nativeThreadId: 'thread-1',
    pendingUiRequests: [
      {
        id: 'approval-1',
        method: 'confirm',
        requestedAt,
        title:
          'Codex wants to run send_message\n\nArguments:\n' +
          JSON.stringify({ recipient_label: 'Ada', text: 'Hello' })
      }
    ],
    recentUpdate: '',
    state: 'needs_attention',
    task: 'Send the update',
    updatedAt: requestedAt
  }
}

function approvalHarness(initialThread = threadWithMessageApproval()) {
  const thread = ref(initialThread)
  const approvals = useConversationApprovals({
    selectedThread: computed(() => thread.value),
    visibleMessages: computed(() => thread.value?.messages ?? [])
  })
  return { approvals, thread }
}

describe('conversation approval ledger', () => {
  test('keeps a generic Bot choice request attached to its user run', async () => {
    const choiceThread = threadWithMessageApproval()
    choiceThread.task = 'Choose how to file the stubs'
    choiceThread.pendingUiRequests = [
      {
        id: 'approval-choice',
        method: 'select',
        options: ['Leave it all', 'File the empty stubs only', 'Move the whole thing into Filed'],
        requestedAt,
        title: 'How should I handle the empty stubs?'
      }
    ]
    const { approvals, thread } = approvalHarness(choiceThread)

    expect(approvals.cardsForRun('user-1')).toEqual([
      {
        key: 'request:approval-choice',
        request: choiceThread.pendingUiRequests[0],
        runId: 'user-1',
        state: 'pending'
      }
    ])
    expect(approvals.hasSurface.value).toBe(true)

    const component = await Bun.file(
      'src/components/agent-chat/AgentConversationApproval.vue'
    ).text()
    expect(component).toContain('v-else-if="request && botTextMode"')
    expect(component).toContain('v-for="(option, index) in choiceOptions"')
    expect(component).toContain("emit('respond', request.id, { value: option })")
    expect(component).toContain(':disabled="busy"')

    thread.value.pendingUiRequests = []
    expect(approvals.cardsForRun('user-1')).toEqual([])
    expect(approvals.hasSurface.value).toBe(false)
  })

  test('groups a pending message approval with the user run and can supersede it', () => {
    const { approvals, thread } = approvalHarness()

    expect(approvals.cardsForRun('user-1')).toMatchObject([
      { key: 'request:approval-1', state: 'pending' }
    ])
    expect(approvals.hasSurface.value).toBe(true)
    expect(approvals.supersedePending(thread.value)).toEqual(['approval-1'])
    expect(approvals.cardsForRun('user-1')).toMatchObject([
      { key: 'feedback:approval-1', state: 'cancelled' }
    ])
  })

  test('reconciles an approved request with the authoritative tool result', () => {
    const { approvals, thread } = approvalHarness()

    expect(approvals.beginResponse(thread.value, 'approval-1', { confirmed: true })).toBe(true)
    expect(approvals.cardsForRun('user-1')).toMatchObject([
      { key: 'feedback:approval-1', state: 'sending' }
    ])

    thread.value.messages.push({
      createdAt: '2026-08-26T12:00:02.000Z',
      id: 'assistant-1',
      parts: [
        {
          input: JSON.stringify({ recipient_label: 'Ada', text: 'Hello' }),
          name: 'send_message',
          state: 'success',
          type: 'tool'
        }
      ],
      role: 'assistant',
      text: ''
    })

    expect(approvals.cardsForRun('user-1')).toMatchObject([
      { key: 'tool:assistant-1:0', state: 'sent' }
    ])
  })
})
