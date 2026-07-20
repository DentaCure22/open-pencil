import type { EditorStore } from '../editor/session'
import {
  liveWorkspaceItemsForSync,
  replaceLiveWorkspaceItemsFromSync
} from '../smylr-live-inspector/workspace'
import {
  applySmylrProductionDocument,
  saveSmylrProductionDocument,
  serializeSmylrProductionDocumentForSync
} from './document-state'
import { isWorkspaceItemTombstoned } from './live/frame-tombstones'

const API_URL = '/api/open-pencil/workspace?key=smylr-production'
const WORKSPACE_KEY = 'smylr-production'

type SharedContent = {
  document: unknown
  version: 1
  workspaceItems: unknown[]
}

type SharedWorkspace = {
  content: SharedContent
  revision: number
  updatedAt: string
}

type SharedRestoreResult = 'missing' | 'restored' | 'unavailable'

let sharedRevision: number | null = null
let applyingSharedDocument = false
let sharedContentFingerprint: string | null = null
let sharedConflict = false
let sharedReadUnavailable = false
let sharedRestoreComplete = false
let sharedSaveQueue: Promise<boolean> = Promise.resolve(true)

function fingerprintSharedContent(content: SharedContent) {
  return JSON.stringify(content)
}

function sharedContentScore(content: SharedContent) {
  const document = content.document as { nodes?: unknown[] } | null
  const nodeCount = Array.isArray(document?.nodes) ? document.nodes.length : 0
  return content.workspaceItems.length * 1_000_000 + nodeCount
}

function currentSharedContent(store: EditorStore) {
  const document = serializeSmylrProductionDocumentForSync(store)
  if (!document) return null
  const content: SharedContent = {
    document,
    version: 1,
    workspaceItems: liveWorkspaceItemsForSync()
  }
  return { content, fingerprint: fingerprintSharedContent(content) }
}

function isSharedWorkspace(value: unknown): value is SharedWorkspace {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<SharedWorkspace>
  const content = candidate.content as Partial<SharedContent> | undefined
  return Boolean(
    Number.isInteger(candidate.revision) &&
    typeof candidate.updatedAt === 'string' &&
    content?.version === 1 &&
    Array.isArray(content.workspaceItems)
  )
}

function withoutTombstonedWorkspaceItems(items: unknown[]) {
  return items.filter((item) => {
    if (!item || typeof item !== 'object' || !('id' in item)) return true
    const id = (item as { id?: unknown }).id
    return typeof id !== 'string' || !isWorkspaceItemTombstoned(id)
  })
}

async function readSharedWorkspace(): Promise<SharedWorkspace | null | undefined> {
  try {
    const response = await fetch(API_URL, { cache: 'no-store', credentials: 'same-origin' })
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 160)
      console.warn(
        `[Smylr Production Workspace] shared read failed (${response.status}): ${detail}`
      )
      return undefined
    }
    const body = (await response.json()) as { error?: unknown; workspace?: unknown }
    return isSharedWorkspace(body.workspace) ? body.workspace : null
  } catch {
    return undefined
  }
}

async function applySharedWorkspace(store: EditorStore, workspace: SharedWorkspace) {
  applyingSharedDocument = true
  try {
    const documentApplied = await applySmylrProductionDocument(store, workspace.content.document)
    const itemsApplied = replaceLiveWorkspaceItemsFromSync(
      withoutTombstonedWorkspaceItems(workspace.content.workspaceItems)
    )
    if (!documentApplied || !itemsApplied) return false
    sharedRevision = workspace.revision
    // Keep the server fingerprint as the baseline. If local tombstones removed
    // nodes/items during apply, the next persistence pass must canonicalize that
    // deletion instead of treating the stale remote document as already saved.
    sharedContentFingerprint = fingerprintSharedContent(workspace.content)
    sharedConflict = false
    await saveSmylrProductionDocument(store)
    return true
  } finally {
    applyingSharedDocument = false
  }
}

export function isApplyingSharedSmylrProductionDocument() {
  return applyingSharedDocument
}

