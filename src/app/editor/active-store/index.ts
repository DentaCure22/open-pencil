import { shallowRef, triggerRef } from 'vue'

import type { EditorStore } from '@/app/editor/session'
import { bindNarratedTraceEditor } from '@/app/narrated-trace'

export type { EditorStore }

const storeRef = shallowRef<EditorStore>()

export function setActiveEditorStore(store: EditorStore) {
  storeRef.value = store
  triggerRef(storeRef)
  bindNarratedTraceEditor(store)
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
