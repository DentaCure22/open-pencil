import type { LocalWorkspaceAuthorityStatus } from './client'

type AvailableLocalWorkspaceAuthority = Pick<LocalWorkspaceAuthorityStatus, 'state'>

export function shouldAllowConcurrentLocalWorkspaceWriters(
  status: AvailableLocalWorkspaceAuthority | null
): boolean {
  return status !== null
}
