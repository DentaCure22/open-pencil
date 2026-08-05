import { randomHex } from '@open-pencil/core/random'

import type { EditorStore } from '@/app/editor/session'
import { getTabForStore } from '@/app/tabs'

export type NarratedTraceRuntimeTabIdentity = {
  documentTabId: string
  runtimeInstanceId: string
}

type RuntimeTabBinding = NarratedTraceRuntimeTabIdentity & {
  id: string
}

const bindingsByStore = new WeakMap<EditorStore, RuntimeTabBinding>()
const LOCAL_RUNTIME_INSTANCE_ID = Symbol.for('open-pencil.local-runtime-instance-id')

function localRuntimeInstanceId(): string {
  const current = Reflect.get(globalThis, LOCAL_RUNTIME_INSTANCE_ID)
  if (typeof current === 'string' && current) return current
  const created = `runtime:${randomHex(16)}`
  Reflect.set(globalThis, LOCAL_RUNTIME_INSTANCE_ID, created)
  return created
}

export function readNarratedTraceRuntimeTabIdentity(
  store: EditorStore
): NarratedTraceRuntimeTabIdentity | undefined {
  const documentTabId = getTabForStore(store)?.id
  if (!documentTabId) return undefined
  return { documentTabId, runtimeInstanceId: localRuntimeInstanceId() }
}

export function narratedTraceRuntimeTabBindingForStore(
  store: EditorStore,
  identity: NarratedTraceRuntimeTabIdentity | undefined = readNarratedTraceRuntimeTabIdentity(store)
): string | undefined {
  if (!identity?.documentTabId.trim() || !identity.runtimeInstanceId.trim()) return undefined
  const current = bindingsByStore.get(store)
  if (
    current?.documentTabId === identity.documentTabId &&
    current.runtimeInstanceId === identity.runtimeInstanceId
  ) {
    return current.id
  }
  const next = {
    ...identity,
    id: `trace-runtime-tab:${randomHex(16)}`
  }
  bindingsByStore.set(store, next)
  return next.id
}
