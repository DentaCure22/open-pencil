import { describe, expect, test } from 'bun:test'

import {
  clearCodeObjectRuntimeActivity,
  codeObjectRuntimeActivityIntersects,
  publishCodeObjectRuntimeActivity,
  subscribeCodeObjectRuntimeActivity
} from '@/app/code-object/runtime-activity'
import { createEditorStore } from '@/app/editor/session'

describe('Code Object runtime activity', () => {
  test('publishes a deduplicated store-local active frame set', () => {
    const store = createEditorStore()
    let notifications = 0
    const unsubscribe = subscribeCodeObjectRuntimeActivity(store, () => {
      notifications += 1
    })

    expect(codeObjectRuntimeActivityIntersects(store, ['visible'])).toBe(false)
    expect(publishCodeObjectRuntimeActivity(store, new Set(['visible']))).toBe(true)
    expect(codeObjectRuntimeActivityIntersects(store, ['hidden', 'visible'])).toBe(true)
    expect(publishCodeObjectRuntimeActivity(store, new Set(['visible']))).toBe(false)
    expect(clearCodeObjectRuntimeActivity(store)).toBe(true)
    expect(codeObjectRuntimeActivityIntersects(store, ['visible'])).toBe(false)
    expect(notifications).toBe(2)

    unsubscribe()
  })
})
