import { describe, expect, test } from 'bun:test'

import {
  createLiveInspectorPreviewScheduler,
  type LiveInspectorPreviewScheduler
} from '@/app/smylr-live-inspector/session'
import type { LiveInspectorPatchDraft } from '@/app/smylr-live-inspector/patch'

function draft(color: string): LiveInspectorPatchDraft {
  return {
    add: [],
    nodeId: 'node-1',
    remove: [],
    styles: { color }
  }
}

function controlledScheduler() {
  const callbacks: Array<() => void> = []
  const posted: LiveInspectorPatchDraft[] = []
  const persisted: LiveInspectorPatchDraft[] = []
  const scheduler: LiveInspectorPreviewScheduler = createLiveInspectorPreviewScheduler(
    (next) => posted.push(next),
    (next) => persisted.push(next),
    (callback) => {
      let active = true
      callbacks.push(() => {
        if (active) callback()
      })
      return () => {
        active = false
      }
    }
  )
  return { callbacks, persisted, posted, scheduler }
}

describe('live inspector preview scheduler', () => {
  test('flushes only the latest draft once per frame and supports an explicit final flush', () => {
    const { callbacks, persisted, posted, scheduler } = controlledScheduler()

    scheduler.schedule(draft('red'))
    scheduler.schedule(draft('blue'))
    expect(posted).toHaveLength(0)
    expect(persisted).toHaveLength(0)

    callbacks[0]?.()
    expect(posted).toHaveLength(1)
    expect(persisted).toHaveLength(1)
    expect(posted[0]?.styles?.color).toBe('blue')
    expect(persisted[0]?.styles?.color).toBe('blue')

    scheduler.schedule(draft('green'))
    expect(scheduler.flush()).toBe(true)
    expect(posted).toHaveLength(2)
    expect(persisted).toHaveLength(2)
    expect(posted[1]?.styles?.color).toBe('green')
    expect(persisted[1]?.styles?.color).toBe('green')

    callbacks[1]?.()
    expect(posted).toHaveLength(2)
    expect(persisted).toHaveLength(2)
  })
})
