import type { AutomationPersistenceTransaction } from '@/app/automation/bridge/persistence'
import { restoreReloadState, type ReloadStateSnapshot } from '@/app/document/io/reload-state'
import type { EditorStore } from '@/app/editor/session'
import {
  applySmylrProductionDocument,
  saveSmylrProductionDocument,
  serializeSmylrProductionDocumentForAuthority
} from '@/app/smylr-production/document-state'
import { loadOpenPencilWorkspaceSourceIdentity } from '@/app/workspace-document/identity'

import {
  type LocalWorkspaceAuthorityHead,
  type LocalWorkspaceAuthorityStatus,
  commitLocalWorkspaceAuthority,
  currentLocalWorkspaceAuthorityStatus,
  initializeLocalWorkspaceAuthority,
  LocalWorkspaceAuthorityClientError,
  preserveLocalWorkspaceAuthorityRecovery,
  readLocalWorkspaceAuthorityHead,
  refreshLocalWorkspaceAuthorityStatus
} from './client'

export type LocalWorkspaceDocumentAuthorityDependencies = {
  applyDocument(store: EditorStore, value: unknown): Promise<boolean>
  readHead(): Promise<LocalWorkspaceAuthorityHead | null>
  refreshStatus?(): Promise<LocalWorkspaceAuthorityStatus | null>
}

export type LocalWorkspaceDocumentAuthorityOptions = {
  canWrite(): boolean
  isCloudActive(): boolean
  onBlocked(options: { newerHead: boolean }): void
  onHeadApplied?(head: LocalWorkspaceAuthorityHead, store: EditorStore): void
  onLocalHeadCommitted(): void
}

type AuthorityDocument = NonNullable<
  ReturnType<typeof serializeSmylrProductionDocumentForAuthority>
>

export type LocalWorkspaceAuthorityOperationSerializer = <T>(
  operation: () => Promise<T>
) => Promise<T>

export type LocalWorkspaceAuthorityGraphBase = {
  advance(contentHash: string): void
  clear(): void
  hasDiverged(contentHash: string | null): boolean
}

export function createLocalWorkspaceAuthorityGraphBase(): LocalWorkspaceAuthorityGraphBase {
  let graphBaseContentHash: string | null = null
  return {
    advance(contentHash) {
      graphBaseContentHash = contentHash
    },
    clear() {
      graphBaseContentHash = null
    },
    hasDiverged(contentHash) {
      return graphBaseContentHash === null || contentHash !== graphBaseContentHash
    }
  }
}

export function createSerializedLocalWorkspaceAuthorityOperations(): LocalWorkspaceAuthorityOperationSerializer {
  let tail = Promise.resolve()
  return <T>(operation: () => Promise<T>) => {
    const queued = tail.then(operation, operation)
    tail = queued.then(
      () => undefined,
      () => undefined
    )
    return queued
  }
}

// EditorView can remount while its previous instance still has a final save in flight.
// Keep restore, persist, and head observation on one revision/status timeline.
const serializeLocalWorkspaceAuthorityOperation =
  createSerializedLocalWorkspaceAuthorityOperations()

export function createSerializedLocalWorkspacePersist<TStore>(
  persistOnce: (store: TStore, transaction?: AutomationPersistenceTransaction) => Promise<boolean>,
  serializeOperation = createSerializedLocalWorkspaceAuthorityOperations()
): (store: TStore, transaction?: AutomationPersistenceTransaction) => Promise<boolean> {
  return (store, transaction) => serializeOperation(() => persistOnce(store, transaction))
}

async function preserveRecovery(options: {
  authorityId: string
  baseRevision: number
  document: AuthorityDocument
  reason: string
  requestId: string
  workspaceId: string
}): Promise<void> {
  await preserveLocalWorkspaceAuthorityRecovery(options).catch((error) => {
    console.error('[Local workspace authority] Recovery preservation failed:', error)
  })
}

