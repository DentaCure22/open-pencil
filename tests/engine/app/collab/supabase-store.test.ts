import { describe, expect, test } from 'bun:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import { bytesToBase64 } from '@/app/collab/persistence/base64'
import { createSupabaseDurableYjsStore } from '@/app/collab/persistence/supabase-store'

type RealtimeInsertListener = () => void

type RpcCall = {
  args: Record<string, unknown>
  name: string
}

class UpdateQuery {
  private afterSequence = 0

  constructor(
    private readonly requestedLimits: number[],
    private readonly requestedAfterSequences: number[],
    private readonly timeoutAbove: number | null
  ) {}

  eq() {
    return this
  }

  gt(_column: string, value: number) {
    this.afterSequence = value
    this.requestedAfterSequences.push(value)
    return this
  }

  order() {
    return this
  }

  select() {
    return this
  }

  async limit(value: number) {
    this.requestedLimits.push(value)
    if (this.timeoutAbove !== null && value > this.timeoutAbove) {
      return { data: null, error: { code: '57014' } }
    }
    return {
      data: [
        {
          client_update_id: 'a5530584-0f31-44ca-a185-e84d024947d8',
          sequence: this.afterSequence + 1,
          update_base64: bytesToBase64(new Uint8Array([1, 2, 3]))
        }
      ],
      error: null
    }
  }
}

function realtimeClient(timeoutAbove: number | null = null) {
  let insertListener: RealtimeInsertListener | null = null
  const requestedLimits: number[] = []
  const requestedAfterSequences: number[] = []
  const channel = {
    on(_type: string, _filter: object, listener: RealtimeInsertListener) {
      insertListener = listener
      return channel
    },
    subscribe(listener: (status: string) => void) {
      listener('SUBSCRIBED')
      return channel
    }
  }
  const client = {
    channel: () => channel,
    from: () => new UpdateQuery(requestedLimits, requestedAfterSequences, timeoutAbove),
    removeChannel: async () => 'ok',
    rpc: async () => ({ data: null, error: { code: 'PGRST202' } })
  } as SupabaseClient
  return {
    client,
    requestedAfterSequences,
    requestedLimits,
    emitInsert() {
      insertListener?.()
    }
  }
}

function clientWithRpc(
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{
    data: boolean | null
    error: { code: string } | null
  }>
): SupabaseClient {
  const client = realtimeClient().client
  Object.defineProperty(client, 'rpc', { configurable: true, value: rpc })
  return client
}

describe('Supabase durable Yjs store', () => {
  test('uses realtime as a wake-up and reads the complete update from Postgres', async () => {
    const realtime = realtimeClient()
    const store = createSupabaseDurableYjsStore(realtime.client, 'document-id')
    const received: Uint8Array[] = []
    const unsubscribe = await store.subscribe((update) => received.push(update.data), 40)

    realtime.emitInsert()
    await unsubscribe()

    expect(received).toEqual([new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])])
    expect(realtime.requestedAfterSequences).toEqual([40, 41])
    expect(realtime.requestedLimits).toEqual([16, 16])
  })

  test('shrinks an update page until a timed-out document can recover', async () => {
    const realtime = realtimeClient(2)
    const store = createSupabaseDurableYjsStore(realtime.client, 'document-id')
    const received: Uint8Array[] = []
    const unsubscribe = await store.subscribe((update) => received.push(update.data))

    await unsubscribe()

    expect(received).toEqual([new Uint8Array([1, 2, 3])])
    expect(realtime.requestedLimits).toEqual([16, 8, 4, 2])
  })

  test('claims and uses one stable checkpoint lease', async () => {
    const calls: RpcCall[] = []
    const client = clientWithRpc(async (name, args) => {
      calls.push({ args, name })
      return { data: true, error: null }
    })
    const store = createSupabaseDurableYjsStore(client, 'document-id')

    const lease = await store.claimCheckpoint?.()
    expect(lease?.id).toBeString()
    await store.checkpoint(new Uint8Array([1, 2, 3]), 42, lease ?? undefined)

    expect(calls.map((call) => call.name)).toEqual([
      'openpencil_claim_document_checkpoint',
      'openpencil_checkpoint_document_with_lease'
    ])
    expect(calls[0]?.args.p_lease_id).toBe(calls[1]?.args.p_lease_id)
    expect(calls[1]?.args.p_covers_sequence).toBe(42)
  })

  test('falls back to the legacy checkpoint RPC before the lease migration lands', async () => {
    const calls: RpcCall[] = []
    const client = clientWithRpc(async (name, args) => {
      calls.push({ args, name })
      if (name === 'openpencil_claim_document_checkpoint') {
        return { data: null, error: { code: 'PGRST202' } }
      }
      return { data: true, error: null }
    })
    const store = createSupabaseDurableYjsStore(client, 'document-id')

    const lease = await store.claimCheckpoint?.()
    expect(lease).toEqual({ id: null })
    await store.checkpoint(new Uint8Array([1, 2, 3]), 42, lease ?? undefined)

    expect(calls.map((call) => call.name)).toEqual([
      'openpencil_claim_document_checkpoint',
      'openpencil_checkpoint_document'
    ])
  })
})
