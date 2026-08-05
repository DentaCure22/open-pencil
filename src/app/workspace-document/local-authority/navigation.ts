import type { LocalWorkspaceAuthorityStatus, LocalWorkspaceNavigationIntent } from './client'

export type LocalWorkspaceNavigationDependencies = {
  consumeIntent(intentId: string): Promise<boolean>
  currentAuthority(): LocalWorkspaceAuthorityStatus | null
  currentPageId(): string
  currentRuntimeInstanceId(): string | null
  openPage(pageId: string): Promise<boolean>
  readIntent(): Promise<LocalWorkspaceNavigationIntent | null>
}

export function createLocalWorkspaceNavigationConsumer(
  dependencies: LocalWorkspaceNavigationDependencies
) {
  let inFlight: Promise<boolean> | null = null

  function consumePending(): Promise<boolean> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      const intent = await dependencies.readIntent()
      if (!intent) return false
      if (
        intent.runtimeInstanceId &&
        intent.runtimeInstanceId !== dependencies.currentRuntimeInstanceId()
      ) {
        return false
      }
      const authority = dependencies.currentAuthority()
      if (
        authority?.state !== 'ready' ||
        intent.authorityId !== authority.authorityId ||
        intent.workspaceId !== authority.identity.workspaceId ||
        intent.contentDocumentId !== authority.identity.documentId
      ) {
        return false
      }

      if (
        dependencies.currentPageId() !== intent.pageId &&
        !(await dependencies.openPage(intent.pageId))
      ) {
        return false
      }
      if (dependencies.currentPageId() !== intent.pageId) return false
      return dependencies.consumeIntent(intent.intentId)
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return { consumePending }
}
