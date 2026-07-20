import type {
  RecordWorkViewMovementInput,
  WorkViewLocation,
  WorkViewMemory,
  WorkViewMovementReceipt,
  WorkViewSnapshot
} from './types'

function movementId(itemId: string) {
  const bytes = new Uint32Array(2)
  globalThis.crypto.getRandomValues(bytes)
  return `work-movement_${itemId}_${[...bytes].map((value) => value.toString(36)).join('')}`
}

function cloneLocation(location: WorkViewLocation): WorkViewLocation {
  return { kind: location.kind, pageId: location.pageId }
}

export function cloneWorkViewSnapshot(snapshot: WorkViewSnapshot): WorkViewSnapshot {
  return {
    activeTool: snapshot.activeTool,
    location: cloneLocation(snapshot.location),
    selectedIds: [...snapshot.selectedIds],
    viewport: { ...snapshot.viewport }
  }
}

function cloneMovementReceipt(receipt: WorkViewMovementReceipt): WorkViewMovementReceipt {
  return {
    ...receipt,
    from: cloneLocation(receipt.from),
    origin: cloneWorkViewSnapshot(receipt.origin),
    to: cloneLocation(receipt.to)
  }
}

export function workViewLocationKey(location: WorkViewLocation): string {
  return `${encodeURIComponent(location.kind)}:${encodeURIComponent(location.pageId)}`
}

export function createWorkViewMemory(): WorkViewMemory {
  return { active: null, history: [], version: 1, views: {} }
}

export function rememberWorkViewSnapshot(
  memory: WorkViewMemory,
  snapshot: WorkViewSnapshot
): WorkViewMemory {
  const saved = cloneWorkViewSnapshot(snapshot)
  return {
    active: saved,
    history: memory.history.map(cloneMovementReceipt),
    version: 1,
    views: { ...memory.views, [workViewLocationKey(saved.location)]: saved }
  }
}

export function recordWorkViewMovement(
  itemId: string,
  memory: WorkViewMemory,
  origin: WorkViewSnapshot,
  destination: WorkViewLocation,
  input: RecordWorkViewMovementInput = {}
): { memory: WorkViewMemory; receipt: WorkViewMovementReceipt } {
  const receipt: WorkViewMovementReceipt = {
    actorId: input.actorId?.trim() || 'local-user',
    actorKind: input.actorKind ?? 'human',
    from: cloneLocation(origin.location),
    id: input.id ?? movementId(itemId),
    itemId,
    occurredAt: input.now ?? new Date().toISOString(),
    origin: cloneWorkViewSnapshot(origin),
    to: cloneLocation(destination)
  }
  const withOrigin = rememberWorkViewSnapshot(memory, origin)
  return {
    memory: {
      ...withOrigin,
      history: [...withOrigin.history, receipt]
    },
    receipt
  }
}
