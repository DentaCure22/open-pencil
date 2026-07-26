import type * as Y from 'yjs'

export type CollabHydrationState = {
  hydrated: boolean
  pendingDeletedNodeIds: Set<string>
}

export function createCollabHydrationState(): CollabHydrationState {
  return {
    hydrated: false,
    pendingDeletedNodeIds: new Set()
  }
}

export function queuePreHydrationDelete(state: CollabHydrationState, nodeId: string) {
  if (!state.hydrated) state.pendingDeletedNodeIds.add(nodeId)
}

export function cancelPreHydrationDelete(state: CollabHydrationState, nodeId: string) {
  if (!state.hydrated) state.pendingDeletedNodeIds.delete(nodeId)
}

export function completeCollabHydration(
  state: CollabHydrationState,
  ydoc: Y.Doc | null,
  ynodes: Y.Map<Y.Map<unknown>> | null
): boolean {
  if (!ydoc || !ynodes) return false

  const pendingDeletedNodeIds = [...state.pendingDeletedNodeIds]
  if (pendingDeletedNodeIds.length > 0) {
    ydoc.transact(() => {
      for (const nodeId of pendingDeletedNodeIds) ynodes.delete(nodeId)
    })
  }

  state.pendingDeletedNodeIds.clear()
  state.hydrated = true
  return true
}

export function resetCollabHydration(state: CollabHydrationState) {
  state.hydrated = false
  state.pendingDeletedNodeIds.clear()
}
