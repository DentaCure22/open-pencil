import { describe, expect, test } from 'bun:test'

import { createAgentWorkMapRequestId } from '@/app/agent-chat/work-map-persistence'

describe('Work Map persistence', () => {
  test('creates non-empty request identities for idempotent mutations', () => {
    const first = createAgentWorkMapRequestId()
    const second = createAgentWorkMapRequestId()

    expect(first.length).toBeGreaterThan(0)
    expect(second.length).toBeGreaterThan(0)
    expect(first).not.toBe(second)
  })
})
