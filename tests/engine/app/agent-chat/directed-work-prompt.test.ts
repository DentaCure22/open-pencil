import { describe, expect, test } from 'bun:test'

import { composeDirectedWorkPrompt } from '@/app/agent-chat/directed-work-prompt'

describe('directed work prompt', () => {
  test('keeps the user’s words and named target', () => {
    const comment = composeDirectedWorkPrompt({
      exactWords: 'move this to the right please',
      namedTargetLines: ['Target: popover-anchor (/patients)']
    })

    expect(comment).toBe('move this to the right please\n\nTarget: popover-anchor (/patients)')
    expect(comment).not.toContain('Authority:')
    expect(comment).not.toContain('Honesty rule')
  })
})
