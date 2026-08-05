import { describe, expect, test } from 'bun:test'

import { shouldAllowConcurrentLocalWorkspaceWriters } from '@/app/workspace-document/local-authority/mode'

describe('local workspace authority mode', () => {
  test.each(['configured', 'ready'] as const)(
    'allows concurrent browser writers when HTTP authority is %s',
    (state) => {
      expect(shouldAllowConcurrentLocalWorkspaceWriters({ state })).toBe(true)
    }
  )

  test('retains an exclusive browser writer lease when HTTP authority is unavailable', () => {
    expect(shouldAllowConcurrentLocalWorkspaceWriters(null)).toBe(false)
  })
})
