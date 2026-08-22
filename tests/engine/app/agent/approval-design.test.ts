import { describe, expect, test } from 'bun:test'

describe('agent approval design contract', () => {
  test('uses neutral theme tokens and the shared conversation column', async () => {
    const [tokens, approval, panel, prompt, surface] = await Promise.all([
      Bun.file('src/app.css').text(),
      Bun.file('src/components/agent-chat/AgentConversationApproval.vue').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/ai-elements/AiPromptInput.vue').text(),
      Bun.file('src/components/ai-elements/AiConversationSurface.vue').text()
    ])

    expect(tokens).toContain('--color-agent-approval-action: #626a76')
    expect(tokens).toContain('--color-agent-approval-action: #747b86')
    expect(tokens).toContain('--spacing-agent-conversation-gutter: 5.5rem')
    expect(tokens).toContain('--spacing-agent-conversation-compact-gutter: 4rem')
    expect(approval).toContain('bg-agent-approval-action')
    expect(approval).not.toContain('bg-accent')
    expect(panel).toContain('data-test-id="agent-approval-column"')
    expect(panel).toContain('class="agent-conversation-column flex flex-col gap-2 pb-3"')
    expect(prompt).toContain('class="agent-conversation-column')
    expect(surface).toContain('class="agent-conversation-column')
    expect(tokens).toContain('.agent-conversation-column')
  })
})
