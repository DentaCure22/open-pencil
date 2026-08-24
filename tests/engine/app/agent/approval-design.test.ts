import { describe, expect, test } from 'bun:test'

describe('agent approval design contract', () => {
  test('uses a borderless Messages preview and the shared conversation column', async () => {
    const [tokens, approval, panel, prompt, surface] = await Promise.all([
      Bun.file('src/app.css').text(),
      Bun.file('src/components/agent-chat/AgentConversationApproval.vue').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/ai-elements/AiPromptInput.vue').text(),
      Bun.file('src/components/ai-elements/AiConversationSurface.vue').text()
    ])

    expect(tokens).toContain('--color-agent-approval-action: #0a84ff')
    expect(tokens).toContain('--color-agent-approval-action: #007aff')
    expect(tokens).toContain('--spacing-agent-conversation-gutter: 5.5rem')
    expect(tokens).toContain('--spacing-agent-conversation-compact-gutter: 4rem')
    const messageApproval = approval.slice(
      approval.indexOf('<section\n    v-if="message"'),
      approval.indexOf('<section\n    v-else-if="request"')
    )
    expect(messageApproval).toContain('bg-agent-approval-action')
    expect(messageApproval).toContain('data-test-id="agent-message-approval-content"')
    expect(messageApproval).toContain('{{ message.recipient }}')
    expect(messageApproval).toContain('v-for="(text, index) in message.texts"')
    expect(messageApproval).toContain('mt-0.5 flex min-w-0 flex-col items-end gap-1')
    expect(messageApproval).toContain('rounded-br-[5px]')
    expect(messageApproval).toContain('data-test-id="agent-message-approval-actions"')
    expect(messageApproval).toContain('text-agent-approval-action')
    expect(messageApproval).not.toContain('icon-lucide-arrow-up')
    expect(messageApproval).not.toContain('border-agent-approval-border')
    expect(messageApproval).not.toContain('bg-agent-approval-surface')
    expect(approval).not.toContain('bg-accent')
    expect(panel).toContain('data-test-id="agent-approval-column"')
    expect(panel).toContain('<template #approval="{ runId }">')
    expect(panel).toContain('class="flex flex-col gap-2"')
    expect(panel).toContain(':data-run-id="runId"')
    expect(panel).toContain(':status="hasApprovalSurface ? \'ready\' : uiStatus"')
    expect(prompt).toContain('class="agent-conversation-column')
    expect(surface).toContain('class="agent-conversation-column')
    expect(surface).toContain('<slot name="approval" :run-id="run.id" />')
    expect(tokens).toContain('.agent-conversation-column')
  })
})
