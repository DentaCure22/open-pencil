import { describe, expect, test } from 'bun:test'

import * as Y from 'yjs'

import { base64ToBytes, bytesToBase64 } from '@/app/collab/persistence/base64'
import { connectDurableYjsProvider } from '@/app/collab/persistence/provider'
import type {
  DurableYjsDocumentState,
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
})
