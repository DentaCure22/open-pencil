import { describe, expect, test } from 'bun:test'

import {
  AGENT_MESSAGE_REACTIONS,
  agentMessageReactionKey,
  agentMessageReactionLabel
} from '@/app/agent-chat/message-reactions'

describe('agent message reactions', () => {
  test('uses stable semantic reaction kinds for future channel adapters', () => {
    expect(AGENT_MESSAGE_REACTIONS).toEqual(['like', 'love', 'smile'])
    expect(AGENT_MESSAGE_REACTIONS.map(agentMessageReactionLabel)).toEqual([
      'Like',
      'Love',
      'Smile'
    ])
  })

  test('scopes reaction state to both the conversation and message', () => {
    expect(agentMessageReactionKey('thread-1', 'message-1')).toBe('["thread-1","message-1"]')
    expect(agentMessageReactionKey('thread-2', 'message-1')).toBe('["thread-2","message-1"]')
    expect(agentMessageReactionKey(undefined, 'message-1')).toBe('[null,"message-1"]')
  })

  test('cannot collide when either identifier contains a separator', () => {
    expect(agentMessageReactionKey('thread:1', 'message-1')).not.toBe(
      agentMessageReactionKey('thread', '1:message-1')
    )
  })
})
