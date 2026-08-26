import { describe, expect, test } from 'bun:test'

describe('agent chat send motion', () => {
  test('smoothly hands a submitted prompt into an otherwise instant live transcript', async () => {
    const conversation = await Bun.file('src/components/ai-elements/AiConversation.vue').text()
    const message = await Bun.file('src/components/ai-elements/AiMessage.vue').text()
    const surface = await Bun.file('src/components/ai-elements/AiConversationSurface.vue').text()

    expect(conversation).toContain("resize: 'instant'")
    expect(conversation).toContain('SEND_SCROLL_SPRING')
    expect(conversation).toContain('smoothResizeActive')
    expect(conversation).toContain('prefers-reduced-motion: reduce')
    expect(surface).toContain("scrollTranscriptToLatest('smooth')")
    expect(message).toContain('agent-prompt-enter')
    expect(message).toContain('prefers-reduced-motion: reduce')
  })
})
