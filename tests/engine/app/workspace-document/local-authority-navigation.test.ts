import { describe, expect, test } from 'bun:test'

import type {
  LocalWorkspaceAuthorityStatus,
  LocalWorkspaceNavigationIntent
} from '@/app/workspace-document/local-authority/client'
import { createLocalWorkspaceNavigationConsumer } from '@/app/workspace-document/local-authority/navigation'

function status(): LocalWorkspaceAuthorityStatus {
  return {
    authorityId: 'authority:1',
    contentHash: 'content-hash',
    identity: {
      documentId: 'document:1',
      documentName: 'OpenPencil Workspace',
      roomId: 'room:1',
      schemaVersion: 1,
      workspaceId: 'workspace:1'
    },
    revision: 4,
    seedWorkspaceId: 'workspace:1',
    state: 'ready',
    updatedAt: '2026-07-30T12:00:00.000Z',
    version: 1
  }
}

function intent(overrides: Partial<LocalWorkspaceNavigationIntent> = {}) {
  return {
    authorityId: 'authority:1',
    consumedAt: null,
    contentDocumentId: 'document:1',
    createdAt: '2026-07-30T12:00:00.000Z',
    expiresAt: '2026-07-30T12:01:00.000Z',
    intentId: 'intent:1',
    pageId: 'page:target',
    sequence: 1,
    version: 1,
    workspaceId: 'workspace:1',
    ...overrides
  } satisfies LocalWorkspaceNavigationIntent
}

describe('local workspace navigation consumer', () => {
  test('opens the exact page and consumes the matching intent once', async () => {
    let pageId = 'page:source'
    const opened: string[] = []
    const consumed: string[] = []
    const consumer = createLocalWorkspaceNavigationConsumer({
      consumeIntent: async (intentId) => {
        consumed.push(intentId)
        return true
      },
      currentAuthority: status,
      currentPageId: () => pageId,
      currentRuntimeInstanceId: () => 'runtime:target',
      openPage: async (nextPageId) => {
        opened.push(nextPageId)
        pageId = nextPageId
        return true
      },
      readIntent: async () => intent()
    })

    await expect(consumer.consumePending()).resolves.toBe(true)
    expect(opened).toEqual(['page:target'])
    expect(consumed).toEqual(['intent:1'])
  })

  test('leaves a mismatched or unavailable intent unconsumed', async () => {
    let consumeCalls = 0
    let openCalls = 0
    const consumer = createLocalWorkspaceNavigationConsumer({
      consumeIntent: async () => {
        consumeCalls += 1
        return true
      },
      currentAuthority: status,
      currentPageId: () => 'page:source',
      currentRuntimeInstanceId: () => 'runtime:target',
      openPage: async () => {
        openCalls += 1
        return true
      },
      readIntent: async () => intent({ workspaceId: 'workspace:other' })
    })

    await expect(consumer.consumePending()).resolves.toBe(false)
    expect(openCalls).toBe(0)
    expect(consumeCalls).toBe(0)
  })

  test('coalesces overlapping polls into one open operation', async () => {
    let pageId = 'page:source'
    let resolveOpen: (() => void) | undefined
    let openCalls = 0
    const consumer = createLocalWorkspaceNavigationConsumer({
      consumeIntent: async () => true,
      currentAuthority: status,
      currentPageId: () => pageId,
      currentRuntimeInstanceId: () => 'runtime:target',
      openPage: async (nextPageId) => {
        openCalls += 1
        await new Promise<void>((resolve) => {
          resolveOpen = resolve
        })
        pageId = nextPageId
        return true
      },
      readIntent: async () => intent()
    })

    const first = consumer.consumePending()
    const second = consumer.consumePending()
    await Promise.resolve()
    resolveOpen?.()
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(openCalls).toBe(1)
  })

  test('only the selected editor runtime consumes a targeted intent', async () => {
    let consumeCalls = 0
    let openCalls = 0
    const consumer = createLocalWorkspaceNavigationConsumer({
      consumeIntent: async () => {
        consumeCalls += 1
        return true
      },
      currentAuthority: status,
      currentPageId: () => 'page:source',
      currentRuntimeInstanceId: () => 'runtime:other',
      openPage: async () => {
        openCalls += 1
        return true
      },
      readIntent: async () => intent({ runtimeInstanceId: 'runtime:target' })
    })

    await expect(consumer.consumePending()).resolves.toBe(false)
    expect(openCalls).toBe(0)
    expect(consumeCalls).toBe(0)
  })
})
