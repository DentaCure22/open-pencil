import { describe, expect, test } from 'bun:test'

import { isBenignResizeObserverError } from '@/app/shell/ui'

describe('shell UI errors', () => {
  test('recognizes the browser ResizeObserver loop notifications', () => {
    expect(isBenignResizeObserverError('ResizeObserver loop limit exceeded')).toBe(true)
    expect(
      isBenignResizeObserverError('ResizeObserver loop completed with undelivered notifications.')
    ).toBe(true)
    expect(isBenignResizeObserverError('Maximum update depth exceeded')).toBe(false)
  })
})
