import { IS_BROWSER } from '@open-pencil/core/constants'

export type StoredLocalWorkspaceWriterLease = {
  expiresAt: number
  token: string
}

function browserStorage(): Storage | null {
  if (!IS_BROWSER) return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readLocalWorkspaceWriterLease(key: string): StoredLocalWorkspaceWriterLease | null {
  const storage = browserStorage()
  if (!storage) return null
  try {
    const value = storage.getItem(key)
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<StoredLocalWorkspaceWriterLease>
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null
    return { expiresAt: parsed.expiresAt, token: parsed.token }
  } catch {
    return null
  }
}

export function writeLocalWorkspaceWriterLease(
  key: string,
  lease: StoredLocalWorkspaceWriterLease
): boolean {
  const storage = browserStorage()
  if (!storage) return false
  try {
    storage.setItem(key, JSON.stringify(lease))
    return true
  } catch {
    return false
  }
}

export function removeLocalWorkspaceWriterLease(key: string): void {
  const storage = browserStorage()
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch (error) {
    console.warn('[Local workspace authority] Writer lease cleanup deferred:', error)
  }
}
