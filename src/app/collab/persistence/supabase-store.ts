import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeChannel,
  type SupabaseClient
} from '@supabase/supabase-js'

import { base64ToBytes, bytesToBase64 } from '@/app/collab/persistence/base64'
import type {
  DurableYjsDocumentState,
  DurableYjsStore,
  DurableYjsUpdate,
  DurableYjsUpdateListener
} from '@/app/collab/persistence/types'

// Yjs updates are base64 payloads, so a 1,000-row PostgREST page can exceed
// the database statement timeout before a document has produced its first
// checkpoint. Keep recovery pages bounded and fall back further only when
// Postgres reports its statement-timeout code.
const UPDATE_PAGE_SIZE = 16
const MIN_UPDATE_PAGE_SIZE = 1
const LOAD_ATTEMPTS = 3

type DocumentRecord = {
  snapshot_base64: string | null
  snapshot_sequence: number | string
}

type UpdateRecord = {
  client_update_id: string
  sequence: number | string
  update_base64: string
}

type UpdatePageResult = {
  data: unknown[] | null
  error: unknown
}

type UpdatePageReader = (
  afterSequence: number,
  limit: number,
  signal?: AbortSignal
) => Promise<UpdatePageResult>

function sequenceNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error('OpenPencil Cloud returned an invalid update sequence')
  }
  return parsed
}

function isStatementTimeout(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '57014')
}

function isMissingBoundedReadRpc(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'PGRST202' || error.code === '42883')
  )
}

function updateReadError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('OpenPencil Cloud update read failed', { cause: error })
}

function documentRecord(value: unknown): DocumentRecord {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenPencil Cloud document is missing')
  }
  const record = value as Partial<DocumentRecord>
  if (
    (record.snapshot_base64 !== null && typeof record.snapshot_base64 !== 'string') ||
    (typeof record.snapshot_sequence !== 'number' && typeof record.snapshot_sequence !== 'string')
  ) {
    throw new Error('OpenPencil Cloud document state is invalid')
  }
  return {
    snapshot_base64: record.snapshot_base64,
    snapshot_sequence: record.snapshot_sequence
  }
}

function updateRecord(value: unknown): UpdateRecord {
  if (!value || typeof value !== 'object') {
    throw new Error('OpenPencil Cloud update is missing')
  }
  const record = value as Partial<UpdateRecord>
  if (
    typeof record.client_update_id !== 'string' ||
    (typeof record.sequence !== 'number' && typeof record.sequence !== 'string') ||
    typeof record.update_base64 !== 'string'
  ) {
    throw new Error('OpenPencil Cloud update is invalid')
  }
  return {
    client_update_id: record.client_update_id,
    sequence: record.sequence,
    update_base64: record.update_base64
  }
}

function durableUpdate(value: unknown): DurableYjsUpdate {
  const record = updateRecord(value)
  return {
    clientUpdateId: record.client_update_id,
    data: base64ToBytes(record.update_base64),
    sequence: sequenceNumber(record.sequence)
  }
}

async function readDocument(
  client: SupabaseClient,
  documentId: string,
  signal?: AbortSignal
): Promise<DocumentRecord> {
  const query = client
    .from('openpencil_documents')
    .select('snapshot_base64,snapshot_sequence')
    .eq('id', documentId)
  const result = await (signal ? query.abortSignal(signal) : query).single()
  if (result.error) throw result.error
  return documentRecord(result.data)
}

async function readUpdates(
  readPage: UpdatePageReader,
  afterSequence: number,
  signal?: AbortSignal
): Promise<DurableYjsUpdate[]> {
  const updates: DurableYjsUpdate[] = []
  let cursor = afterSequence
  let hasMore = true
  let pageSize = UPDATE_PAGE_SIZE
  while (hasMore) {
    signal?.throwIfAborted()
    const result = await readPage(cursor, pageSize, signal)
    if (result.error) {
      if (isStatementTimeout(result.error) && pageSize > MIN_UPDATE_PAGE_SIZE) {
        pageSize = Math.max(MIN_UPDATE_PAGE_SIZE, Math.floor(pageSize / 2))
        continue
      }
      throw updateReadError(result.error)
    }
    if (!result.data) throw new Error('OpenPencil Cloud update page is missing')
    const page = result.data.map(durableUpdate)
    updates.push(...page)
    const last = page.at(-1)
    hasMore = page.length === pageSize && Boolean(last)
    if (last) cursor = last.sequence
  }
  return updates
}

