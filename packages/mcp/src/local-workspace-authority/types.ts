import type { Rect } from '@open-pencil/scene-graph/primitives'

export const LOCAL_WORKSPACE_AUTHORITY_VERSION = 1
export const LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION = 1
export const LOCAL_WORKSPACE_PRESENCE_SELECTION_LIMIT = 24
export const LOCAL_AUTHORITY_BOARD_CAPABILITIES = [
  'board.open.queued_navigation',
  'board.read.page',
  'board.read.objects',
  'board.read.code_object',
  'board.read.mermaid_source',
  'board.read.memory_search',
  'board.read.screenshot.persisted',
  'trace.read.persisted'
] as const

export type LocalWorkspaceIdentity = {
  documentId: string
  documentName: string
  roomId: string
  schemaVersion: number
  workspaceId: string
}

export type LocalWorkspaceCommitStatus = 'committed' | 'initialized' | 'unchanged'

export type LocalWorkspaceCommitReceipt = {
  appliedRevision: number
  authorityId: string
  baseRevision: number
  contentHash: string
  committedAt: string
  requestId: string
  status: LocalWorkspaceCommitStatus
  workspaceId: string
}

export type LocalWorkspaceAuthorityStatus = {
  authorityId: string
  contentHash: string | null
  identity: LocalWorkspaceIdentity
  revision: number
  seedWorkspaceId: string | null
  state: 'configured' | 'ready'
  updatedAt: string | null
  version: typeof LOCAL_WORKSPACE_AUTHORITY_VERSION
}

export type LocalWorkspaceAuthorityHead = {
  authorityId: string
  contentHash: string
  document: unknown
  identity: LocalWorkspaceIdentity
  revision: number
  updatedAt: string
  version: typeof LOCAL_WORKSPACE_AUTHORITY_VERSION
}

export type LocalWorkspaceNavigationRegion = Rect

export type LocalWorkspaceNavigationIntent = {
  authorityId: string
  contentDocumentId: string
  consumedAt: string | null
  createdAt: string
  expiresAt: string
  intentId: string
  /** Exact Board object IDs to select and reveal after the page opens. */
  objectIds?: string[]
  pageId: string
  /** Page-space rectangle to frame after the page opens. */
  region?: LocalWorkspaceNavigationRegion
  runtimeInstanceId?: string
  sequence: number
  version: typeof LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION
  workspaceId: string
}

export type QueueLocalWorkspaceNavigationRequest = {
  contentDocumentId: string
  objectIds?: string[]
  pageId: string
  region?: LocalWorkspaceNavigationRegion
  runtimeInstanceId?: string
  ttlMs?: number
  workspaceId: string
}

export type LocalWorkspacePresenceViewport = {
  panX: number
  panY: number
  zoom: number
}

/** Latest editor heartbeat: which Board the user is looking at right now. */
export type LocalWorkspacePresence = {
  authorityId: string
  contentDocumentId: string
  pageId: string
  pageName: string
  runtimeInstanceId?: string
  selectedIds?: string[]
  selectionTruncated?: boolean
  updatedAt: string
  version: 1
  viewport?: LocalWorkspacePresenceViewport
  workspaceId: string
}

export type RecordLocalWorkspacePresenceRequest = {
  contentDocumentId: string
  pageId: string
  pageName: string
  runtimeInstanceId?: string
  selectedIds?: string[]
  selectionTruncated?: boolean
  viewport?: LocalWorkspacePresenceViewport
  workspaceId: string
}

export const LOCAL_WORKSPACE_THEME_INTENT_VERSION = 1

export type LocalWorkspaceThemeSetting = 'auto' | 'dark' | 'light'

/** Latest-wins appearance request for the live OpenPencil window. */
export type LocalWorkspaceThemeIntent = {
  consumedAt: string | null
  createdAt: string
  sequence: number
  theme: LocalWorkspaceThemeSetting
  updatedAt: string
  version: typeof LOCAL_WORKSPACE_THEME_INTENT_VERSION
}

export type RecordLocalWorkspaceThemeRequest = {
  theme: LocalWorkspaceThemeSetting
}

export type QueueResolvedLocalWorkspaceNavigationRequest = {
  objectIds?: string[]
  pageId?: string
  pageName?: string
  query?: string
  region?: LocalWorkspaceNavigationRegion
  runtimeInstanceId?: string
  ttlMs?: number
}

export type InitializeLocalWorkspaceRequest = {
  document: unknown
  requestId: string
  sourceWorkspaceId: string
}

export type CommitLocalWorkspaceRequest = {
  document: unknown
  expectedContentHash: string
  expectedRevision: number
  requestId: string
  workspaceId: string
}
