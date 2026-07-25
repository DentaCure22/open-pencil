import { describe, expect, test } from 'bun:test'

import type { SupabaseClient } from '@supabase/supabase-js'

import { bytesToBase64 } from '@/app/collab/persistence/base64'
import { createSupabaseDurableYjsStore } from '@/app/collab/persistence/supabase-store'

type RealtimeInsertListener = () => void

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
})
