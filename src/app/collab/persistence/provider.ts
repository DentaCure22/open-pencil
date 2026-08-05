import * as Y from 'yjs'

import { DURABLE_COLLAB_ORIGIN } from '@/app/collab/origins'
import { exponentialBackoffDelay } from '@/app/collab/persistence/backoff'
import type {
  DurableYjsHydratedHandler,
  DurableYjsOutbox,
  DurableYjsPendingUpdate,
  DurableYjsStore,
  DurableYjsUpdate
} from '@/app/collab/persistence/types'

const LOCAL_FLUSH_DELAY_MS = 220
const CHECKPOINT_DELAY_MS = 2000
const CHECKPOINT_UPDATE_THRESHOLD = 32
const CHECKPOINT_BYTE_THRESHOLD = 2 * 1024 * 1024
const MAX_LOCAL_BATCH_BYTES = 512 * 1024

type DurableYjsProviderOptions = {
  checkpointByteThreshold?: number
  checkpointDelayMs?: number
  checkpointUpdateThreshold?: number
  loadRetryDelay?: (attempt: number) => number
  onHydrated?: DurableYjsHydratedHandler
  outbox?: DurableYjsOutbox
  signal?: AbortSignal
  store: DurableYjsStore
  ydoc: Y.Doc
}

export type DurableYjsProvider = {
  destroy(): Promise<void>
}

function isEmptyUpdate(update: Uint8Array): boolean {
  return update.length <= 2
}

