export const LOCAL_WORKSPACE_AUTHORITY_VERSION = 1
export const LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION = 1
export const LOCAL_AUTHORITY_BOARD_CAPABILITIES = [
  'board.open.queued_navigation',
  'board.create.page',
  'board.read.page',
  'board.read.objects',
  'board.read.code_object',
  'board.read.mermaid_source',
  'board.read.memory_search',
  'board.build.native_text.anchor',
  'board.build.native_text.auto_placement',
  'board.build.native_card.auto_placement',
  'board.build.native_card.explicit_placement',
  'board.build.native_diagram.mermaid.headless',
  'board.build.plan.v1',
  'board.build.plan.grid.v1',
  'board.build.plan.flow.v1',
  'board.build.transaction.revert.v1',
  'board.build.plan.canonical_object_identity.v1',
  'board.build.code_object.tsx.create.staged',
  'board.build.code_object.tsx.refine.staged',
  'board.change.object.update',
  'board.change.object.move',
  'board.change.object.resize',
  'board.change.object.delete',
  'board.change.object.duplicate',
  'board.change.object_graph.connect',
  'board.prepare_edit.trace.persisted',
  'board.fixture.capture_assert_reset.external',
  'board.verify.request',
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

export type LocalWorkspaceCommitTransaction = {
  pageId: string
  requestId: string
  route: 'board_build:plan/v1'
}

export type LocalWorkspaceCommitReceipt = {
  appliedRevision: number
  authorityId: string
  baseRevision: number
  contentHash: string
  committedAt: string
  requestId: string
  status: LocalWorkspaceCommitStatus
  transaction?: LocalWorkspaceCommitTransaction
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

export type LocalWorkspaceNavigationIntent = {
  authorityId: string
  contentDocumentId: string
  consumedAt: string | null
  createdAt: string
  expiresAt: string
  intentId: string
  pageId: string
  runtimeInstanceId?: string
  sequence: number
  version: typeof LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION
  workspaceId: string
}

export type QueueLocalWorkspaceNavigationRequest = {
  contentDocumentId: string
  pageId: string
  runtimeInstanceId?: string
  ttlMs?: number
  workspaceId: string
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
  transaction?: LocalWorkspaceCommitTransaction
  workspaceId: string
}