export async function restoreSharedSmylrProductionWorkspace(
  store: EditorStore
): Promise<SharedRestoreResult> {
  try {
    const workspace = await readSharedWorkspace()
    if (workspace === undefined) {
      sharedReadUnavailable = true
      return 'unavailable'
    }
    sharedReadUnavailable = false
    if (workspace === null) {
      sharedRevision = 0
      sharedContentFingerprint = null
      sharedConflict = false
      return 'missing'
    }
    const localContent = currentSharedContent(store)
    if (
      workspace.revision === 1 &&
      localContent &&
      sharedContentScore(localContent.content) > sharedContentScore(workspace.content)
    ) {
      sharedRevision = 0
      sharedContentFingerprint = null
      sharedConflict = false
      sharedRestoreComplete = true
      return (await saveSharedSmylrProductionWorkspace(store)) ? 'restored' : 'unavailable'
    }
    return (await applySharedWorkspace(store, workspace)) ? 'restored' : 'unavailable'
  } finally {
    sharedRestoreComplete = true
  }
}

export async function refreshSharedSmylrProductionWorkspace(store: EditorStore) {
  if (applyingSharedDocument) return false
  const workspace = await readSharedWorkspace()
  if (!workspace) return false
  sharedReadUnavailable = false
  const current = currentSharedContent(store)
  const hasUnsavedLocalChanges = Boolean(
    current && sharedContentFingerprint && current.fingerprint !== sharedContentFingerprint
  )
  if (hasUnsavedLocalChanges && !sharedConflict) return false
  if (!sharedConflict && workspace.revision <= (sharedRevision ?? 0)) return false
  return applySharedWorkspace(store, workspace)
}

async function saveSharedSmylrProductionWorkspaceNow(store: EditorStore) {
  if (!sharedRestoreComplete || applyingSharedDocument || sharedConflict || sharedReadUnavailable)
    return false
  const current = currentSharedContent(store)
  if (!current) return false
  if (current.fingerprint === sharedContentFingerprint) return true
  try {
    const baseRevision = sharedRevision ?? 0
    let response = await fetch(API_URL, {
      body: JSON.stringify({
        baseRevision,
        content: current.content,
        workspaceKey: WORKSPACE_KEY
      }),
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT'
    })
    let body = (await response.json()) as { error?: unknown; workspace?: unknown }
    if (response.status === 409 && isSharedWorkspace(body.workspace)) {
      const remoteWorkspace = body.workspace
      if (
        baseRevision === 0 &&
        sharedContentScore(current.content) > sharedContentScore(remoteWorkspace.content)
      ) {
        response = await fetch(API_URL, {
          body: JSON.stringify({
            baseRevision: 0,
            bootstrapPromotion: true,
            content: current.content,
            workspaceKey: WORKSPACE_KEY
          }),
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          method: 'PUT'
        })
        body = (await response.json()) as { error?: unknown; workspace?: unknown }
        if (response.ok && isSharedWorkspace(body.workspace)) {
          sharedRevision = body.workspace.revision
          sharedContentFingerprint = current.fingerprint
          sharedConflict = false
          return true
        }
        if (
          response.status === 409 &&
          isSharedWorkspace(body.workspace) &&
          sharedContentScore(body.workspace.content) >= sharedContentScore(current.content)
        ) {
          return applySharedWorkspace(store, body.workspace)
        }
      }
      sharedRevision = remoteWorkspace.revision
      sharedConflict = true
      console.warn(
        '[Smylr Production Workspace] shared save conflict; refresh to use canonical canvas'
      )
      return false
    }
    if (!response.ok || !isSharedWorkspace(body.workspace)) {
      console.warn(
        `[Smylr Production Workspace] shared save failed (${response.status}): ${String(body.error ?? '')}`
      )
      return false
    }
    sharedRevision = body.workspace.revision
    sharedContentFingerprint = current.fingerprint
    sharedConflict = false
    return true
  } catch {
    return false
  }
}

export function saveSharedSmylrProductionWorkspace(store: EditorStore) {
  // Multiple graph events can finish the debounce together. Serialize PUTs so
  // two writes never race with the same base revision and manufacture a 409
  // conflict against our own immediately preceding save.
  sharedSaveQueue = sharedSaveQueue.then(
    () => saveSharedSmylrProductionWorkspaceNow(store),
    () => saveSharedSmylrProductionWorkspaceNow(store)
  )
  return sharedSaveQueue
}
