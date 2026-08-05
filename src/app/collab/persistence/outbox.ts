import { readCacheValue, removeCacheEntry, writeCacheValue } from '@/app/cache'
import type { DurableYjsOutbox, DurableYjsPendingUpdate } from '@/app/collab/persistence/types'

const OUTBOX_VERSION = 1

type DurableYjsOutboxState = {
  updates: DurableYjsPendingUpdate[]
  version: typeof OUTBOX_VERSION
}

function outboxKey(roomId: string): string {
  return `collab/durable-outbox/${encodeURIComponent(roomId)}`
}

function cachedPendingUpdate(value: unknown): DurableYjsPendingUpdate | null {
  if (!value || typeof value !== 'object') return null
  const update = value as Partial<DurableYjsPendingUpdate>
  if (
    typeof update.clientUpdateId !== 'string' ||
    !(update.data instanceof Uint8Array) ||
    update.data.length === 0
  ) {
    return null
  }
  return {
    clientUpdateId: update.clientUpdateId,
    data: update.data
  }
}

function cachedOutboxState(value: unknown): DurableYjsOutboxState {
  if (!value || typeof value !== 'object') {
    return { updates: [], version: OUTBOX_VERSION }
  }
  const state = value as Partial<DurableYjsOutboxState>
  if (state.version !== OUTBOX_VERSION || !Array.isArray(state.updates)) {
    return { updates: [], version: OUTBOX_VERSION }
  }
  return {
    updates: state.updates
      .map(cachedPendingUpdate)
      .filter((update): update is DurableYjsPendingUpdate => update !== null),
    version: OUTBOX_VERSION
  }
}

function lockManager(): LockManager | null {
  if (typeof navigator === 'undefined' || !('locks' in navigator)) return null
  return navigator.locks
}

export function createCacheDurableYjsOutbox(roomId: string): DurableYjsOutbox {
  const key = outboxKey(roomId)
  const lockName = `openpencil-${key}`
  let fallbackQueue = Promise.resolve()

  async function withLock<T>(operation: () => Promise<T>): Promise<T> {
    const manager = lockManager()
    if (manager) return manager.request(lockName, operation)

    const previous = fallbackQueue
    let release: () => void = () => undefined
    fallbackQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async function readState(): Promise<DurableYjsOutboxState> {
    return cachedOutboxState(await readCacheValue<unknown>(key))
  }

  async function writeState(state: DurableYjsOutboxState): Promise<void> {
    if (state.updates.length === 0) {
      await removeCacheEntry(key)
      return
    }
    await writeCacheValue(key, state)
  }

  return {
    load() {
      return withLock(async () => {
        const state = await readState()
        return state.updates.map((update) => ({
          clientUpdateId: update.clientUpdateId,
          data: update.data.slice()
        }))
      })
    },

    put(update) {
      return withLock(async () => {
        const state = await readState()
        if (state.updates.some((item) => item.clientUpdateId === update.clientUpdateId)) {
          return
        }
        state.updates.push({
          clientUpdateId: update.clientUpdateId,
          data: update.data.slice()
        })
        await writeState(state)
      })
    },

    remove(clientUpdateIds) {
      return withLock(async () => {
        const removedIds = new Set(clientUpdateIds)
        const state = await readState()
        state.updates = state.updates.filter((update) => !removedIds.has(update.clientUpdateId))
        await writeState(state)
      })
    },

    replace(clientUpdateIds, replacement) {
      return withLock(async () => {
        const replacedIds = new Set(clientUpdateIds)
        const state = await readState()
        const firstIndex = state.updates.findIndex((update) =>
          replacedIds.has(update.clientUpdateId)
        )
        state.updates = state.updates.filter((update) => !replacedIds.has(update.clientUpdateId))
        state.updates.splice(Math.max(0, firstIndex), 0, {
          clientUpdateId: replacement.clientUpdateId,
          data: replacement.data.slice()
        })
        await writeState(state)
      })
    }
  }
}
