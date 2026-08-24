import { describe, expect, test } from 'bun:test'

describe('agent conversation context menu contract', () => {
  test('shares one complete right-click menu across sidebar rows, the open task, and Board chats', async () => {
    const [menu, sidebar, board] = await Promise.all([
      Bun.file('src/components/agent-chat/AgentConversationContextMenu.vue').text(),
      Bun.file('src/components/agent-chat/AgentChatsPanel.vue').text(),
      Bun.file('src/components/agent-terminal/AgentConversationBoardSurface.vue').text()
    ])

    expect(menu).toContain('data-test-id="agent-conversation-context-menu"')
    expect(menu).toContain('data-test-id="agent-conversation-pin"')
    expect(menu).toContain('data-test-id="agent-conversation-rename"')
    expect(menu).toContain('data-test-id="agent-conversation-unread"')
    expect(menu).toContain('data-test-id="agent-conversation-archive"')
    expect(menu).toContain('data-test-id="agent-conversation-compact-fork"')
    expect(menu).toContain('data-test-id="agent-conversation-fork"')
    expect(menu).toContain('data-test-id="agent-conversation-share"')
    expect(menu).toContain('data-test-id="agent-conversation-copy"')
    expect(menu).toContain('data-test-id="agent-conversation-copy-chat"')
    expect(menu).toContain('data-test-id="agent-conversation-copy-response"')
    expect(menu).toContain('data-test-id="agent-conversation-copy-id"')
    expect(menu).toContain('<ContextMenuSub>')
    expect(menu).toContain('getAgentConversation(thread.nativeThreadId)')
    expect(menu).toContain('navigator.share({ text, title: title.value })')
    expect(menu).toContain("'w-[196px] rounded-[10px]")
    expect(menu).toContain("item: 'h-7 rounded-[6px]")
    expect(menu).toContain("icon: 'size-3.5")
    expect(sidebar.match(/<AgentConversationContextMenu/g)).toHaveLength(2)
    expect(sidebar).toContain('data-test-id="agent-thread-archive-toggle"')
    expect(board).toContain('<AgentConversationContextMenu :thread="thread">')
  })
})
