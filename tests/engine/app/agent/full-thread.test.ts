import { describe, expect, test } from 'bun:test'

describe('open conversation transcript', () => {
  test('loads the whole thread instead of showing an earlier-messages pager', async () => {
    const history = await Bun.file('src/app/agent-chat/history-store.ts').text()
    const surface = await Bun.file('src/components/ai-elements/AiConversationSurface.vue').text()

    expect(history).toContain('getAgentConversation(')
    expect(history).toContain('fullConversationPage')
    expect(history).toContain('completeOpenTranscript')
    expect(history).toContain('hasOlder: false')
    expect(surface).not.toContain('ai-conversation-load-older')
    expect(surface).not.toContain('Earlier messages')
    expect(surface).toContain(':can-load-older="hasOlder"')
  })
})