function destroyDocument(document: Y.Doc | null) {
  document?.destroy()
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, delay)
    function handleAbort() {
      clearTimeout(timer)
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function appendRetryDelay(attempt: number): number {
  return exponentialBackoffDelay({
    attempt,
    baseDelayMs: 1200,
    maxDelayMs: 30_000
  })
}

function checkpointRetryDelay(attempt: number): number {
  return exponentialBackoffDelay({
    attempt,
    baseDelayMs: 5000,
    maxDelayMs: 60_000
  })
}

export async function connectDurableYjsProvider({
  checkpointByteThreshold = CHECKPOINT_BYTE_THRESHOLD,
  checkpointDelayMs = CHECKPOINT_DELAY_MS,
  checkpointUpdateThreshold = CHECKPOINT_UPDATE_THRESHOLD,
  loadRetryDelay = appendRetryDelay,
  onHydrated,
  outbox,
  signal,
  store,
  ydoc
}: DurableYjsProviderOptions): Promise<DurableYjsProvider> {
  let disposed = false
  let closing = false
  let loading = true
  let latestSequence = 0
  let snapshotSequence = 0
  let updatesSinceCheckpoint = 0
  let bytesSinceCheckpoint = 0
  let appendRetryAttempt = 0
  let checkpointRetryAttempt = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let checkpointTimer: ReturnType<typeof setTimeout> | null = null
  let flushPromise: Promise<boolean> | null = null
  let checkpointing = false
  let pendingWrites = Promise.resolve()
  const appliedUpdateIds = new Set<string>()
  const bufferedRemoteUpdates: DurableYjsUpdate[] = []
  const pendingBatches: DurableYjsPendingUpdate[] = []
  let unsubscribe: () => Promise<void> = async () => undefined
  let remoteDocument: Y.Doc | null = null

  function recordDurableUpdate(update: DurableYjsUpdate) {
    latestSequence = Math.max(latestSequence, update.sequence)
    if (appliedUpdateIds.has(update.clientUpdateId)) return false
    appliedUpdateIds.add(update.clientUpdateId)
    updatesSinceCheckpoint += 1
    bytesSinceCheckpoint += update.data.length
    return true
  }

  function applyRemoteUpdate(update: DurableYjsUpdate) {
    if (!recordDurableUpdate(update)) return
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

  function scheduleFlush(delay = LOCAL_FLUSH_DELAY_MS) {
    if (disposed || closing || flushTimer || retryTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushPendingBatches()
    }, delay)
  }

  function scheduleRetry() {
    if (disposed || closing || retryTimer) return
    const delay = appendRetryDelay(appendRetryAttempt)
    appendRetryAttempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      void flushPendingBatches()
    }, delay)
  }

  function queueLocalUpdate(data: Uint8Array) {
    if (isEmptyUpdate(data)) return
    const pendingUpdate = {
      clientUpdateId: crypto.randomUUID(),
      data: data.slice()
    }
    pendingWrites = pendingWrites.then(async () => {
      try {
        await outbox?.put(pendingUpdate)
      } catch (error) {
        console.error('[OpenPencil Cloud] Could not persist a pending local update', error)
      }
      pendingBatches.push(pendingUpdate)
      scheduleFlush()
      return undefined
    })
  }

  async function compactNextBatch(): Promise<DurableYjsPendingUpdate | null> {
    const first = pendingBatches[0]
    if (!first) return null

    let totalBytes = 0
    let count = 0
    for (const pending of pendingBatches) {
      if (count > 0 && totalBytes + pending.data.length > MAX_LOCAL_BATCH_BYTES) break
      totalBytes += pending.data.length
      count += 1
    }
    if (count <= 1) return first

    const compactedUpdates = pendingBatches.slice(0, count)
    const replacement = {
      clientUpdateId: crypto.randomUUID(),
      data: Y.mergeUpdates(compactedUpdates.map((pending) => pending.data))
    }
    try {
      await outbox?.replace(
        compactedUpdates.map((pending) => pending.clientUpdateId),
        replacement
      )
    } catch (error) {
      console.warn('[OpenPencil Cloud] Local update compaction deferred', error)
      return first
    }
    pendingBatches.splice(0, count, replacement)
    return replacement
  }

  async function performFlush(): Promise<boolean> {
    await pendingWrites
    while (pendingBatches.length > 0) {
      const batch = await compactNextBatch()
      if (!batch) break
      try {
        const stored = await store.append(batch.clientUpdateId, batch.data)
        await outbox?.remove([batch.clientUpdateId])
        pendingBatches.shift()
        appendRetryAttempt = 0
        recordDurableUpdate(stored)
        scheduleCheckpoint()
      } catch (error) {
        console.warn('[OpenPencil Cloud] Durable update will retry', {
          bytes: batch.data.length,
          error
        })
        scheduleRetry()
        return false
      }
    }
    return pendingBatches.length === 0
  }

  function flushPendingBatches(): Promise<boolean> {
    if (disposed) return Promise.resolve(false)
    if (flushPromise) return flushPromise
    flushPromise = performFlush().finally(() => {
      flushPromise = null
    })
    return flushPromise
  }

  function checkpointNeeded() {
    return (
      latestSequence > snapshotSequence &&
      (updatesSinceCheckpoint >= checkpointUpdateThreshold ||
        bytesSinceCheckpoint >= checkpointByteThreshold)
    )
  }

  function scheduleCheckpoint(delay = checkpointDelayMs) {
    if (disposed || closing || loading || checkpointTimer || !checkpointNeeded()) return
    checkpointTimer = setTimeout(() => {
      checkpointTimer = null
      void checkpointDocument()
    }, delay)
  }

  function scheduleCheckpointRetry() {
    const delay = checkpointRetryDelay(checkpointRetryAttempt)
    checkpointRetryAttempt += 1
    scheduleCheckpoint(delay)
  }

  async function checkpointDocument() {
    if (disposed || checkpointing || !checkpointNeeded()) return
    checkpointing = true
    try {
      const drained = await flushPendingBatches()
      if (!drained || pendingBatches.length > 0 || !checkpointNeeded()) return

      let lease
      if (store.claimCheckpoint) {
        const claimedLease = await store.claimCheckpoint()
        if (!claimedLease) {
          scheduleCheckpointRetry()
          return
        }
        lease = claimedLease
      }

      const coversSequence = latestSequence
      const saved = await store.checkpoint(Y.encodeStateAsUpdate(ydoc), coversSequence, lease)
      if (saved || coversSequence > snapshotSequence) {
        snapshotSequence = coversSequence
        updatesSinceCheckpoint = 0
        bytesSinceCheckpoint = 0
        checkpointRetryAttempt = 0
      }
    } catch (error) {
      console.warn('[OpenPencil Cloud] Checkpoint deferred', error)
      scheduleCheckpointRetry()
    } finally {
      checkpointing = false
    }
  }

  function handleYdocUpdate(update: Uint8Array, origin: unknown) {
    if (origin !== null && origin !== undefined) return
    if (loading && !outbox) return
    queueLocalUpdate(update)
  }

  function applyHydratedUpdates(document: Y.Doc, updates: DurableYjsUpdate[]) {
    for (const update of updates) {
      signal?.throwIfAborted()
      Y.applyUpdate(document, update.data)
      if (recordDurableUpdate(update)) {
        Y.applyUpdate(ydoc, update.data, DURABLE_COLLAB_ORIGIN)
      }
    }
  }

  async function restoreOutboxUpdates() {
    const restoredUpdates = (await outbox?.load()) ?? []
    const alreadyDurableIds = restoredUpdates
      .filter((update) => appliedUpdateIds.has(update.clientUpdateId))
      .map((update) => update.clientUpdateId)
    if (alreadyDurableIds.length > 0) await outbox?.remove(alreadyDurableIds)
    const queuedUpdateIds = new Set(pendingBatches.map((update) => update.clientUpdateId))
    for (const update of restoredUpdates) {
      signal?.throwIfAborted()
      if (
        appliedUpdateIds.has(update.clientUpdateId) ||
        queuedUpdateIds.has(update.clientUpdateId)
      ) {
        continue
      }
      pendingBatches.push(update)
      Y.applyUpdate(ydoc, update.data, DURABLE_COLLAB_ORIGIN)
    }
  }

  async function hydrateDocument() {
    signal?.throwIfAborted()
    const state = await store.load(signal)
    signal?.throwIfAborted()
    snapshotSequence = state.snapshotSequence
    latestSequence = state.snapshotSequence
    const attemptDocument = new Y.Doc()
    remoteDocument = attemptDocument

    if (state.snapshot) {
      Y.applyUpdate(attemptDocument, state.snapshot)
      Y.applyUpdate(ydoc, state.snapshot, DURABLE_COLLAB_ORIGIN)
    }

    applyHydratedUpdates(attemptDocument, state.updates)

    unsubscribe = await store.subscribe(handleRemoteUpdate, latestSequence, signal)
    signal?.throwIfAborted()
    applyHydratedUpdates(
      attemptDocument,
      bufferedRemoteUpdates.sort((left, right) => left.sequence - right.sequence)
    )
    bufferedRemoteUpdates.length = 0

    // Cloud sessions start with a fresh Y.Doc and persist every local update to
    // the outbox, including edits made while the first remote read is retrying.
    // A state-vector diff would duplicate delete sets already present there.
    const missingRemoteUpdate = outbox
      ? null
      : Y.encodeStateAsUpdate(ydoc, Y.encodeStateVector(attemptDocument))
    await restoreOutboxUpdates()
    attemptDocument.destroy()
    remoteDocument = null
    loading = false

    if (missingRemoteUpdate && !isEmptyUpdate(missingRemoteUpdate)) {
      queueLocalUpdate(missingRemoteUpdate)
    }
    await flushPendingBatches()
    await onHydrated?.()
    await pendingWrites
    await flushPendingBatches()
    scheduleCheckpoint()
  }

  async function hydrateWithRetry() {
    let attempt = 0
    while (loading) {
      try {
        await hydrateDocument()
        return
      } catch (error) {
        if (!loading || signal?.aborted) throw error
        destroyDocument(remoteDocument)
        remoteDocument = null
        await unsubscribe()
        unsubscribe = async () => undefined
        console.warn('[OpenPencil Cloud] Initial document sync will retry', error)
        const delay = loadRetryDelay(attempt)
        attempt += 1
        await waitForRetry(delay, signal)
      }
    }
  }

  ydoc.on('update', handleYdocUpdate)

  try {
    await hydrateWithRetry()
  } catch (error) {
    loading = false
    destroyDocument(remoteDocument)
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
      await pendingWrites
      await flushPendingBatches()
      disposed = true
      await unsubscribe()
    }
  }
}
