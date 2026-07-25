import { readCacheText, writeCacheText } from '@/app/cache'

const PREFERRED_WORKSPACE_KEY = 'openpencil-cloud-workspace'

export function loadPreferredCloudWorkspaceId(): Promise<string | null> {
  return readCacheText(PREFERRED_WORKSPACE_KEY)
}

export function savePreferredCloudWorkspaceId(workspaceId: string): Promise<void> {
  return writeCacheText(PREFERRED_WORKSPACE_KEY, workspaceId)
}
