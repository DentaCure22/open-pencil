import { shallowRef, triggerRef, type ShallowRef } from 'vue'

import type { EditorStore } from '@/app/editor/session'

export type { EditorStore }

type ActiveStoreListener = (store: EditorStore) => void

type ActiveStoreHotData = {
  activeStoreListeners?: Set<ActiveStoreListener>
  storeRef?: ShallowRef<EditorStore | undefined>
}

const hotData = import.meta.hot?.data as ActiveStoreHotData | undefined
// Proxies provided before a Vite update must keep reading the same ref afterward.
const storeRef = hotData?.storeRef ?? shallowRef<EditorStore>()
const activeStoreListeners = hotData?.activeStoreListeners ?? new Set<ActiveStoreListener>()
if (hotData) {
  hotData.storeRef = storeRef
  hotData.activeStoreListeners = activeStoreListeners
}

export function setActiveEditorStore(store: EditorStore) {
  if (storeRef.value === store) return
  storeRef.value = store
  triggerRef(storeRef)
  for (const listener of activeStoreListeners) listener(store)
}

export function onActiveEditorStoreChanged(listener: ActiveStoreListener): () => void {
  activeStoreListeners.add(listener)
  if (storeRef.value) listener(storeRef.value)
  return () => activeStoreListeners.delete(listener)
}

export function getActiveEditorStore(): EditorStore {
  if (!storeRef.value) throw new Error('Editor store not provided')
  return storeRef.value
}

export function getActiveEditorStoreOrNull(): EditorStore | null {
  return storeRef.value ?? null
}

const storeProxy = new Proxy({} as EditorStore, {
  get(_, prop) {
    return Reflect.get(getActiveEditorStore(), prop)
  }
})

export function useEditorStore(): EditorStore {
  return storeProxy
}
