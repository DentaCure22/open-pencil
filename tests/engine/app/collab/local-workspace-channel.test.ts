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

function waitForExpectedValue(
  map: Y.Map<unknown>,
  key: string,
  expected: unknown
): Promise<unknown> {
  if (map.get(key) === expected) return Promise.resolve(expected)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      map.unobserve(observer)
      reject(new Error(`Timed out waiting for local workspace value "${key}"`))
    }, 1000)
    const observer = () => {
      const value = map.get(key)
      if (value !== expected) return
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

    expect(
      await firstChannel.bootstrap(() => first.getMap('workspace').set('seeded', true), 5)
    ).toBe('seeded')
    expect(await secondChannel.bootstrap()).toBe('peer')

    expect(await waitForValue(second.getMap('workspace'), 'existing')).toBe('ready')
    expect(second.getMap('workspace').get('seeded')).toBe(true)
    second.getMap('workspace').set('later', 42)
    expect(await waitForValue(first.getMap('workspace'), 'later')).toBe(42)

    firstChannel.close()
    secondChannel.close()
    first.destroy()
    second.destroy()
  })

  test('lets only the persistence writer seed simultaneous cold-start clients', async () => {
    const roomId = `test-${crypto.randomUUID()}`
    const writer = new Y.Doc()
    const follower = new Y.Doc()
    const writerChannel = connectLocalWorkspaceChannel(roomId, writer)
    const followerChannel = connectLocalWorkspaceChannel(roomId, follower)
    if (!writerChannel || !followerChannel) throw new Error('BroadcastChannel is unavailable')

    const followerReady = followerChannel.bootstrap()
    const writerReady = writerChannel.bootstrap(
      () => writer.getMap('workspace').set('geometry', 'canonical'),
      5
    )

    expect(await writerReady).toBe('seeded')
    expect(await followerReady).toBe('peer')
    expect(follower.getMap('workspace').get('geometry')).toBe('canonical')

    writerChannel.close()
    followerChannel.close()
    writer.destroy()
    follower.destroy()
  })

  test('elects one seed when simultaneous authority-backed clients are both seed-capable', async () => {
    const roomId = `test-${crypto.randomUUID()}`
    const first = new Y.Doc()
    const second = new Y.Doc()
    const firstChannel = connectLocalWorkspaceChannel(roomId, first)
    const secondChannel = connectLocalWorkspaceChannel(roomId, second)
    if (!firstChannel || !secondChannel) throw new Error('BroadcastChannel is unavailable')
    let seedCount = 0

    const [firstResult, secondResult] = await Promise.all([
      firstChannel.bootstrap(() => {
        seedCount += 1
        const node = new Y.Map<unknown>()
        node.set('x', 10)
        first.getMap<Y.Map<unknown>>('nodes').set('node-1', node)
      }, 5),
      secondChannel.bootstrap(() => {
        seedCount += 1
        const node = new Y.Map<unknown>()
        node.set('x', 20)
        second.getMap<Y.Map<unknown>>('nodes').set('node-1', node)
      }, 5)
    ])

    expect([firstResult, secondResult].sort((left, right) => left.localeCompare(right))).toEqual([
      'peer',
      'seeded'
    ])
    expect(seedCount).toBe(1)
    const firstNode = first.getMap<Y.Map<unknown>>('nodes').get('node-1')
    const secondNode = second.getMap<Y.Map<unknown>>('nodes').get('node-1')
    expect(firstNode).toBeDefined()
    expect(secondNode).toBeDefined()
    if (!firstNode || !secondNode) throw new Error('Elected seed did not hydrate both clients')

    firstNode.set('x', 42)
    expect(await waitForExpectedValue(secondNode, 'x', 42)).toBe(42)
    secondNode.set('y', 84)
    expect(await waitForExpectedValue(firstNode, 'y', 84)).toBe(84)

    firstChannel.close()
    secondChannel.close()
    first.destroy()
    second.destroy()
  })

  test('hydrates a seedless follower when the exclusive writer starts later', async () => {
    const roomId = `test-${crypto.randomUUID()}`
    const follower = new Y.Doc()
    const followerChannel = connectLocalWorkspaceChannel(roomId, follower)
    if (!followerChannel) throw new Error('BroadcastChannel is unavailable')

    const followerReady = followerChannel.bootstrap(undefined, 5)
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20)
    })

    const writer = new Y.Doc()
    const writerChannel = connectLocalWorkspaceChannel(roomId, writer)
    if (!writerChannel) throw new Error('BroadcastChannel is unavailable')
    const writerReady = writerChannel.bootstrap(
      () => writer.getMap('workspace').set('geometry', 'canonical'),
      5
    )

    expect(await writerReady).toBe('seeded')
    expect(await followerReady).toBe('peer')
    expect(follower.getMap('workspace').get('geometry')).toBe('canonical')

    writerChannel.close()
    followerChannel.close()
    writer.destroy()
    follower.destroy()
  })

  test('closes a waiting seedless follower without promoting it', async () => {
    const roomId = `test-${crypto.randomUUID()}`
    const follower = new Y.Doc()
    const followerChannel = connectLocalWorkspaceChannel(roomId, follower)
    if (!followerChannel) throw new Error('BroadcastChannel is unavailable')

    const followerReady = followerChannel.bootstrap(undefined, 5)
    followerChannel.close()

    expect(await followerReady).toBe('closed')
    expect(follower.getMap('workspace').size).toBe(0)
    follower.destroy()
  })

  test('carries drag previews without writing them into the durable Yjs document', async () => {
    const roomId = `test-${crypto.randomUUID()}`
    const first = new Y.Doc()
    const second = new Y.Doc()
    const firstChannel = connectLocalWorkspaceChannel(roomId, first)
    const secondChannel = connectLocalWorkspaceChannel(roomId, second)
    if (!firstChannel || !secondChannel) throw new Error('BroadcastChannel is unavailable')
    await firstChannel.bootstrap(() => first.getMap('workspace').set('seeded', true), 5)
    await secondChannel.bootstrap()

    const received = new Promise((resolve) => {
      secondChannel.subscribeDragPreview(resolve)
    })
    firstChannel.publishDragPreview({
      gestureId: 'gesture-1',
      nodeId: 'node-1',
      pageId: 'page-1',
      phase: 'active',
      sequence: 1,
      x: 120,
      y: 240
    })

    expect(await received).toMatchObject({
      gestureId: 'gesture-1',
      sessionId: firstChannel.sessionId,
      x: 120,
      y: 240
    })
    expect(first.getMap('drag-previews').size).toBe(0)
    expect(second.getMap('drag-previews').size).toBe(0)

    firstChannel.close()
    secondChannel.close()
    first.destroy()
    second.destroy()
  })
})
