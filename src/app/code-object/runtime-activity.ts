import type { EditorStore } from '@/app/editor/active-store'

type RuntimeActivityListener = () => void

const activeFrameIdsByStore = new WeakMap<EditorStore, ReadonlySet<string>>()
const listenersByStore = new WeakMap<EditorStore, Set<RuntimeActivityListener>>()

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false
  return [...left].every((frameId) => right.has(frameId))
}

function notifyRuntimeActivity(store: EditorStore) {
  for (const listener of listenersByStore.get(store) ?? []) listener()
}

export function publishCodeObjectRuntimeActivity(
  store: EditorStore,
  frameIds: ReadonlySet<string>
) {
  const current = activeFrameIdsByStore.get(store) ?? new Set<string>()
  if (setsEqual(current, frameIds)) return false
  activeFrameIdsByStore.set(store, new Set(frameIds))
  notifyRuntimeActivity(store)
  return true
}

export function codeObjectRuntimeActivityIntersects(
  store: EditorStore,
  frameIds: readonly string[]
) {
  const activeFrameIds = activeFrameIdsByStore.get(store)
  return activeFrameIds ? frameIds.some((frameId) => activeFrameIds.has(frameId)) : false
}

export function subscribeCodeObjectRuntimeActivity(
  store: EditorStore,
  listener: RuntimeActivityListener
) {
  const listeners = listenersByStore.get(store) ?? new Set<RuntimeActivityListener>()
  listeners.add(listener)
  listenersByStore.set(store, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByStore.delete(store)
  }
}

export function clearCodeObjectRuntimeActivity(store: EditorStore) {
  if (!activeFrameIdsByStore.delete(store)) return false
  notifyRuntimeActivity(store)
  return true
}
