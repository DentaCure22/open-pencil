export type DurableYjsUpdate = {
  clientUpdateId: string
  data: Uint8Array
  sequence: number
}

export type DurableYjsDocumentState = {
  snapshot: Uint8Array | null
  snapshotSequence: number
  updates: DurableYjsUpdate[]
}

export type DurableYjsUpdateListener = (update: DurableYjsUpdate) => void

export type DurableYjsHydratedHandler = () => void | Promise<void>

export type DurableYjsPendingUpdate = {
  clientUpdateId: string
  data: Uint8Array
}

export type DurableYjsOutbox = {
  load(): Promise<DurableYjsPendingUpdate[]>
  put(update: DurableYjsPendingUpdate): Promise<void>
  remove(clientUpdateIds: string[]): Promise<void>
  replace(clientUpdateIds: string[], replacement: DurableYjsPendingUpdate): Promise<void>
}

export type DurableYjsCheckpointLease = {
  id: string | null
}

export type DurableYjsStore = {
  append(clientUpdateId: string, update: Uint8Array): Promise<DurableYjsUpdate>
  checkpoint(
    snapshot: Uint8Array,
    coversSequence: number,
    lease?: DurableYjsCheckpointLease
  ): Promise<boolean>
  claimCheckpoint?(): Promise<DurableYjsCheckpointLease | null>
  load(signal?: AbortSignal): Promise<DurableYjsDocumentState>
  subscribe(
    listener: DurableYjsUpdateListener,
    afterSequence?: number,
    signal?: AbortSignal
  ): Promise<() => Promise<void>>
}
