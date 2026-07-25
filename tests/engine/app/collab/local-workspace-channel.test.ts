import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { connectLocalWorkspaceChannel } from '@/app/collab/local-workspace-channel'

function waitForValue(map: Y.Map<unknown>, key: string): Promise<unknown> {
  const existing = map.get(key)
  if (existing !== undefined) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      map.unobserve(observer)
      reject(new Error(`Timed out waiting for local workspace value "${key}"`))
    }, 1000)
    const observer = () => {
      const value = map.get(key)
      if (value === undefined) return
      clearTimeout(timeout)
      map.unobserve(observer)
      resolve(value)
    }
    map.observe(observer)
  })
}

describe('local OpenPencil workspace channel', () => {
  test('hydrates an already-open workspace and keeps later changes live', async () => {
    const roomId = `test-${crypto.randomUUID()}`
    const first = new Y.Doc()
    const second = new Y.Doc()
    first.getMap('workspace').set('existing', 'ready')
    const firstChannel = connectLocalWorkspaceChannel(roomId, first)
    const secondChannel = connectLocalWorkspaceChannel(roomId, second)
    if (!firstChannel || !secondChannel) throw new Error('BroadcastChannel is unavailable')

    expect(await waitForValue(second.getMap('workspace'), 'existing')).toBe('ready')
    second.getMap('workspace').set('later', 42)
    expect(await waitForValue(first.getMap('workspace'), 'later')).toBe(42)

    firstChannel.close()
    secondChannel.close()
    first.destroy()
    second.destroy()
  })
})