export function createLocalWorkspaceDocumentAuthority(
  options: LocalWorkspaceDocumentAuthorityOptions,
  dependencies: Partial<LocalWorkspaceDocumentAuthorityDependencies> = {}
) {
  const graphBase = createLocalWorkspaceAuthorityGraphBase()
  const applyDocument = dependencies.applyDocument ?? applySmylrProductionDocument
  const readHead = dependencies.readHead ?? readLocalWorkspaceAuthorityHead
  const refreshStatus = dependencies.refreshStatus ?? refreshLocalWorkspaceAuthorityStatus

  async function restore(
    store: EditorStore,
    restoreBrowserCopy: () => Promise<boolean>,
    reloadState: ReloadStateSnapshot | null = null
  ): Promise<boolean> {
    return serializeLocalWorkspaceAuthorityOperation(async () => {
      try {
        const authorityHead = await readHead()
        if (!authorityHead) {
          graphBase.clear()
          const restored = await restoreBrowserCopy()
          if (restored && reloadState) await restoreReloadState(store, reloadState)
          return restored
        }
        const restored = await applyDocument(store, authorityHead.document)
        if (restored) {
          graphBase.advance(authorityHead.contentHash)
          if (reloadState) await restoreReloadState(store, reloadState)
          options.onHeadApplied?.(authorityHead, store)
        } else graphBase.clear()
        return restored
      } catch (error) {
        graphBase.clear()
        console.warn(
          '[Local workspace authority] Head restore failed; using the preserved browser copy:',
          error
        )
        const restored = await restoreBrowserCopy()
        if (restored && reloadState) await restoreReloadState(store, reloadState)
        return restored
      }
    })
  }

  async function persistOnce(
    store: EditorStore,
    transaction?: AutomationPersistenceTransaction
  ): Promise<boolean> {
    if (options.isCloudActive()) return true
    if (!options.canWrite()) return false

    const authorityStatus = (await refreshStatus()) ?? currentLocalWorkspaceAuthorityStatus()
    if (authorityStatus) {
      const document = serializeSmylrProductionDocumentForAuthority(store)
      if (!document) return false
      const requestId = `workspace-save-${crypto.randomUUID()}`
      try {
        if (authorityStatus.state === 'configured') {
          const sourceIdentity = await loadOpenPencilWorkspaceSourceIdentity()
          if (
            !authorityStatus.seedWorkspaceId ||
            sourceIdentity.workspaceId !== authorityStatus.seedWorkspaceId
          ) {
            await preserveRecovery({
              authorityId: authorityStatus.authorityId,
              baseRevision: 0,
              document,
              reason: `Seed requires ${authorityStatus.seedWorkspaceId ?? 'explicit selection'}; this browser contains ${sourceIdentity.workspaceId}`,
              requestId,
              workspaceId: sourceIdentity.workspaceId
            })
            options.onBlocked({ newerHead: false })
            return false
          }
          const receipt = await initializeLocalWorkspaceAuthority(
            sourceIdentity.workspaceId,
            document,
            requestId
          )
          graphBase.advance(receipt.contentHash)
        } else {
          const expectedContentHash = authorityStatus.contentHash
          if (!expectedContentHash || graphBase.hasDiverged(expectedContentHash)) {
            await preserveRecovery({
              authorityId: authorityStatus.authorityId,
              baseRevision: authorityStatus.revision,
              document,
              reason:
                'Browser graph base is absent or differs from the current authority head; restore the current authority head before saving',
              requestId,
              workspaceId: authorityStatus.identity.workspaceId
            })
            options.onBlocked({ newerHead: true })
            return false
          }
          const receipt = await commitLocalWorkspaceAuthority(
            authorityStatus.identity.workspaceId,
            authorityStatus.revision,
            expectedContentHash,
            document,
            requestId,
            transaction
          )
          graphBase.advance(receipt.contentHash)
        }
      } catch (error) {
        await preserveRecovery({
          authorityId: authorityStatus.authorityId,
          baseRevision: authorityStatus.revision,
          document,
          reason: error instanceof Error ? error.message : String(error),
          requestId,
          workspaceId: authorityStatus.identity.workspaceId
        })
        options.onBlocked({
          newerHead:
            error instanceof LocalWorkspaceAuthorityClientError &&
            (error.code === 'stale_revision' || error.code === 'stale_content_hash')
        })
        console.error('[Local workspace authority] Save rejected:', error)
        return false
      }
    }

    const saved = await saveSmylrProductionDocument(store)
    if (saved) options.onLocalHeadCommitted()
    return saved
  }

  const persist = createSerializedLocalWorkspacePersist(
    persistOnce,
    serializeLocalWorkspaceAuthorityOperation
  )

  async function hasNewerHead(): Promise<boolean> {
    return serializeLocalWorkspaceAuthorityOperation(async () => {
      if (options.isCloudActive()) return false
      const current = await refreshLocalWorkspaceAuthorityStatus()
      return Boolean(current?.state === 'ready' && graphBase.hasDiverged(current.contentHash))
    })
  }

  return { hasNewerHead, persist, restore }
}
