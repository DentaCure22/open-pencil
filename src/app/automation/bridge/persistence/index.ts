import type { EditorStore } from '@/app/editor/session'

export const AUTOMATION_PERSISTENCE_TIMEOUT_MS = 2_500

export type AutomationDurablePersistence = {
  authority_id?: string
  authority_revision?: number
  content_hash?: string
  status: 'durable'
  target: 'browser_local' | 'local_workspace_authority'
}

export type AutomationUnknownPersistence = {
  reason:
    | 'concurrent_scene_change'
    | 'persistence_failed'
    | 'persistence_timeout'
    | 'persistence_unavailable'
    | 'save_not_acknowledged'
  status: 'unknown'
}

export type AutomationPersistenceCommit =
  | AutomationDurablePersistence
  | AutomationUnknownPersistence

export type AutomationPersistenceResult = AutomationPersistenceCommit & {
  duration_ms: number
  requested_scene_revision: number
}

export type AutomationPersistenceTransaction = {
  pageId: string
  requestId: string
  route: 'board_build:plan/v1'
}

type AutomationPersistenceBinding = {
  owner: symbol
  persist: (
    requestedSceneRevision: number,
    transaction?: AutomationPersistenceTransaction
  ) => Promise<AutomationPersistenceCommit>
}

const bindings = new WeakMap<EditorStore, AutomationPersistenceBinding>()

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function persistenceFailure(error: unknown): AutomationUnknownPersistence {
  return {
    reason:
      error instanceof Error && error.message === 'persistence_timeout'
        ? 'persistence_timeout'
        : 'persistence_failed',
    status: 'unknown'
  }
}

export function bindAutomationPersistence(
  store: EditorStore,
  persist: AutomationPersistenceBinding['persist']
): () => void {
  const owner = Symbol('automation-persistence-owner')
  bindings.set(store, { owner, persist })
  return () => {
    if (bindings.get(store)?.owner === owner) bindings.delete(store)
  }
}

export async function requestAutomationPersistence(
  store: EditorStore,
  requestedSceneRevision: number,
  timeoutMs = AUTOMATION_PERSISTENCE_TIMEOUT_MS,
  transaction?: AutomationPersistenceTransaction
): Promise<AutomationPersistenceResult> {
  const startedAt = nowMs()
  const binding = bindings.get(store)
  if (!binding) {
    return {
      duration_ms: nowMs() - startedAt,
      reason: 'persistence_unavailable',
      requested_scene_revision: requestedSceneRevision,
      status: 'unknown'
    }
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<AutomationPersistenceCommit>((resolve) => {
    timeout = setTimeout(
      () => resolve({ reason: 'persistence_timeout', status: 'unknown' }),
      timeoutMs
    )
  })
  const attempted = binding.persist(requestedSceneRevision, transaction).catch(persistenceFailure)
  const result = await Promise.race([attempted, timedOut])
  if (timeout) clearTimeout(timeout)
  return {
    ...result,
    duration_ms: nowMs() - startedAt,
    requested_scene_revision: requestedSceneRevision
  }
}
