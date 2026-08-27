import { describe, expect, test } from 'bun:test'

import { createConversationScrollMemory } from '@/app/agent-chat/conversation-scroll-memory'

describe('conversation scroll memory', () => {
  test('keeps an independent position for each conversation', () => {
    const memory = createConversationScrollMemory()
    memory.remember('thread-1', 240)
    memory.remember('thread-2', 920)

    expect(memory.read('thread-1')).toBe(240)
    expect(memory.read('thread-2')).toBe(920)
    expect(memory.read('thread-3')).toBeUndefined()
  })
})
