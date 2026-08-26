import { describe, expect, test } from 'bun:test'

import {
  AGENT_MODELS,
  conversationModel,
  conversationSelection,
  seedConversationModel
} from '@/app/agent-chat/models'

describe('agent model catalog', () => {
  test('leaves the initial selection to the server catalog', () => {
    const scope = 'test:provider-neutral-initial-selection'

    expect(AGENT_MODELS).toEqual([])
    expect(conversationModel(scope)).toMatchObject({ id: '', label: 'Model' })
    expect(conversationSelection(scope)).toEqual({})
  })

  test('preserves a thread selection seeded before the catalog loads', () => {
    const scope = 'test:seed-before-catalog'

    seedConversationModel(scope, 'openai-codex/gpt-5.6-sol', 'max')

    expect(conversationSelection(scope)).toEqual({
      effort: 'max',
      model: 'openai-codex/gpt-5.6-sol'
    })
  })
})
