import { describe, expect, test } from 'bun:test'

import { agentConversationContextPrompt } from '@/app/agent-chat/bot-setup'

describe('new Bot self-configuration context', () => {
  test('adds a compact question structure only for a new Bot', () => {
    const context = agentConversationContextPrompt({ configuringBot: true })

    expect(context).toContain('persistent OpenPencil Bot')
    expect(context).toContain('ask only the necessary setup questions')
    expect(context).toContain('never exceed three')
    expect(context).toContain('1. **Scope**')
    expect(context).toContain('You can answer in one line.')
    expect(context).toContain('A Bot may have no schedule')
    expect(context).toContain('briefing Code Object')
  })

  test('preserves captured context after the Bot setup instruction', () => {
    const context = agentConversationContextPrompt({
      browserContext: 'Selected Board evidence',
      configuringBot: true
    })

    expect(context?.endsWith('Selected Board evidence')).toBe(true)
  })

  test('leaves an ordinary new chat unchanged', () => {
    expect(agentConversationContextPrompt({ configuringBot: false })).toBeUndefined()
    expect(
      agentConversationContextPrompt({
        browserContext: 'Selected Board evidence',
        configuringBot: false
      })
    ).toBe('Selected Board evidence')
  })
})