async function subscribeChannel(channel: RealtimeChannel): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) resolve()
      if (
        status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
        status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
        status === REALTIME_SUBSCRIBE_STATES.CLOSED
      ) {
        reject(error ?? new Error(`OpenPencil Cloud realtime ${status.toLocaleLowerCase()}`))
      }
    })
  })
}

export function createSupabaseDurableYjsStore(
  client: SupabaseClient,
  documentId: string
): DurableYjsStore {
  let useBoundedUpdateReadRpc = true

  async function readUpdatePage(
    afterSequence: number,
    limit: number,
    signal?: AbortSignal
  ): Promise<UpdatePageResult> {
    if (useBoundedUpdateReadRpc) {
      const rpcQuery = client.rpc('openpencil_read_document_updates', {
        p_after_sequence: afterSequence,
        p_document_id: documentId,
        p_limit: limit
      })
      const rpc = signal ? await rpcQuery.abortSignal(signal) : await rpcQuery
      if (!rpc.error) {
        return { data: Array.isArray(rpc.data) ? rpc.data : null, error: null }
      }
      if (!isMissingBoundedReadRpc(rpc.error)) {
        return { data: null, error: rpc.error }
      }
      useBoundedUpdateReadRpc = false
    }

    const query = client
      .from('openpencil_document_updates')
      .select('sequence,client_update_id,update_base64')
      .eq('document_id', documentId)
      .gt('sequence', afterSequence)
      .order('sequence', { ascending: true })
      .limit(limit)
    const result = signal ? await query.abortSignal(signal) : await query
    return { data: result.data, error: result.error }
  }

  return {
    async append(clientUpdateId, update) {
      const insert = await client
        .from('openpencil_document_updates')
        .upsert(
          {
            client_update_id: clientUpdateId,
            document_id: documentId,
            update_base64: bytesToBase64(update)
          },
          {
            ignoreDuplicates: true,
            onConflict: 'document_id,client_update_id'
          }
        )
        .select('sequence,client_update_id,update_base64')
        .maybeSingle()
      if (insert.error) throw insert.error
      if (insert.data) return durableUpdate(insert.data)

      const existing = await client
        .from('openpencil_document_updates')
        .select('sequence,client_update_id,update_base64')
        .eq('document_id', documentId)
        .eq('client_update_id', clientUpdateId)
        .single()
      if (existing.error) throw existing.error
      return durableUpdate(existing.data)
    },

    async checkpoint(snapshot, coversSequence) {
      const result = await client.rpc('openpencil_checkpoint_document', {
        p_covers_sequence: coversSequence,
        p_document_id: documentId,
        p_snapshot_base64: bytesToBase64(snapshot)
      })
      if (result.error) throw result.error
      return result.data === true
    },

    async load(signal?: AbortSignal): Promise<DurableYjsDocumentState> {
      for (let attempt = 0; attempt < LOAD_ATTEMPTS; attempt += 1) {
        signal?.throwIfAborted()
        const before = await readDocument(client, documentId, signal)
        const snapshotSequence = sequenceNumber(before.snapshot_sequence)
        const updates = await readUpdates(readUpdatePage, snapshotSequence, signal)
        const after = await readDocument(client, documentId, signal)
        if (sequenceNumber(after.snapshot_sequence) !== snapshotSequence) continue
        return {
          snapshot: before.snapshot_base64 ? base64ToBytes(before.snapshot_base64) : null,
          snapshotSequence,
          updates
        }
      }
      throw new Error('OpenPencil Cloud document changed repeatedly while loading')
    },

    async subscribe(listener: DurableYjsUpdateListener, afterSequence = 0, signal?: AbortSignal) {
      let closed = false
      let deliveredSequence = afterSequence
      let delivery = Promise.resolve()

      function catchUpFromDatabase() {
        delivery = delivery
          .then(async () => {
            const updates = await readUpdates(readUpdatePage, deliveredSequence, signal)
            for (const update of updates) {
              deliveredSequence = Math.max(deliveredSequence, update.sequence)
              if (!closed) listener(update)
            }
            return undefined
          })
          .catch((error) => {
            if (!signal?.aborted) {
              console.warn('[OpenPencil Cloud] Live update catch-up will retry', error)
            }
          })
      }

      const channel = client.channel(`openpencil-document-${documentId}`).on(
        'postgres_changes',
        {
          event: 'INSERT',
          filter: `document_id=eq.${documentId}`,
          schema: 'public',
          table: 'openpencil_document_updates'
        },
        catchUpFromDatabase
      )
      await subscribeChannel(channel)
      catchUpFromDatabase()
      await delivery
      return async () => {
        await client.removeChannel(channel)
        await delivery
        closed = true
      }
    }
  }
}
