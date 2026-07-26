import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { base64ToBytes, bytesToBase64 } from '@/app/collab/persistence/base64'
import { connectDurableYjsProvider } from '@/app/collab/persistence/provider'
import type {
  DurableYjsOutbox,
  DurableYjsDocumentState,
  DurableYjsPendingUpdate,
  DurableYjsStore,
  DurableYjsUpdate,
  DurableYjsUpdateListener
} from '@/app/collab/persistence/types'

class MemoryDurableStore implements DurableYjsStore {
  appended: DurableYjsUpdate[] = []
  listener: DurableYjsUpdateListener | null = null
  sequence = 0

  constructor(private readonly state: DurableYjsDocumentState) {
    this.sequence = Math.max(
      state.snapshotSequence,
      ...state.updates.map((update) => update.sequence)
    )
  }

  async append(clientUpdateId: string, data: Uint8Array) {
    const update = { clientUpdateId, data, sequence: (this.sequence += 1) }
    this.appended.push(update)
    return update
  }

  async checkpoint() {
    return true
  }

  async load() {
    return this.state
  }

  async subscribe(listener: DurableYjsUpdateListener) {
    this.listener = listener
    return async () => {
      this.listener = null
    }
  }
}

class AbortableDurableStore implements DurableYjsStore {
  async append() {
    throw new Error('Unexpected append')
  }

  async checkpoint() {
    return false
  }

  load(signal?: AbortSignal): Promise<DurableYjsDocumentState> {
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }

  async subscribe() {
    throw new Error('Unexpected subscribe')
  }
}

class MemoryOutbox implements DurableYjsOutbox {
  updates: DurableYjsPendingUpdate[] = []

  async load() {
    return this.updates.map((update) => ({
      clientUpdateId: update.clientUpdateId,
      data: update.data.slice()
    }))
  }

  async put(update: DurableYjsPendingUpdate) {
    this.updates.push({
      clientUpdateId: update.clientUpdateId,
      data: update.data.slice()
    })
  }

  async remove(clientUpdateIds: string[]) {
    const removedIds = new Set(clientUpdateIds)
    this.updates = this.updates.filter((update) => !removedIds.has(update.clientUpdateId))
  }

  async replace(clientUpdateIds: string[], replacement: DurableYjsPendingUpdate) {
    const replacedIds = new Set(clientUpdateIds)
    const firstIndex = this.updates.findIndex((update) => replacedIds.has(update.clientUpdateId))
    this.updates = this.updates.filter((update) => !replacedIds.has(update.clientUpdateId))
    this.updates.splice(Math.max(0, firstIndex), 0, replacement)
  }
}

class FailingAppendStore extends MemoryDurableStore {
  attemptedClientUpdateIds: string[] = []

  override async append(clientUpdateId: string) {
    this.attemptedClientUpdateIds.push(clientUpdateId)
    throw new Error('Cloud unavailable')
  }
}

class RetryingLoadStore extends MemoryDurableStore {
  loadAttempts = 0

  override async load() {
    this.loadAttempts += 1
    if (this.loadAttempts === 1) throw new Error('Temporary read failure')
    return super.load()
  }
}

function emptyState(): DurableYjsDocumentState {
  return { snapshot: null, snapshotSequence: 0, updates: [] }
}

