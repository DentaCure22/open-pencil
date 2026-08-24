import { describe, expect, test } from 'bun:test'

import { isBenignResizeObserverError, toast } from '@/app/shell/ui'

describe('shell UI errors', () => {
  test('recognizes the browser ResizeObserver loop notifications', () => {
    expect(isBenignResizeObserverError('ResizeObserver loop limit exceeded')).toBe(true)
    expect(
      isBenignResizeObserverError('ResizeObserver loop completed with undelivered notifications.')
    ).toBe(true)
    expect(isBenignResizeObserverError('Maximum update depth exceeded')).toBe(false)
  })

  test('does not queue floating notifications', () => {
    expect(toast.info('Saved')).toBeUndefined()
    expect(toast.warning('Check this')).toBeUndefined()
    expect(toast.error('Something failed')).toBeUndefined()
    expect(Object.hasOwn(toast, 'toasts')).toBe(false)
  })
})
