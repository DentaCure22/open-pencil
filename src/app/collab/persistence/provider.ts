import * as Y from 'yjs'

import { DURABLE_COLLAB_ORIGIN } from '@/app/collab/origins'
import type {
  DurableYjsHydratedHandler,
  DurableYjsStore,
  DurableYjsUpdate
} from '@/app/collab/persistence/types'

const LOCAL_FLUSH_DELAY_MS = 220
const RETRY_DELAY_MS = 1200
const CHECKPOINT_DELAY_MS = 2000
const CHECKPOINT_UPDATE_THRESHOLD = 100
const MAX_LOCAL_BATCH_BYTES = 512 * 1024

type DurableYjsProviderOptions = {
  onHydrated?: DurableYjsHydratedHandler
  signal?: AbortSignal
  store: DurableYjsStore
  ydoc: Y.Doc
}

type PendingBatch = {
  clientUpdateId: string
  data: Uint8Array
}

export type DurableYjsProvider = {
  destroy(): Promise<void>
}

function isEmptyUpdate(update: Uint8Array): boolean {
  return update.length <= 2
}

export async function connectDurableYjsProvider({
  onHydrated,
  signal,
  store,
  ydoc
}: DurableYjsProviderOptions): Promise<DurableYjsProvider> {
  let disposed = false
  let closing = false
  let loading = true
  let flushing = false
  let latestSequence = 0
  let snapshotSequence = 0
  let updatesSinceCheckpoint = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null
  const appliedUpdateIds = new Set<string>()
  const bufferedRemoteUpdates: DurableYjsUpdate[] = []
  const pendingLocalUpdates: Uint8Array[] = []
  const pendingBatches: PendingBatch[] = []
  let unsubscribe: () => Promise<void> = async () => undefined
  let remoteDocument: Y.Doc | null = null

  function applyRemoteUpdate(update: DurableYjsUpdate) {
    if (appliedUpdateIds.has(update.clientUpdateId)) return
    appliedUpdateIds.add(update.clientUpdateId)
    latestSequence = Math.max(latestSequence, update.sequence)
    updatesSinceCheckpoint += 1
    Y.applyUpdate(ydoc, update.data, DURABLE_COLLAB_ORIGIN)
    scheduleCheckpoint()
  }

  function handleRemoteUpdate(update: DurableYjsUpdate) {
    if (loading) {
      bufferedRemoteUpdates.push(update)
      return
    }
    applyRemoteUpdate(update)
  }

  function captureLocalBatch() {
    if (pendingLocalUpdates.length === 0) return
    const updates = pendingLocalUpdates.splice(0)
    let batch: Uint8Array[] = []
    let batchBytes = 0

    function enqueueBatch() {
      if (batch.length === 0) return
      const data = Y.mergeUpdates(batch)
      batch = []
      batchBytes = 0
      if (isEmptyUpdate(data)) return
      pendingBatches.push({ clientUpdateId: crypto.randomUUID(), data })
    }

    for (const update of updates) {
      if (batch.length > 0 && batchBytes + update.length > MAX_LOCAL_BATCH_BYTES) enqueueBatch()
      batch.push(update)
      batchBytes += update.length
    }
    enqueueBatch()
  }

  function scheduleFlush(delay = LOCAL_FLUSH_DELAY_MS) {
    if (disposed || closing || flushTimer || retryTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushPendingBatches()
    }, delay)
  }

  function scheduleRetry() {
    if (disposed || closing || retryTimer) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      void flushPendingBatches()
    }, RETRY_DELAY_MS)
  }

  async function flushPendingBatches() {
    if (disposed || flushing) return
    flushing = true
    captureLocalBatch()
    try {
      while (pendingBatches.length > 0) {
        const batch = pendingBatches[0]
        try {
          const stored = await store.append(batch.clientUpdateId, batch.data)
          pendingBatches.shift()
          appliedUpdateIds.add(stored.clientUpdateId)
          latestSequence = Math.max(latestSequence, stored.sequence)
          updatesSinceCheckpoint += 1
          captureLocalBatch()
          scheduleCheckpoint()
        } catch (error) {
          console.warn('[OpenPencil Cloud] Durable update will retry', {
            bytes: batch.data.length,
            error
          })
          scheduleRetry()
          break
        }
      }
    } finally {
      flushing = false
      if (!closing && pendingLocalUpdates.length > 0 && pendingBatches.length === 0) {
        scheduleFlush()
      }
    }
  }

  function scheduleCheckpoint() {
    if (
      disposed ||
      closing ||
      checkpointTimer ||
      updatesSinceCheckpoint < CHECKPOINT_UPDATE_THRESHOLD ||
      latestSequence <= snapshotSequence
    ) {
      return
    }
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null
      void checkpointDocument()
    }, CHECKPOINT_DELAY_MS)
  }

  async function checkpointDocument() {
    if (disposed || latestSequence <= snapshotSequence) return
    await flushPendingBatches()
    const coversSequence = latestSequence
    if (coversSequence <= snapshotSequence) return
    try {
      const saved = await store.checkpoint(Y.encodeStateAsUpdate(ydoc), coversSequence)
      if (saved) {
        snapshotSequence = coversSequence
        updatesSinceCheckpoint = 0
      }
    } catch (error) {
      console.warn('[OpenPencil Cloud] Checkpoint deferred', error)
      scheduleCheckpoint()
    }
  }

  function handleYdocUpdate(update: Uint8Array, origin: unknown) {
    if (origin !== null && origin !== undefined) return
    if (loading) return
    pendingLocalUpdates.push(update)
    scheduleFlush()
  }

  ydoc.on('update', handleYdocUpdate)

  try {
    signal?.throwIfAborted()
    const state = await store.load(signal)
    signal?.throwIfAborted()
    snapshotSequence = state.snapshotSequence
    latestSequence = state.snapshotSequence
    remoteDocument = new Y.Doc()

    if (state.snapshot) {
      Y.applyUpdate(remoteDocument, state.snapshot)
      Y.applyUpdate(ydoc, state.snapshot, DURABLE_COLLAB_ORIGIN)
    }

    for (const update of state.updates) {
      signal?.throwIfAborted()
      if (appliedUpdateIds.has(update.clientUpdateId)) continue
      appliedUpdateIds.add(update.clientUpdateId)
      latestSequence = Math.max(latestSequence, update.sequence)
      updatesSinceCheckpoint += 1
      Y.applyUpdate(remoteDocument, update.data)
      Y.applyUpdate(ydoc, update.data, DURABLE_COLLAB_ORIGIN)
    }

    unsubscribe = await store.subscribe(handleRemoteUpdate, latestSequence, signal)
    signal?.throwIfAborted()
    for (const update of bufferedRemoteUpdates.sort(
      (left, right) => left.sequence - right.sequence
    )) {
      signal?.throwIfAborted()
      if (!appliedUpdateIds.has(update.clientUpdateId)) {
        appliedUpdateIds.add(update.clientUpdateId)
        latestSequence = Math.max(latestSequence, update.sequence)
        updatesSinceCheckpoint += 1
        Y.applyUpdate(remoteDocument, update.data)
        Y.applyUpdate(ydoc, update.data, DURABLE_COLLAB_ORIGIN)
      }
    }
    bufferedRemoteUpdates.length = 0

    const missingRemoteUpdate = Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(remoteDocument))
    remoteDocument.destroy()
    remoteDocument = null
    loading = false

    if (!isEmptyUpdate(missingRemoteUpdate)) {
      pendingLocalUpdates.push(missingRemoteUpdate)
      await flushPendingBatches()
    }
    await onHydrated?.()
    await flushPendingBatches()
    scheduleCheckpoint()
  } catch (error) {
    loading = false
    remoteDocument?.destroy()
    ydoc.off('update', handleYdocUpdate)
    await unsubscribe()
    throw error
  }

  return {
    async destroy() {
      if (disposed) return
      closing = true
      if (flushTimer) clearTimeout(flushTimer)
      if (retryTimer) clearTimeout(retryTimer)
      if (checkpointTimer) clearTimeout(checkpointTimer)
      flushTimer = null
      retryTimer = null
      checkpointTimer = null
      ydoc.off('update', handleYdocUpdate)
      captureLocalBatch()
      await flushPendingBatches()
      disposed = true
      await unsubscribe()
    }
  }
}