describe('OpenPencil durable collaboration', () => {
  test('roundtrips binary Yjs payloads through database-safe text', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255])
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  test('cancels an unfinished durable hydration', async () => {
    const controller = new AbortController()
    const ydoc = new Y.Doc()
    const connection = connectDurableYjsProvider({
      signal: controller.signal,
      store: new AbortableDurableStore(),
      ydoc
    })

    controller.abort()

    await expect(connection).rejects.toThrow()
    ydoc.destroy()
  })

  test('loads the shared document and uploads offline local work', async () => {
    const remote = new Y.Doc()
    remote.getMap('nodes').set('remote-board', 'from-cloud')
    const store = new MemoryDurableStore({
      snapshot: Y.encodeStateAsUpdate(remote),
      snapshotSequence: 4,
      updates: []
    })
    const local = new Y.Doc()
    local.getMap('nodes').set('local-board', 'from-device')

    const provider = await connectDurableYjsProvider({ store, ydoc: local })

    expect(local.getMap('nodes').get('remote-board')).toBe('from-cloud')
    expect(store.appended).toHaveLength(1)
    const uploaded = new Y.Doc()
    Y.applyUpdate(uploaded, store.appended[0]?.data ?? new Uint8Array())
    expect(uploaded.getMap('nodes').get('local-board')).toBe('from-device')

    await provider.destroy()
    remote.destroy()
    local.destroy()
    uploaded.destroy()
  })

  test('runs document repair after hydration and persists its update', async () => {
    const remote = new Y.Doc()
    remote.getMap('nodes').set('remote-board', 'from-cloud')
    const store = new MemoryDurableStore({
      snapshot: Y.encodeStateAsUpdate(remote),
      snapshotSequence: 4,
      updates: []
    })
    const local = new Y.Doc()

    const provider = await connectDurableYjsProvider({
      onHydrated: () => {
        expect(local.getMap('nodes').get('remote-board')).toBe('from-cloud')
        local.getMap('nodes').set('repaired-board', 'current')
      },
      store,
      ydoc: local
    })

    const durable = new Y.Doc()
    for (const update of store.appended) Y.applyUpdate(durable, update.data)
    expect(durable.getMap('nodes').get('repaired-board')).toBe('current')

    await provider.destroy()
    remote.destroy()
    local.destroy()
    durable.destroy()
  })

  test('applies live database updates without echoing them back', async () => {
    const store = new MemoryDurableStore(emptyState())
    const local = new Y.Doc()
    const provider = await connectDurableYjsProvider({ store, ydoc: local })
    const remote = new Y.Doc()
    remote.getMap('nodes').set('cofounder-board', 'live')

    store.listener?.({
      clientUpdateId: crypto.randomUUID(),
      data: Y.encodeStateAsUpdate(remote),
      sequence: 1
    })

    expect(local.getMap('nodes').get('cofounder-board')).toBe('live')
    expect(store.appended).toHaveLength(0)

    await provider.destroy()
    remote.destroy()
    local.destroy()
  })

  test('flushes the final local edit when the workspace closes', async () => {
    const store = new MemoryDurableStore(emptyState())
    const local = new Y.Doc()
    const provider = await connectDurableYjsProvider({ store, ydoc: local })

    local.getMap('nodes').set('last-edit', 'saved')
    await provider.destroy()

    const durable = new Y.Doc()
    for (const update of store.appended) Y.applyUpdate(durable, update.data)
    expect(durable.getMap('nodes').get('last-edit')).toBe('saved')

    local.destroy()
    durable.destroy()
  })

  test('splits a large run of local edits into bounded durable uploads', async () => {
    const store = new MemoryDurableStore(emptyState())
    const local = new Y.Doc()
    const provider = await connectDurableYjsProvider({ store, ydoc: local })
    const nodes = local.getMap('nodes')

    nodes.set('large-a', 'a'.repeat(240_000))
    nodes.set('large-b', 'b'.repeat(240_000))
    nodes.set('large-c', 'c'.repeat(240_000))
    await provider.destroy()

    expect(store.appended).toHaveLength(2)
    const durable = new Y.Doc()
    for (const update of store.appended) Y.applyUpdate(durable, update.data)
    expect(durable.getMap('nodes').get('large-a')).toBe('a'.repeat(240_000))
    expect(durable.getMap('nodes').get('large-b')).toBe('b'.repeat(240_000))
    expect(durable.getMap('nodes').get('large-c')).toBe('c'.repeat(240_000))

    local.destroy()
    durable.destroy()
  })

  test('restores an unsent deletion from the local outbox after reload', async () => {
    const remote = new Y.Doc()
    remote.getMap('nodes').set('deleted-board-object', 'stale')
    const state = {
      snapshot: Y.encodeStateAsUpdate(remote),
      snapshotSequence: 4,
      updates: []
    }
    const outbox = new MemoryOutbox()
    const failingStore = new FailingAppendStore(state)
    const firstDocument = new Y.Doc()
    const firstProvider = await connectDurableYjsProvider({
      outbox,
      store: failingStore,
      ydoc: firstDocument
    })

    firstDocument.getMap('nodes').delete('deleted-board-object')
    await firstProvider.destroy()

    expect(outbox.updates).toHaveLength(1)
    expect(failingStore.attemptedClientUpdateIds).toEqual([outbox.updates[0]?.clientUpdateId])

    const recoveredStore = new MemoryDurableStore(state)
    const recoveredDocument = new Y.Doc()
    const recoveredProvider = await connectDurableYjsProvider({
      outbox,
      store: recoveredStore,
      ydoc: recoveredDocument
    })

    expect(recoveredDocument.getMap('nodes').has('deleted-board-object')).toBe(false)
    expect(recoveredStore.appended).toHaveLength(1)
    expect(recoveredStore.appended[0]?.clientUpdateId).toBe(
      failingStore.attemptedClientUpdateIds[0]
    )
    expect(outbox.updates).toHaveLength(0)

    const durable = new Y.Doc()
    Y.applyUpdate(durable, state.snapshot)
    Y.applyUpdate(durable, recoveredStore.appended[0]?.data ?? new Uint8Array())
    expect(durable.getMap('nodes').has('deleted-board-object')).toBe(false)

    await recoveredProvider.destroy()
    remote.destroy()
    firstDocument.destroy()
    recoveredDocument.destroy()
    durable.destroy()
  })

  test('keeps local edits while the initial cloud read retries', async () => {
    const outbox = new MemoryOutbox()
    const store = new RetryingLoadStore(emptyState())
    const local = new Y.Doc()
    const connection = connectDurableYjsProvider({
      loadRetryDelay: () => 0,
      outbox,
      store,
      ydoc: local
    })

    local.getMap('nodes').set('made-while-reconnecting', 'kept')
    const provider = await connection

    expect(store.loadAttempts).toBe(2)
    expect(store.appended).toHaveLength(1)
    const durable = new Y.Doc()
    Y.applyUpdate(durable, store.appended[0]?.data ?? new Uint8Array())
    expect(durable.getMap('nodes').get('made-while-reconnecting')).toBe('kept')
    expect(outbox.updates).toHaveLength(0)

    await provider.destroy()
    local.destroy()
    durable.destroy()
  })
})
