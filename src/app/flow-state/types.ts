export type WorkLifecycleActorKind = 'agent' | 'human' | 'system'

export type WorkViewLocation = {
  kind: string
  pageId: string
}

export type WorkViewViewport = {
  panX: number
  panY: number
  zoom: number
}

export type WorkViewSnapshot = {
  activeTool: string
  location: WorkViewLocation
  selectedIds: string[]
  viewport: WorkViewViewport
}

export type WorkViewMovementReceipt = {
  actorId: string
  actorKind: WorkLifecycleActorKind
  from: WorkViewLocation
  id: string
  itemId: string
  occurredAt: string
  origin: WorkViewSnapshot
  to: WorkViewLocation
}

export type WorkViewMemory = {
  active: WorkViewSnapshot | null
  history: WorkViewMovementReceipt[]
  version: 1
  views: Record<string, WorkViewSnapshot>
}

export type RecordWorkViewMovementInput = {
  actorId?: string
  actorKind?: WorkLifecycleActorKind
  id?: string
  now?: string
}
