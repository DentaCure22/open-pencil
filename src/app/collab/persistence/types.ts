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

export type DurableYjsStore = {
  append(clientUpdateId: string, update: Uint8Array): Promise<DurableYjsUpdate>
  checkpoint(snapshot: Uint8Array, coversSequence: number): Promise<boolean>
  load(signal?: AbortSignal): Promise<DurableYjsDocumentState>
  subscribe(
    listener: DurableYjsUpdateListener,
    afterSequence?: number,
    signal?: AbortSignal
  ): Promise<() => Promise<void>>
}
