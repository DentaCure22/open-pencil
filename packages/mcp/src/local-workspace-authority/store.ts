import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'

import { normalizeTraceSessionTag, type WorkspaceSearchResult } from '@open-pencil/core/rpc'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { readAuthorityBoardDocument } from './document'
import {
  findJsonHistoryRevisionByHash,
  jsonFileMarker,
  pruneJsonHistory,
  readJsonFile,
  readJsonHistory,
  readSerializedJsonFile,
  writeJsonFile,
  writeJsonHistory,
  writeSerializedJsonFile
} from './json-file'
import { documentMayNeedMermaidMaterialization } from './mermaid-presence'
import { normalizeLocalWorkspaceTraceGesture, type LocalWorkspaceTraceGestureRead } from './trace'
import {
  LocalWorkspaceTraceFileStore,
  type LocalWorkspaceTraceEvidenceOverview,
  type LocalWorkspaceTraceEvidencePinResult
} from './trace-file-store'
import {
  gestureWithEvidenceReference,
  sameTraceSessionReferences,
  traceEvidenceReferences,
  traceSession,
  traceSpokenTurn,
  traceSummary
} from './trace-history'
import {
  replayTraceFileEvents,
  resolveDirectTraceBoardContext,
  selectDirectTrace,
  traceActivityPage,
  type LocalWorkspaceTraceActivityPage,
  type LocalWorkspaceTraceHistorySnapshot,
  type TraceFileSnapshot
} from './trace-replay'
import {
  LOCAL_WORKSPACE_AUTHORITY_VERSION,
  LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION,
  LOCAL_WORKSPACE_PRESENCE_SELECTION_LIMIT,
  LOCAL_WORKSPACE_SCREENSHOT_INTENT_VERSION,
  LOCAL_WORKSPACE_THEME_INTENT_VERSION,
  type CompleteLocalWorkspaceScreenshotRequest,
  type CommitLocalWorkspaceRequest,
  type InitializeLocalWorkspaceRequest,
  type LocalWorkspaceAuthorityHead,
  type LocalWorkspaceAuthorityStatus,
  type LocalWorkspaceCommitReceipt,
  type LocalWorkspaceIdentity,
  type LocalWorkspaceNavigationIntent,
  type LocalWorkspacePresence,
  type LocalWorkspaceScreenshotIntent,
  type LocalWorkspaceScreenshotResult,
  type LocalWorkspaceThemeIntent,
  type QueueLocalWorkspaceNavigationRequest,
  type QueueLocalWorkspaceScreenshotRequest,
  type QueueResolvedLocalWorkspaceNavigationRequest,
  type RecordLocalWorkspacePresenceRequest,
  type RecordLocalWorkspaceThemeRequest
} from './types'
import { restoreUnchangedAuthorityImages } from './unchanged-images'
import { restoreUnchangedAuthorityPages } from './unchanged-pages'
import {
  ensureWorkspaceJsonlIndex,
  type WorkspaceJsonlIndexPrevious
} from './workspace-jsonl-index'

const AUTHORITY_METADATA_FILE = 'authority.json'
const AUTHORITY_DOCUMENT_FILE = 'workspace.json'
const AUTHORITY_LEDGER_FILE = 'workspace-state.json'
const AUTHORITY_NAVIGATION_FILE = 'navigation.json'
const AUTHORITY_PRESENCE_FILE = 'presence.json'
const AUTHORITY_SCREENSHOT_INTENT_FILE = 'screenshot-intent.json'
const AUTHORITY_SCREENSHOT_RESULT_FILE = 'screenshot-result.json'
const AUTHORITY_THEME_FILE = 'theme.json'
const AUTHORITY_HISTORY_DIRECTORY = 'history'
const MAX_HISTORY_SNAPSHOTS = 64
const MAX_RECEIPTS = 500
const DEFAULT_NAVIGATION_INTENT_TTL_MS = 60_000
const DEFAULT_SCREENSHOT_INTENT_TTL_MS = 10_000
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
const rootWriteTails = new Map<string, Promise<void>>()
const rootDeferredWriteTails = new Map<string, { owner: object; tail: Promise<void> }>()

export { LOCAL_WORKSPACE_TRACE_ACTIVITY_PAGE_CONTRACT } from './trace-replay'

type PersistedLocalWorkspaceAuthorityMetadata = {
  authorityId: string
  identity: LocalWorkspaceIdentity
  seedWorkspaceId: string | null
  version: typeof LOCAL_WORKSPACE_AUTHORITY_VERSION
}

type PersistedLocalWorkspaceAuthorityState = {
  authorityId: string
  contentHash: string
  document: unknown
  identity: LocalWorkspaceIdentity
  receipts: Partial<Record<string, LocalWorkspaceCommitReceipt>>
  revision: number
  updatedAt: string
  version: typeof LOCAL_WORKSPACE_AUTHORITY_VERSION
}

type PersistedLocalWorkspaceAuthorityLedger = Pick<
  PersistedLocalWorkspaceAuthorityState,
  'contentHash' | 'receipts' | 'revision' | 'updatedAt' | 'version'
>

type LocalWorkspaceAuthorityStateCache = {
  documentMarker: string
  ledgerMarker: string
  pendingDocumentWrite: boolean
  state: PersistedLocalWorkspaceAuthorityState | null
  status: LocalWorkspaceAuthorityStatus
}

export type LocalWorkspaceAuthorityStoreOptions = {
  preferredWorkspaceId?: string | null
  root: string
  semanticServices?: boolean
}

export type LocalWorkspaceAuthorityHeadListener = (receipt: LocalWorkspaceCommitReceipt) => void
export type LocalWorkspaceAuthorityNavigationListener = (
  intent: LocalWorkspaceNavigationIntent
) => void
export type LocalWorkspaceAuthorityScreenshotListener = (
  intent: LocalWorkspaceScreenshotIntent
) => void
export type LocalWorkspaceAuthorityThemeListener = (intent: LocalWorkspaceThemeIntent) => void

export class LocalWorkspaceAuthorityStoreError extends Error {
  override name = 'LocalWorkspaceAuthorityStoreError'

  constructor(
    readonly code:
      | 'already_initialized'
      | 'idempotency_conflict'
      | 'invalid_document'
      | 'seed_workspace_mismatch'
      | 'stale_content_hash'
      | 'stale_revision'
      | 'workspace_mismatch',
    message: string,
    readonly currentRevision?: number
  ) {
    super(message)
  }
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function normalizedId(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function createIdentity(preferredWorkspaceId: string | null): LocalWorkspaceIdentity {
  return {
    documentId: `document-${randomUUID()}`,
    documentName: 'OpenPencil Workspace',
    roomId: `workspace-room-${randomUUID()}`,
    schemaVersion: 1,
    workspaceId: preferredWorkspaceId ?? `workspace-${randomUUID()}`
  }
}

function isIdentity(value: unknown): value is LocalWorkspaceIdentity {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspaceIdentity>
  return Boolean(
    typeof candidate.documentId === 'string' &&
    candidate.documentId.length > 0 &&
    typeof candidate.documentName === 'string' &&
    candidate.documentName.length > 0 &&
    typeof candidate.roomId === 'string' &&
    candidate.roomId.length > 0 &&
    typeof candidate.schemaVersion === 'number' &&
    typeof candidate.workspaceId === 'string' &&
    candidate.workspaceId.length > 0
  )
}

function isMetadata(value: unknown): value is PersistedLocalWorkspaceAuthorityMetadata {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedLocalWorkspaceAuthorityMetadata>
  return Boolean(
    candidate.version === LOCAL_WORKSPACE_AUTHORITY_VERSION &&
    typeof candidate.authorityId === 'string' &&
    candidate.authorityId.length > 0 &&
    (candidate.seedWorkspaceId === null || typeof candidate.seedWorkspaceId === 'string') &&
    isIdentity(candidate.identity)
  )
}

function isReceipt(value: unknown): value is LocalWorkspaceCommitReceipt {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspaceCommitReceipt>
  return Boolean(
    typeof candidate.appliedRevision === 'number' &&
    typeof candidate.authorityId === 'string' &&
    typeof candidate.baseRevision === 'number' &&
    typeof candidate.contentHash === 'string' &&
    typeof candidate.committedAt === 'string' &&
    typeof candidate.requestId === 'string' &&
    (candidate.status === 'committed' ||
      candidate.status === 'initialized' ||
      candidate.status === 'unchanged') &&
    typeof candidate.workspaceId === 'string'
  )
}

function isState(value: unknown): value is PersistedLocalWorkspaceAuthorityState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedLocalWorkspaceAuthorityState>
  return Boolean(
    candidate.version === LOCAL_WORKSPACE_AUTHORITY_VERSION &&
    typeof candidate.authorityId === 'string' &&
    typeof candidate.contentHash === 'string' &&
    Object.hasOwn(candidate, 'document') &&
    isIdentity(candidate.identity) &&
    candidate.receipts &&
    typeof candidate.receipts === 'object' &&
    Object.values(candidate.receipts).every(isReceipt) &&
    typeof candidate.revision === 'number' &&
    typeof candidate.updatedAt === 'string'
  )
}

function isLedger(value: unknown): value is PersistedLocalWorkspaceAuthorityLedger {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<PersistedLocalWorkspaceAuthorityLedger>
  return Boolean(
    candidate.version === LOCAL_WORKSPACE_AUTHORITY_VERSION &&
    typeof candidate.contentHash === 'string' &&
    candidate.receipts &&
    typeof candidate.receipts === 'object' &&
    Object.values(candidate.receipts).every(isReceipt) &&
    typeof candidate.revision === 'number' &&
    Number.isInteger(candidate.revision) &&
    candidate.revision > 0 &&
    typeof candidate.updatedAt === 'string'
  )
}

function isNavigationRegion(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Rect>
  return (
    typeof candidate.x === 'number' &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === 'number' &&
    Number.isFinite(candidate.y) &&
    typeof candidate.width === 'number' &&
    Number.isFinite(candidate.width) &&
    candidate.width > 0 &&
    typeof candidate.height === 'number' &&
    Number.isFinite(candidate.height) &&
    candidate.height > 0
  )
}

function isNavigationObjectIds(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((id) => typeof id === 'string' && id.length > 0))
  )
}

function isThemeSetting(value: unknown): value is LocalWorkspaceThemeIntent['theme'] {
  return value === 'auto' || value === 'dark' || value === 'light'
}

function isThemeIntent(value: unknown): value is LocalWorkspaceThemeIntent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspaceThemeIntent>
  return Boolean(
    candidate.version === LOCAL_WORKSPACE_THEME_INTENT_VERSION &&
    (candidate.consumedAt === null || typeof candidate.consumedAt === 'string') &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.sequence === 'number' &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence >= 1 &&
    isThemeSetting(candidate.theme) &&
    typeof candidate.updatedAt === 'string'
  )
}

function isPresenceSelection(selectedIds: unknown, selectionTruncated: unknown): boolean {
  return (
    (selectedIds === undefined ||
      (Array.isArray(selectedIds) &&
        selectedIds.length <= LOCAL_WORKSPACE_PRESENCE_SELECTION_LIMIT &&
        selectedIds.every((id) => typeof id === 'string' && id.length > 0))) &&
    (selectionTruncated === undefined || typeof selectionTruncated === 'boolean')
  )
}

function isPresence(value: unknown): value is LocalWorkspacePresence {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspacePresence>
  const viewport = candidate.viewport
  return Boolean(
    candidate.version === 1 &&
    typeof candidate.authorityId === 'string' &&
    typeof candidate.contentDocumentId === 'string' &&
    typeof candidate.pageId === 'string' &&
    typeof candidate.pageName === 'string' &&
    (candidate.runtimeInstanceId === undefined ||
      typeof candidate.runtimeInstanceId === 'string') &&
    isPresenceSelection(candidate.selectedIds, candidate.selectionTruncated) &&
    typeof candidate.updatedAt === 'string' &&
    (viewport === undefined ||
      (typeof viewport === 'object' &&
        typeof viewport.panX === 'number' &&
        Number.isFinite(viewport.panX) &&
        typeof viewport.panY === 'number' &&
        Number.isFinite(viewport.panY) &&
        typeof viewport.zoom === 'number' &&
        Number.isFinite(viewport.zoom))) &&
    typeof candidate.workspaceId === 'string'
  )
}

function isNavigationIntent(value: unknown): value is LocalWorkspaceNavigationIntent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspaceNavigationIntent>
  return Boolean(
    candidate.version === LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION &&
    typeof candidate.authorityId === 'string' &&
    typeof candidate.contentDocumentId === 'string' &&
    (candidate.consumedAt === null || typeof candidate.consumedAt === 'string') &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.intentId === 'string' &&
    isNavigationObjectIds(candidate.objectIds) &&
    typeof candidate.pageId === 'string' &&
    (candidate.region === undefined || isNavigationRegion(candidate.region)) &&
    (candidate.runtimeInstanceId === undefined ||
      typeof candidate.runtimeInstanceId === 'string') &&
    typeof candidate.sequence === 'number' &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence > 0 &&
    typeof candidate.workspaceId === 'string'
  )
}

function isScreenshotIntent(value: unknown): value is LocalWorkspaceScreenshotIntent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspaceScreenshotIntent>
  return Boolean(
    candidate.version === LOCAL_WORKSPACE_SCREENSHOT_INTENT_VERSION &&
    typeof candidate.authorityId === 'string' &&
    typeof candidate.contentDocumentId === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    Array.isArray(candidate.objectIds) &&
    candidate.objectIds.length > 0 &&
    candidate.objectIds.length <= 8 &&
    candidate.objectIds.every((id) => typeof id === 'string' && id.length > 0) &&
    typeof candidate.pageId === 'string' &&
    typeof candidate.requestId === 'string' &&
    typeof candidate.sequence === 'number' &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence > 0 &&
    typeof candidate.workspaceId === 'string'
  )
}

function isScreenshotResult(value: unknown): value is LocalWorkspaceScreenshotResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspaceScreenshotResult>
  if (
    (candidate.status !== 'completed' && candidate.status !== 'failed') ||
    typeof candidate.completedAt !== 'string' ||
    !Array.isArray(candidate.objectIds) ||
    candidate.objectIds.some((id) => typeof id !== 'string' || !id) ||
    typeof candidate.requestId !== 'string'
  ) {
    return false
  }
  if (candidate.status === 'failed') return typeof candidate.error === 'string'
  return Boolean(
    typeof candidate.base64 === 'string' &&
    candidate.mimeType === 'image/png' &&
    typeof candidate.byteLength === 'number' &&
    typeof candidate.pixelHeight === 'number' &&
    typeof candidate.pixelWidth === 'number' &&
    candidate.source === 'live_board' &&
    candidate.bounds &&
    isNavigationRegion(candidate.bounds)
  )
}

function completedScreenshotResult(
  request: CompleteLocalWorkspaceScreenshotRequest,
  intent: LocalWorkspaceScreenshotIntent
): LocalWorkspaceScreenshotResult {
  if (
    request.mimeType !== 'image/png' ||
    typeof request.base64 !== 'string' ||
    !request.base64 ||
    !request.bounds ||
    !isNavigationRegion(request.bounds) ||
    typeof request.pixelHeight !== 'number' ||
    !Number.isInteger(request.pixelHeight) ||
    request.pixelHeight < 1 ||
    typeof request.pixelWidth !== 'number' ||
    !Number.isInteger(request.pixelWidth) ||
    request.pixelWidth < 1 ||
    request.source !== 'live_board'
  ) {
    throw new TypeError('Completed screenshot payload is invalid.')
  }
  const byteLength = Buffer.byteLength(request.base64, 'base64')
  if (byteLength === 0 || byteLength > MAX_SCREENSHOT_BYTES) {
    throw new TypeError('Completed screenshot must contain at most 2 MiB of PNG data.')
  }
  return {
    base64: request.base64,
    bounds: { ...request.bounds },
    byteLength,
    completedAt: new Date().toISOString(),
    mimeType: 'image/png',
    objectIds: [...intent.objectIds],
    pixelHeight: request.pixelHeight,
    pixelWidth: request.pixelWidth,
    requestId: intent.requestId,
    source: 'live_board',
    status: 'completed'
  }
}

function screenshotResult(
  request: CompleteLocalWorkspaceScreenshotRequest,
  intent: LocalWorkspaceScreenshotIntent
): LocalWorkspaceScreenshotResult {
  const status = request.status ?? (request.error ? 'failed' : 'completed')
  if (status === 'completed') return completedScreenshotResult(request, intent)
  const error = request.error?.trim()
  if (!error) throw new TypeError('Failed screenshot completion requires an error.')
  return {
    completedAt: new Date().toISOString(),
    error: error.slice(0, 1_000),
    objectIds: [...intent.objectIds],
    requestId: intent.requestId,
    status: 'failed'
  }
}

function hashSerializedDocument(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex')
}

function serializeDocument(document: unknown): { hash: string; serialized: string } {
  const serialized = JSON.stringify(document)
  if (typeof serialized !== 'string') {
    throw new LocalWorkspaceAuthorityStoreError(
      'invalid_document',
      'Workspace document must be JSON-serializable'
    )
  }
  return {
    hash: hashSerializedDocument(serialized),
    serialized
  }
}

function cloneIdentity(identity: LocalWorkspaceIdentity): LocalWorkspaceIdentity {
  return { ...identity }
}

function historyDocument(value: unknown): unknown {
  if (isState(value)) return value.document
  if (value && typeof value === 'object') return value
  return null
}

function serializeAuthorityState(
  state: PersistedLocalWorkspaceAuthorityState,
  serializedDocument: string
): string {
  const { document: _document, ...rest } = state
  const envelope = JSON.stringify(rest)
  return `${envelope.slice(0, -1)},"document":${serializedDocument}}`
}

function boundedReceipts(
  receipts: Partial<Record<string, LocalWorkspaceCommitReceipt>>,
  receipt: LocalWorkspaceCommitReceipt
): Record<string, LocalWorkspaceCommitReceipt> {
  const existing = Object.entries(receipts).filter(
    (entry): entry is [string, LocalWorkspaceCommitReceipt] => entry[1] !== undefined
  )
  const entries = [...existing, [receipt.requestId, receipt] as const]
  return Object.fromEntries(entries.slice(-MAX_RECEIPTS))
}

export class LocalWorkspaceAuthorityStore {
  private readonly headListeners = new Set<LocalWorkspaceAuthorityHeadListener>()
  private readonly navigationListeners = new Set<LocalWorkspaceAuthorityNavigationListener>()
  private readonly screenshotListeners = new Set<LocalWorkspaceAuthorityScreenshotListener>()
  private readonly themeListeners = new Set<LocalWorkspaceAuthorityThemeListener>()
  private readonly rootPath: string
  private readonly metadataPath: string
  private readonly documentPath: string
  private readonly ledgerPath: string
  private readonly historyPath: string
  private readonly navigationPath: string
  private readonly presencePath: string
  private readonly screenshotIntentPath: string
  private readonly screenshotResultPath: string
  private readonly themePath: string
  private readonly traceFiles: LocalWorkspaceTraceFileStore
  private readonly preferredWorkspaceId: string | null
  private readonly semanticServices: boolean
  private stateCache: LocalWorkspaceAuthorityStateCache | null = null
  private workspaceIndexVerifiedKey: string | null = null
  private workspaceIndexCache: WorkspaceJsonlIndexPrevious | null = null
  private historyWriteTail: Promise<void> = Promise.resolve()
  private activeWriteLockKey: string | null = null

  constructor(options: LocalWorkspaceAuthorityStoreOptions) {
    this.rootPath = path.resolve(options.root)
    this.traceFiles = new LocalWorkspaceTraceFileStore({ root: this.rootPath })
    this.metadataPath = path.join(this.rootPath, AUTHORITY_METADATA_FILE)
    this.documentPath = path.join(this.rootPath, AUTHORITY_DOCUMENT_FILE)
    this.ledgerPath = path.join(this.rootPath, AUTHORITY_LEDGER_FILE)
    this.historyPath = path.join(this.rootPath, AUTHORITY_HISTORY_DIRECTORY)
    this.navigationPath = path.join(this.rootPath, AUTHORITY_NAVIGATION_FILE)
    this.presencePath = path.join(this.rootPath, AUTHORITY_PRESENCE_FILE)
    this.screenshotIntentPath = path.join(this.rootPath, AUTHORITY_SCREENSHOT_INTENT_FILE)
    this.screenshotResultPath = path.join(this.rootPath, AUTHORITY_SCREENSHOT_RESULT_FILE)
    this.themePath = path.join(this.rootPath, AUTHORITY_THEME_FILE)
    this.preferredWorkspaceId = normalizedId(options.preferredWorkspaceId)
    this.semanticServices = options.semanticServices ?? true
  }

  subscribeHeadCommitted(listener: LocalWorkspaceAuthorityHeadListener): () => void {
    this.headListeners.add(listener)
    return () => this.headListeners.delete(listener)
  }

  subscribeNavigationQueued(listener: LocalWorkspaceAuthorityNavigationListener): () => void {
    this.navigationListeners.add(listener)
    return () => this.navigationListeners.delete(listener)
  }

  subscribeScreenshotQueued(listener: LocalWorkspaceAuthorityScreenshotListener): () => void {
    this.screenshotListeners.add(listener)
    return () => this.screenshotListeners.delete(listener)
  }

  subscribeThemeQueued(listener: LocalWorkspaceAuthorityThemeListener): () => void {
    this.themeListeners.add(listener)
    return () => this.themeListeners.delete(listener)
  }

  hasSavedHead(): boolean {
    return existsSync(this.documentPath)
  }

  externalStateMarker(): Promise<string> {
    return jsonFileMarker(this.documentPath)
  }

  async assertBoardSpaceParent(input: {
    frameId: string
    pageId: string
    parentFrameId: string | null
  }): Promise<void> {
    const metadata = await this.ensureMetadata()
    const state = await this.readState(metadata)
    if (!state) {
      throw new LocalWorkspaceAuthorityStoreError(
        'invalid_document',
        'Local workspace authority has no saved Board document'
      )
    }
    const document = readAuthorityBoardDocument(state.document)
    const page = document.graph.getNode(input.pageId)
    if (!page) throw new TypeError(`Board page "${input.pageId}" does not exist.`)
    const frame = document.graph.getNode(input.frameId)
    if (!frame || frame.type !== 'FRAME') {
      throw new TypeError(`Board space frame "${input.frameId}" does not exist.`)
    }
    const expectedParentId = input.parentFrameId ?? input.pageId
    if (input.parentFrameId) {
      const parent = document.graph.getNode(input.parentFrameId)
      if (!parent || parent.type !== 'FRAME') {
        throw new TypeError(`Parent Bot frame "${input.parentFrameId}" does not exist.`)
      }
    }
    if (frame.parentId !== expectedParentId) {
      const expected = input.parentFrameId
        ? `parent Bot frame "${input.parentFrameId}"`
        : `Board page "${input.pageId}"`
      throw new TypeError(
        `Board space frame "${input.frameId}" must be a direct child of ${expected}.`
      )
    }
  }

  queueNavigationIntent(
    request: QueueLocalWorkspaceNavigationRequest
  ): Promise<LocalWorkspaceNavigationIntent> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (!state) {
        throw new LocalWorkspaceAuthorityStoreError(
          'invalid_document',
          'Local workspace authority has no saved Board document'
        )
      }
      this.assertStateMatchesMetadata(state, metadata)
      if (request.workspaceId !== metadata.identity.workspaceId) {
        throw new LocalWorkspaceAuthorityStoreError(
          'workspace_mismatch',
          `Authority owns workspace "${metadata.identity.workspaceId}", received "${request.workspaceId}"`,
          state.revision
        )
      }
      if (request.contentDocumentId !== metadata.identity.documentId) {
        throw new LocalWorkspaceAuthorityStoreError(
          'invalid_document',
          `Authority owns content document "${metadata.identity.documentId}", received "${request.contentDocumentId}"`,
          state.revision
        )
      }
      const existing = await this.readNavigationIntent()
      const ttlMs = request.ttlMs ?? DEFAULT_NAVIGATION_INTENT_TTL_MS
      if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > DEFAULT_NAVIGATION_INTENT_TTL_MS) {
        throw new TypeError(
          `Navigation intent ttlMs must be between 1 and ${DEFAULT_NAVIGATION_INTENT_TTL_MS}.`
        )
      }
      if (request.objectIds && request.objectIds.length > 24) {
        throw new TypeError('Navigation intents reveal at most 24 objects.')
      }
      const createdAt = new Date()
      const intent: LocalWorkspaceNavigationIntent = {
        authorityId: metadata.authorityId,
        contentDocumentId: metadata.identity.documentId,
        consumedAt: null,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
        intentId: `board-open-${randomUUID()}`,
        ...(request.objectIds && request.objectIds.length > 0
          ? { objectIds: [...request.objectIds] }
          : {}),
        pageId: request.pageId,
        ...(request.region ? { region: { ...request.region } } : {}),
        ...(request.runtimeInstanceId ? { runtimeInstanceId: request.runtimeInstanceId } : {}),
        sequence: (existing?.sequence ?? 0) + 1,
        version: LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION,
        workspaceId: metadata.identity.workspaceId
      }
      await this.atomicWrite(this.navigationPath, intent)
      this.notifyNavigationQueued(intent)
      return intent
    })
  }

  async queueResolvedNavigationIntent(
    request: QueueResolvedLocalWorkspaceNavigationRequest
  ): Promise<LocalWorkspaceNavigationIntent> {
    const status = await this.status()
    const resolved = await this.resolveNavigationPage(request)
    const objectIds =
      request.objectIds && request.objectIds.length > 0 ? request.objectIds : resolved.objectIds
    return this.queueNavigationIntent({
      contentDocumentId: status.identity.documentId,
      ...(objectIds ? { objectIds } : {}),
      pageId: resolved.pageId,
      ...(request.region ? { region: request.region } : {}),
      ...(request.runtimeInstanceId ? { runtimeInstanceId: request.runtimeInstanceId } : {}),
      ...(request.ttlMs ? { ttlMs: request.ttlMs } : {}),
      workspaceId: status.identity.workspaceId
    })
  }

  pendingNavigationIntent(): Promise<LocalWorkspaceNavigationIntent | null> {
    return this.withReadLock(async () => {
      const intent = await this.readNavigationIntent()
      if (intent?.consumedAt !== null) return null
      if (Date.parse(intent.expiresAt) > Date.now()) return structuredClone(intent)
      return null
    })
  }

  consumeNavigationIntent(intentId: string): Promise<boolean> {
    return this.withWriteLock(async () => {
      const intent = await this.readNavigationIntent()
      if (!intent || intent.intentId !== intentId || intent.consumedAt !== null) return false
      await this.atomicWrite(this.navigationPath, {
        ...intent,
        consumedAt: new Date().toISOString()
      })
      return true
    })
  }

  queueScreenshotIntent(
    request: QueueLocalWorkspaceScreenshotRequest
  ): Promise<LocalWorkspaceScreenshotIntent> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (!state) {
        throw new LocalWorkspaceAuthorityStoreError(
          'invalid_document',
          'Local workspace authority has no saved Board document'
        )
      }
      this.assertStateMatchesMetadata(state, metadata)
      if (request.workspaceId !== metadata.identity.workspaceId) {
        throw new LocalWorkspaceAuthorityStoreError(
          'workspace_mismatch',
          `Authority owns workspace "${metadata.identity.workspaceId}", received "${request.workspaceId}"`,
          state.revision
        )
      }
      if (request.contentDocumentId !== metadata.identity.documentId) {
        throw new LocalWorkspaceAuthorityStoreError(
          'invalid_document',
          `Authority owns content document "${metadata.identity.documentId}", received "${request.contentDocumentId}"`,
          state.revision
        )
      }
      const objectIds = [...new Set(request.objectIds.map((id) => id.trim()))]
      if (objectIds.length === 0 || objectIds.length > 8 || objectIds.some((id) => !id)) {
        throw new TypeError('Screenshot intents require from 1 to 8 unique object IDs.')
      }
      const ttlMs = request.ttlMs ?? DEFAULT_SCREENSHOT_INTENT_TTL_MS
      if (!Number.isInteger(ttlMs) || ttlMs < 1 || ttlMs > DEFAULT_SCREENSHOT_INTENT_TTL_MS) {
        throw new TypeError(
          `Screenshot intent ttlMs must be between 1 and ${String(DEFAULT_SCREENSHOT_INTENT_TTL_MS)}.`
        )
      }
      const existing = await this.readScreenshotIntent()
      const createdAt = new Date()
      const intent: LocalWorkspaceScreenshotIntent = {
        authorityId: metadata.authorityId,
        contentDocumentId: metadata.identity.documentId,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
        objectIds,
        pageId: request.pageId,
        requestId: `board-screenshot-${randomUUID()}`,
        sequence: (existing?.sequence ?? 0) + 1,
        version: LOCAL_WORKSPACE_SCREENSHOT_INTENT_VERSION,
        workspaceId: metadata.identity.workspaceId
      }
      await this.atomicWrite(this.screenshotIntentPath, intent)
      await unlink(this.screenshotResultPath).catch((error: unknown) => {
        if (errorCode(error) !== 'ENOENT') throw error
      })
      this.notifyScreenshotQueued(intent)
      return intent
    })
  }

  pendingScreenshotIntent(): Promise<LocalWorkspaceScreenshotIntent | null> {
    return this.withReadLock(async () => {
      const intent = await this.readScreenshotIntent()
      if (!intent || Date.parse(intent.expiresAt) <= Date.now()) return null
      const result = await this.readScreenshotResult()
      return result?.requestId === intent.requestId ? null : structuredClone(intent)
    })
  }

  completeScreenshot(
    request: CompleteLocalWorkspaceScreenshotRequest
  ): Promise<LocalWorkspaceScreenshotResult> {
    return this.withWriteLock(async () => {
      const intent = await this.readScreenshotIntent()
      if (!intent || intent.requestId !== request.requestId) {
        throw new TypeError('Screenshot completion does not match the pending request.')
      }
      if (
        request.objectIds.length !== intent.objectIds.length ||
        request.objectIds.some((id, index) => id !== intent.objectIds[index])
      ) {
        throw new TypeError('Screenshot completion object IDs do not match the pending request.')
      }
      const result = screenshotResult(request, intent)
      await this.atomicWrite(this.screenshotResultPath, result)
      return structuredClone(result)
    })
  }

  async waitForScreenshotResult(
    requestId: string,
    timeoutMs = DEFAULT_SCREENSHOT_INTENT_TTL_MS
  ): Promise<LocalWorkspaceScreenshotResult | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const result = await this.withReadLock(() => this.readScreenshotResult())
      if (result?.requestId === requestId) return structuredClone(result)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 50)
      })
    }
    return null
  }

  recordPresence(request: RecordLocalWorkspacePresenceRequest): Promise<LocalWorkspacePresence> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      if (request.workspaceId !== metadata.identity.workspaceId) {
        throw new LocalWorkspaceAuthorityStoreError(
          'workspace_mismatch',
          `Authority owns workspace "${metadata.identity.workspaceId}", received "${request.workspaceId}"`
        )
      }
      if (request.contentDocumentId !== metadata.identity.documentId) {
        throw new LocalWorkspaceAuthorityStoreError(
          'invalid_document',
          `Authority owns content document "${metadata.identity.documentId}", received "${request.contentDocumentId}"`
        )
      }
      if (!request.pageId.trim() || !request.pageName.trim()) {
        throw new TypeError('Presence requires a pageId and pageName.')
      }
      const selectedIds = [...new Set((request.selectedIds ?? []).map((id) => id.trim()))]
      if (
        selectedIds.length > LOCAL_WORKSPACE_PRESENCE_SELECTION_LIMIT ||
        selectedIds.some((id) => !id)
      ) {
        throw new TypeError(
          `Presence selectedIds must contain at most ${String(LOCAL_WORKSPACE_PRESENCE_SELECTION_LIMIT)} non-empty IDs.`
        )
      }
      const presence: LocalWorkspacePresence = {
        authorityId: metadata.authorityId,
        contentDocumentId: metadata.identity.documentId,
        pageId: request.pageId,
        pageName: request.pageName,
        ...(request.runtimeInstanceId ? { runtimeInstanceId: request.runtimeInstanceId } : {}),
        selectedIds,
        selectionTruncated: request.selectionTruncated ?? false,
        updatedAt: new Date().toISOString(),
        version: 1,
        ...(request.viewport ? { viewport: { ...request.viewport } } : {}),
        workspaceId: metadata.identity.workspaceId
      }
      await this.atomicWrite(this.presencePath, presence)
      return presence
    })
  }

  readPresence(): Promise<LocalWorkspacePresence | null> {
    return this.withReadLock(async () => {
      const value = await this.readJson(this.presencePath)
      if (value === null) return null
      if (!isPresence(value)) {
        throw new TypeError('Local workspace authority presence is invalid')
      }
      return structuredClone(value)
    })
  }

  recordTheme(request: RecordLocalWorkspaceThemeRequest): Promise<LocalWorkspaceThemeIntent> {
    if (!isThemeSetting(request.theme)) {
      throw new TypeError('Theme must be light, dark, or auto.')
    }
    return this.withWriteLock(async () => {
      await this.ensureMetadata()
      const existing = await this.readThemeIntent()
      const createdAt = new Date()
      const intent: LocalWorkspaceThemeIntent = {
        consumedAt: null,
        createdAt: createdAt.toISOString(),
        sequence: (existing?.sequence ?? 0) + 1,
        theme: request.theme,
        updatedAt: createdAt.toISOString(),
        version: LOCAL_WORKSPACE_THEME_INTENT_VERSION
      }
      await this.atomicWrite(this.themePath, intent)
      this.notifyThemeQueued(intent)
      return intent
    })
  }

  readTheme(): Promise<LocalWorkspaceThemeIntent | null> {
    return this.withReadLock(async () => {
      const intent = await this.readThemeIntent()
      return intent ? structuredClone(intent) : null
    })
  }

  pendingThemeIntent(): Promise<LocalWorkspaceThemeIntent | null> {
    return this.withReadLock(async () => {
      const intent = await this.readThemeIntent()
      if (intent?.consumedAt !== null) return null
      return structuredClone(intent)
    })
  }

  consumeThemeIntent(sequence: number): Promise<boolean> {
    if (!Number.isInteger(sequence) || sequence < 1) {
      throw new TypeError('Theme consumption requires a positive sequence.')
    }
    return this.withWriteLock(async () => {
      const intent = await this.readThemeIntent()
      if (!intent || intent.sequence !== sequence || intent.consumedAt !== null) return false
      await this.atomicWrite(this.themePath, {
        ...intent,
        consumedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      return true
    })
  }

  recordTraceSession(input: {
    gestures: unknown
    session: unknown
    spokenTurns?: unknown
    summary: unknown
  }): Promise<{
    gestureCount: number
    spokenTurnCount: number
    summary: unknown
  }> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (!state) {
        throw new LocalWorkspaceAuthorityStoreError(
          'invalid_document',
          'Local workspace authority has no saved Board document'
        )
      }
      this.assertStateMatchesMetadata(state, metadata)
      const session = traceSession(input.session)
      const summary = traceSummary(input.summary, session.id)
      if (!sameTraceSessionReferences(session, summary)) {
        throw new TypeError('Trace session and summary tags must match.')
      }
      if (summary.tag) {
        const existing = await this.readTraceSnapshot(false)
        const collision = [...existing.summaries.values()].some((candidate) => {
          if (candidate.id === session.id) return false
          const tags = [candidate.tag, ...(candidate.aliases ?? [])].filter(
            (tag): tag is string => typeof tag === 'string'
          )
          return tags.some((tag) => normalizeTraceSessionTag(tag) === summary.tag)
        })
        if (collision) throw new TypeError(`Trace session tag #${summary.tag} is already in use.`)
      }
      if (!Array.isArray(input.gestures)) {
        throw new TypeError('Trace session gestures must be an array.')
      }
      const evidenceReferences = traceEvidenceReferences(input.session)
      const gestures = input.gestures.map((gesture) =>
        normalizeLocalWorkspaceTraceGesture(
          gestureWithEvidenceReference(gesture, evidenceReferences),
          metadata
        )
      )
      if (gestures.some((gesture) => gesture.sessionId !== session.id)) {
        throw new TypeError('Trace gestures must belong to the persisted Trace session.')
      }
      if (input.spokenTurns !== undefined && !Array.isArray(input.spokenTurns)) {
        throw new TypeError('Trace session spoken turns must be an array.')
      }
      const spokenTurns = Array.isArray(input.spokenTurns)
        ? input.spokenTurns.map((turn) => traceSpokenTurn(turn, metadata))
        : undefined
      await this.traceFiles.appendSession({
        gestures,
        session,
        spokenTurns: spokenTurns?.map(({ value }) => value),
        summary
      })
      await this.refreshDirectTraceContext(state)
      return {
        gestureCount: gestures.length,
        spokenTurnCount: spokenTurns?.length ?? 0,
        summary: structuredClone(input.summary)
      }
    })
  }

  /**
   * Persists finished spoken turns on their own, so a turn survives even when no Trace session is
   * active or the app disconnects before the session is saved.
   */
  recordTraceSpokenTurns(input: { spokenTurns: unknown }): Promise<{ spokenTurnCount: number }> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      if (!Array.isArray(input.spokenTurns) || input.spokenTurns.length === 0) {
        throw new TypeError('Trace spoken turns must be a non-empty array.')
      }
      const spokenTurns = input.spokenTurns.map((turn) => traceSpokenTurn(turn, metadata))
      await this.traceFiles.appendSpokenTurns(spokenTurns.map(({ value }) => value))
      const state = await this.readState(metadata)
      if (state) await this.refreshDirectTraceContext(state)
      return { spokenTurnCount: spokenTurns.length }
    })
  }

  traceSessionSummaries(): Promise<unknown[]> {
    return this.withReadLock(async () => {
      const snapshot = await this.readTraceSnapshot(false)
      return [...snapshot.summaries.values()]
        .sort((first, second) => {
          const firstUpdated = first.updatedAt
          const secondUpdated = second.updatedAt
          const firstTime = Date.parse(
            typeof firstUpdated === 'string' ? firstUpdated : first.startedAt
          )
          const secondTime = Date.parse(
            typeof secondUpdated === 'string' ? secondUpdated : second.startedAt
          )
          return secondTime - firstTime || second.id.localeCompare(first.id)
        })
        .map((summary) => structuredClone(summary))
    })
  }

  traceActivityPage(input: {
    before?: string
    limit?: number
  }): Promise<LocalWorkspaceTraceActivityPage> {
    return this.withReadLock(async () => {
      const snapshot = await this.readTraceSnapshot(false)
      const page = traceActivityPage(snapshot, input)
      const evidenceIds = [
        ...new Set(
          page.items.flatMap((item) =>
            item.event.evidence?.evidenceId ? [item.event.evidence.evidenceId] : []
          )
        )
      ]
      if (evidenceIds.length === 0) return page
      const statuses = await this.traceFiles.evidenceStatuses(evidenceIds)
      return {
        ...page,
        items: page.items.map((item) => {
          const evidenceId = item.event.evidence?.evidenceId
          const evidenceStatus = evidenceId ? statuses.get(evidenceId) : undefined
          if (evidenceStatus !== 'evicted' && evidenceStatus !== 'ready') return item
          return { ...item, event: { ...item.event, evidenceStatus } }
        })
      }
    })
  }

  traceHistorySnapshot(): Promise<LocalWorkspaceTraceHistorySnapshot> {
    return this.withReadLock(async () => {
      const snapshot = await this.readTraceSnapshot()
      return {
        sessions: [...snapshot.sessions.values()].map((session) => structuredClone(session)),
        spokenTurns: [...snapshot.spokenTurns.values()].map((turn) => structuredClone(turn)),
        summaries: [...snapshot.summaries.values()].map((summary) => structuredClone(summary))
      }
    })
  }

  traceSession(sessionId: string): Promise<unknown> {
    const normalizedSessionId = normalizedId(sessionId)
    if (!normalizedSessionId) throw new TypeError('Trace session ID is required.')
    return this.withReadLock(async () => {
      const session = (await this.readTraceSnapshot()).sessions.get(normalizedSessionId)
      return session === undefined ? null : structuredClone(session)
    })
  }

  traceSpokenTurns(): Promise<unknown[]> {
    return this.withReadLock(async () => {
      const snapshot = await this.readTraceSnapshot()
      return [...snapshot.spokenTurns.values()]
        .sort(
          (first, second) =>
            Date.parse(second.endedAt) - Date.parse(first.endedAt) ||
            second.sequence - first.sequence ||
            second.id.localeCompare(first.id)
        )
        .map((turn) => structuredClone(turn))
    })
  }

  deleteTraceSession(sessionId: string): Promise<boolean> {
    const normalizedSessionId = normalizedId(sessionId)
    if (!normalizedSessionId) throw new TypeError('Trace session ID is required.')
    return this.withWriteLock(async () => {
      const snapshot = await this.readTraceSnapshot(false)
      if (!snapshot.sessions.has(normalizedSessionId)) return false
      await this.traceFiles.appendSessionDeleted(normalizedSessionId)
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (state) await this.refreshDirectTraceContext(state)
      return true
    })
  }

  recordTraceEvidence(input: {
    bytes: Uint8Array
    evidenceId: string
    mimeType: string
    sessionId: string
  }): Promise<void> {
    const evidenceId = normalizedId(input.evidenceId)
    const sessionId = normalizedId(input.sessionId)
    if (!evidenceId || !sessionId) {
      throw new TypeError('Trace evidence requires evidenceId and sessionId.')
    }
    if (input.mimeType !== 'image/png') {
      throw new TypeError('Trace evidence must be an image/png payload.')
    }
    if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
      throw new TypeError('Trace evidence bytes are required.')
    }
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (!state) {
        throw new LocalWorkspaceAuthorityStoreError(
          'invalid_document',
          'Local workspace authority has no saved Board document'
        )
      }
      this.assertStateMatchesMetadata(state, metadata)
      await this.traceFiles.writeEvidence({
        bytes: input.bytes,
        evidenceId,
        mimeType: input.mimeType
      })
      await this.refreshDirectTraceContext(state)
    })
  }

  traceEvidence(evidenceId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    const normalizedEvidenceId = normalizedId(evidenceId)
    if (!normalizedEvidenceId) throw new TypeError('Trace evidence ID is required.')
    return this.withReadLock(async () => {
      const evidence = await this.traceFiles.readEvidence(normalizedEvidenceId)
      return evidence ? { bytes: evidence.bytes, mimeType: evidence.mimeType } : null
    })
  }

  pinTraceEvidence(
    evidenceId: string,
    pinId: string
  ): Promise<LocalWorkspaceTraceEvidencePinResult> {
    return this.withWriteLock(() => this.traceFiles.pinEvidence(evidenceId, pinId))
  }

  unpinTraceEvidence(evidenceId: string, pinId: string): Promise<boolean> {
    return this.withWriteLock(() => this.traceFiles.unpinEvidence(evidenceId, pinId))
  }

  releaseTraceEvidencePins(pinId: string): Promise<number> {
    return this.withWriteLock(() => this.traceFiles.releaseEvidencePins(pinId))
  }

  traceEvidenceOverview(
    evidenceIds: readonly string[]
  ): Promise<LocalWorkspaceTraceEvidenceOverview> {
    return this.withWriteLock(() => this.traceFiles.evidenceOverview(evidenceIds))
  }

  async traceGesture(selector: {
    gestureId?: string
    includeImage?: boolean
    latest?: boolean
  }): Promise<
    | {
        gesture: LocalWorkspaceTraceGestureRead
        scanned: { sessions: number }
        status: 'matched'
      }
    | {
        reason: 'gesture_not_found'
        scanned: { sessions: number }
        status: 'empty'
      }
  > {
    const gestureId = normalizedId(selector.gestureId)
    if (Boolean(gestureId) === (selector.latest === true)) {
      throw new TypeError('Trace gesture retrieval requires exactly one selector.')
    }
    return this.withReadLock(async () => {
      const snapshot = await this.readTraceSnapshot()
      const scanned = { sessions: snapshot.sessions.size }
      const gesture = gestureId
        ? snapshot.gestures.get(gestureId)
        : [...snapshot.gestures.values()].sort(
            (first, second) =>
              Date.parse(second.capturedAt) - Date.parse(first.capturedAt) ||
              second.gestureId.localeCompare(first.gestureId)
          )[0]
      if (!gesture) {
        return {
          reason: 'gesture_not_found' as const,
          scanned,
          status: 'empty' as const
        }
      }
      const persisted = structuredClone(gesture)
      if (!persisted.evidence) {
        return {
          gesture: { ...persisted, imageStatus: 'unavailable' as const },
          scanned,
          status: 'matched' as const
        }
      }
      if (selector.includeImage !== true) {
        return {
          gesture: { ...persisted, imageStatus: 'not_requested' as const },
          scanned,
          status: 'matched' as const
        }
      }
      const image = await this.traceFiles.readEvidence(persisted.evidence.evidenceId)
      if (!image) {
        const imageStatus = await this.traceFiles.evidenceStatus(persisted.evidence.evidenceId)
        return {
          gesture: {
            ...persisted,
            imageStatus: imageStatus === 'evicted' ? ('evicted' as const) : ('missing' as const)
          },
          scanned,
          status: 'matched' as const
        }
      }
      return {
        gesture: {
          ...persisted,
          evidence: {
            ...persisted.evidence,
            image: {
              base64: Buffer.from(image.bytes).toString('base64'),
              mimeType: 'image/png'
            },
            mimeType: 'image/png'
          },
          imageStatus: 'included' as const
        },
        scanned,
        status: 'matched' as const
      }
    })
  }

  status(): Promise<LocalWorkspaceAuthorityStatus> {
    return this.withWriteLock(async () => {
      if (this.stateCache?.pendingDocumentWrite && this.stateCache.state) {
        await this.bestEffortEnsureWorkspaceIndex(this.stateCache.state)
        return structuredClone(this.stateCache.status)
      }
      const metadata = await this.ensureMetadata()
      const [documentMarker, ledgerMarker] = await Promise.all([
        jsonFileMarker(this.documentPath),
        jsonFileMarker(this.ledgerPath)
      ])
      if (
        this.stateCache?.documentMarker === documentMarker &&
        this.stateCache.ledgerMarker === ledgerMarker
      ) {
        if (this.stateCache.state) {
          await this.bestEffortEnsureWorkspaceIndex(this.stateCache.state)
        }
        return structuredClone(this.stateCache.status)
      }
      const state = await this.readState(metadata)
      if (state) {
        await this.bestEffortEnsureWorkspaceIndex(state)
        await this.ensureDirectTraceContext(state)
      }
      return structuredClone(this.stateCache?.status ?? this.statusFromState(metadata, state))
    })
  }

  head(): Promise<LocalWorkspaceAuthorityHead | null> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (!state) return null
      this.assertStateMatchesMetadata(state, metadata)
      await this.bestEffortEnsureWorkspaceIndex(state)
      await this.ensureDirectTraceContext(state)
      return this.headFromState(state)
    })
  }

  searchWorkspace(query: string, limit = 20): Promise<WorkspaceSearchResult> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (!state) {
        throw new LocalWorkspaceAuthorityStoreError(
          'invalid_document',
          'Local workspace authority has no saved Board document'
        )
      }
      this.assertStateMatchesMetadata(state, metadata)
      const { searchWorkspaceIndex } = await import('./workspace-search')
      return searchWorkspaceIndex(this.rootPath, this.headFromState(state), query, limit)
    })
  }

  headAtRevision(revision: number): Promise<LocalWorkspaceAuthorityHead | null> {
    if (!Number.isInteger(revision) || revision < 0) {
      throw new TypeError('Local workspace authority revision must be a non-negative integer')
    }
    return this.withWriteLock(async () => {
      await this.historyWriteTail
      const metadata = await this.ensureMetadata()
      const current = await this.readState(metadata)
      if (!current || revision > current.revision) return null
      this.assertStateMatchesMetadata(current, metadata)
      if (revision === current.revision) return this.headFromState(current)
      const value = await readJsonHistory(this.historyPath, revision)
      if (value === null) return null
      if (!isState(value) || value.revision !== revision) {
        throw new TypeError(`Local workspace authority history revision ${revision} is invalid`)
      }
      this.assertStateMatchesMetadata(value, metadata)
      return this.headFromState(value)
    })
  }

  initialize(request: InitializeLocalWorkspaceRequest): Promise<LocalWorkspaceCommitReceipt> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      if (metadata.seedWorkspaceId && request.sourceWorkspaceId !== metadata.seedWorkspaceId) {
        throw new LocalWorkspaceAuthorityStoreError(
          'seed_workspace_mismatch',
          `Authority requires seed workspace "${metadata.seedWorkspaceId}", received "${request.sourceWorkspaceId}"`
        )
      }
      const materialized = await this.materializeDocument(request.document)
      const { hash: contentHash, serialized } = serializeDocument(materialized.document)
      const current = await this.readState(metadata)
      if (current) {
        this.assertStateMatchesMetadata(current, metadata)
        const replay = current.receipts[request.requestId]
        if (replay) {
          if (replay.contentHash === contentHash) return replay
          throw new LocalWorkspaceAuthorityStoreError(
            'idempotency_conflict',
            `Request "${request.requestId}" was already used for different content`
          )
        }
        if (current.contentHash === contentHash) {
          const receipt = this.createReceipt({
            contentHash,
            metadata,
            requestId: request.requestId,
            status: 'unchanged',
            baseRevision: current.revision,
            appliedRevision: current.revision
          })
          await this.writeState(
            metadata,
            {
              ...current,
              receipts: boundedReceipts(current.receipts, receipt)
            },
            false
          )
          return receipt
        }
        throw new LocalWorkspaceAuthorityStoreError(
          'already_initialized',
          'Local workspace authority already owns a different saved head',
          current.revision
        )
      }

      const receipt = this.createReceipt({
        contentHash,
        metadata,
        requestId: request.requestId,
        status: 'initialized',
        baseRevision: 0,
        appliedRevision: 1
      })
      const state: PersistedLocalWorkspaceAuthorityState = {
        authorityId: metadata.authorityId,
        contentHash,
        document: materialized.document,
        identity: cloneIdentity(metadata.identity),
        receipts: { [request.requestId]: receipt },
        revision: 1,
        updatedAt: receipt.committedAt,
        version: LOCAL_WORKSPACE_AUTHORITY_VERSION
      }
      await this.writeState(metadata, state, true, serialized)
      this.notifyHeadCommitted(receipt)
      return receipt
    })
  }

  commit(request: CommitLocalWorkspaceRequest): Promise<LocalWorkspaceCommitReceipt> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      if (request.workspaceId !== metadata.identity.workspaceId) {
        throw new LocalWorkspaceAuthorityStoreError(
          'workspace_mismatch',
          `Authority owns workspace "${metadata.identity.workspaceId}", received "${request.workspaceId}"`
        )
      }
      const current = await this.readState(metadata)
      if (!current) {
        throw new LocalWorkspaceAuthorityStoreError(
          'already_initialized',
          'Local workspace authority has not been initialized'
        )
      }
      this.assertStateMatchesMetadata(current, metadata)
      const incoming = restoreUnchangedAuthorityImages(
        restoreUnchangedAuthorityPages(request.document, current.document),
        current.document
      )
      const materialized = await this.materializeDocument(incoming, current.document)
      const { hash: contentHash, serialized } = serializeDocument(materialized.document)
      const replay = current.receipts[request.requestId]
      if (replay) {
        if (replay.contentHash === contentHash) return replay
        throw new LocalWorkspaceAuthorityStoreError(
          'idempotency_conflict',
          `Request "${request.requestId}" was already used for different content`
        )
      }

      if (request.expectedRevision !== current.revision) {
        throw new LocalWorkspaceAuthorityStoreError(
          'stale_revision',
          `Expected revision ${request.expectedRevision}, current revision is ${current.revision}`,
          current.revision
        )
      }

      if (request.expectedContentHash !== current.contentHash) {
        throw new LocalWorkspaceAuthorityStoreError(
          'stale_content_hash',
          `Expected content hash ${request.expectedContentHash}, current content hash is ${current.contentHash}`,
          current.revision
        )
      }

      if (current.contentHash === contentHash) {
        const receipt = this.createReceipt({
          contentHash,
          metadata,
          requestId: request.requestId,
          status: 'unchanged',
          baseRevision: current.revision,
          appliedRevision: current.revision
        })
        return receipt
      }

      const nextRevision = current.revision + 1
      const receipt = this.createReceipt({
        contentHash,
        metadata,
        requestId: request.requestId,
        status: 'committed',
        baseRevision: current.revision,
        appliedRevision: nextRevision
      })
      const nextState: PersistedLocalWorkspaceAuthorityState = {
        ...current,
        contentHash,
        document: materialized.document,
        receipts: boundedReceipts(current.receipts, receipt),
        revision: nextRevision,
        updatedAt: receipt.committedAt
      }
      await this.writeState(metadata, nextState, true, serialized, {
        deferDocument: true,
        deferHistory: true
      })
      this.notifyHeadCommitted(receipt)
      return receipt
    })
  }

  private async ensureMetadata(): Promise<PersistedLocalWorkspaceAuthorityMetadata> {
    const existing = await this.readJson(this.metadataPath)
    if (isMetadata(existing)) return existing
    if (existing !== null) {
      throw new TypeError('Local workspace authority metadata is invalid')
    }
    const metadata: PersistedLocalWorkspaceAuthorityMetadata = {
      authorityId: `local-authority-${randomUUID()}`,
      identity: createIdentity(this.preferredWorkspaceId),
      seedWorkspaceId: this.preferredWorkspaceId,
      version: LOCAL_WORKSPACE_AUTHORITY_VERSION
    }
    await this.atomicWrite(this.metadataPath, metadata)
    return metadata
  }

  private async restoreStaleDocumentRewrite(
    persistedLedger: PersistedLocalWorkspaceAuthorityLedger,
    contentHash: string
  ): Promise<{ document: unknown; serialized: ReturnType<typeof serializeDocument> } | null> {
    await this.historyWriteTail
    const staleRewriteRevision = await findJsonHistoryRevisionByHash(this.historyPath, contentHash)
    if (staleRewriteRevision === null || staleRewriteRevision >= persistedLedger.revision) {
      return null
    }
    const document = historyDocument(
      await readJsonHistory(this.historyPath, persistedLedger.revision)
    )
    if (document === null) return null
    console.warn(
      `[Local workspace authority] workspace.json matched saved revision ${String(staleRewriteRevision)}; keeping revision ${String(persistedLedger.revision)}`
    )
    const serialized = serializeDocument(document)
    await writeSerializedJsonFile(this.documentPath, serialized.serialized)
    return { document, serialized }
  }

  private async readState(
    metadata: PersistedLocalWorkspaceAuthorityMetadata
  ): Promise<PersistedLocalWorkspaceAuthorityState | null> {
    const [documentMarker, ledgerMarker] = await Promise.all([
      jsonFileMarker(this.documentPath),
      jsonFileMarker(this.ledgerPath)
    ])
    if (this.stateCache?.pendingDocumentWrite && this.stateCache.state) {
      return this.stateCache.state
    }
    if (
      this.stateCache?.documentMarker === documentMarker &&
      this.stateCache.ledgerMarker === ledgerMarker
    ) {
      return this.stateCache.state
    }
    const savedDocument = await readSerializedJsonFile(this.documentPath)
    if (savedDocument === null) {
      await this.cacheStatus(metadata, null, documentMarker, ledgerMarker)
      return null
    }
    const materialized = await this.materializeDocument(savedDocument.value)
    let document = materialized.document
    let serialized = materialized.changed
      ? serializeDocument(document)
      : {
          hash: hashSerializedDocument(savedDocument.serialized),
          serialized: savedDocument.serialized
        }
    if (materialized.changed)
      await writeSerializedJsonFile(this.documentPath, serialized.serialized)
    const persistedLedger = await this.readJson(this.ledgerPath)
    if (persistedLedger !== null && !isLedger(persistedLedger)) {
      throw new TypeError('Local workspace authority ledger is invalid')
    }
    let contentHash = serialized.hash
    if (persistedLedger !== null && persistedLedger.contentHash !== contentHash) {
      const restored = await this.restoreStaleDocumentRewrite(persistedLedger, contentHash)
      if (restored) {
        serialized = restored.serialized
        document = restored.document
        contentHash = persistedLedger.contentHash
      }
    }
    const ledger = persistedLedger ?? {
      contentHash,
      receipts: {},
      revision: 1,
      updatedAt: new Date().toISOString(),
      version: LOCAL_WORKSPACE_AUTHORITY_VERSION
    }
    const currentLedger =
      ledger.contentHash === contentHash
        ? ledger
        : {
            ...ledger,
            contentHash,
            revision: ledger.revision + 1,
            updatedAt: new Date().toISOString()
          }
    const state = {
      authorityId: metadata.authorityId,
      document,
      identity: cloneIdentity(metadata.identity),
      ...currentLedger
    }
    if (persistedLedger !== currentLedger) {
      await this.atomicWrite(this.ledgerPath, currentLedger)
      await writeJsonHistory(
        this.historyPath,
        state.revision,
        state.contentHash,
        serializeAuthorityState(state, serialized.serialized)
      )
      await this.pruneHistory()
      await this.bestEffortEnsureWorkspaceIndex(state)
      await this.refreshDirectTraceContext(state)
      this.notifyHeadCommitted(
        this.createReceipt({
          appliedRevision: state.revision,
          baseRevision: persistedLedger?.revision ?? 0,
          contentHash: state.contentHash,
          metadata,
          requestId: `workspace-file-${String(state.revision)}`,
          status: 'committed'
        })
      )
    }
    await this.cacheStatus(metadata, state)
    return state
  }

  private async cacheStatus(
    metadata: PersistedLocalWorkspaceAuthorityMetadata,
    state: PersistedLocalWorkspaceAuthorityState | null,
    knownDocumentMarker?: string,
    knownLedgerMarker?: string,
    options?: { expectedCurrentRevision?: number; pendingDocumentWrite?: boolean }
  ): Promise<void> {
    const [documentMarker, ledgerMarker] =
      knownDocumentMarker !== undefined && knownLedgerMarker !== undefined
        ? [knownDocumentMarker, knownLedgerMarker]
        : await Promise.all([jsonFileMarker(this.documentPath), jsonFileMarker(this.ledgerPath)])
    if (
      options?.expectedCurrentRevision !== undefined &&
      this.stateCache?.state?.revision !== options.expectedCurrentRevision
    ) {
      return
    }
    this.stateCache = {
      documentMarker,
      ledgerMarker,
      pendingDocumentWrite: options?.pendingDocumentWrite === true,
      state,
      status: this.statusFromState(metadata, state)
    }
  }

  private statusFromState(
    metadata: PersistedLocalWorkspaceAuthorityMetadata,
    state: PersistedLocalWorkspaceAuthorityState | null
  ): LocalWorkspaceAuthorityStatus {
    return {
      authorityId: metadata.authorityId,
      contentHash: state?.contentHash ?? null,
      identity: cloneIdentity(metadata.identity),
      revision: state?.revision ?? 0,
      seedWorkspaceId: metadata.seedWorkspaceId,
      state: state ? 'ready' : 'configured',
      updatedAt: state?.updatedAt ?? null,
      version: LOCAL_WORKSPACE_AUTHORITY_VERSION
    }
  }

  private async materializeDocument(
    document: unknown,
    previous?: unknown
  ): Promise<{
    changed: boolean
    document: unknown
  }> {
    if (!this.semanticServices || !documentMayNeedMermaidMaterialization(document, previous)) {
      return { changed: false, document }
    }
    const { materializeAuthorityMermaidDocument } = await import('./mermaid-materialization')
    return materializeAuthorityMermaidDocument(document)
  }

  private bestEffortEnsureWorkspaceIndex(
    state: PersistedLocalWorkspaceAuthorityState,
    force = false
  ): Promise<void> {
    const verificationKey = `${String(state.revision)}:${state.contentHash}`
    if (force) this.workspaceIndexVerifiedKey = null
    return ensureWorkspaceJsonlIndex(
      this.rootPath,
      this.headFromState(state),
      this.workspaceIndexCache
    ).then(
      (result) => {
        this.workspaceIndexVerifiedKey = verificationKey
        if (result.index) {
          this.workspaceIndexCache = { document: state.document, index: result.index }
        }
        return undefined
      },
      (error: unknown) => {
        this.workspaceIndexVerifiedKey = null
        this.workspaceIndexCache = null
        if (
          error instanceof TypeError &&
          error.message === 'Local workspace authority contains an invalid Board document'
        ) {
          return
        }
        console.warn('[Workspace index] Could not update workspace.index.jsonl:', error)
      }
    )
  }

  private assertStateMatchesMetadata(
    state: PersistedLocalWorkspaceAuthorityState,
    metadata: PersistedLocalWorkspaceAuthorityMetadata
  ): void {
    if (
      state.authorityId !== metadata.authorityId ||
      state.identity.workspaceId !== metadata.identity.workspaceId
    ) {
      throw new TypeError('Local workspace authority metadata and saved head disagree')
    }
  }

  private headFromState(state: PersistedLocalWorkspaceAuthorityState): LocalWorkspaceAuthorityHead {
    return {
      authorityId: state.authorityId,
      contentHash: state.contentHash,
      document: state.document,
      identity: cloneIdentity(state.identity),
      revision: state.revision,
      updatedAt: state.updatedAt,
      version: LOCAL_WORKSPACE_AUTHORITY_VERSION
    }
  }

  private createReceipt(options: {
    appliedRevision: number
    baseRevision: number
    contentHash: string
    metadata: PersistedLocalWorkspaceAuthorityMetadata
    requestId: string
    status: LocalWorkspaceCommitReceipt['status']
  }): LocalWorkspaceCommitReceipt {
    return {
      appliedRevision: options.appliedRevision,
      authorityId: options.metadata.authorityId,
      baseRevision: options.baseRevision,
      contentHash: options.contentHash,
      committedAt: new Date().toISOString(),
      requestId: options.requestId,
      status: options.status,
      workspaceId: options.metadata.identity.workspaceId
    }
  }

  private notifyHeadCommitted(receipt: LocalWorkspaceCommitReceipt): void {
    for (const listener of this.headListeners) listener(receipt)
  }

  private notifyNavigationQueued(intent: LocalWorkspaceNavigationIntent): void {
    for (const listener of this.navigationListeners) listener(intent)
  }

  private notifyScreenshotQueued(intent: LocalWorkspaceScreenshotIntent): void {
    for (const listener of this.screenshotListeners) listener(intent)
  }

  private notifyThemeQueued(intent: LocalWorkspaceThemeIntent): void {
    for (const listener of this.themeListeners) listener(intent)
  }

  private async resolveNavigationPage(
    request: QueueResolvedLocalWorkspaceNavigationRequest
  ): Promise<{ objectIds?: string[]; pageId: string }> {
    const pageId = request.pageId?.trim()
    const pageName = request.pageName?.trim()
    const query = request.query?.trim()
    const presence = await this.readPresence()

    if (pageId && query) {
      const search = await this.searchWorkspace(query, 12)
      const onPage = search.results.filter((hit) => hit.board.id === pageId)
      const object = onPage.find((hit) => hit.kind === 'object')
      if (object) {
        return { objectIds: [object.id], pageId }
      }
      if (onPage.length > 0) return this.focusPage(pageId)
      throw new TypeError(`Nothing named "${query}" on this Board.`)
    }

    if (pageId) return this.focusPage(pageId)

    if (query) {
      const search = await this.searchWorkspace(query, 8)
      const hit = search.results.at(0)
      if (!hit) {
        throw new TypeError(`No Board match for "${query}".`)
      }
      if (hit.kind === 'object' && !request.objectIds?.length) {
        return { objectIds: [hit.id], pageId: hit.board.id }
      }
      return this.focusPage(hit.board.id)
    }
    if (pageName) {
      const pages = await this.listBoardPages()
      const needle = pageName.toLowerCase()
      const exact = pages.filter((page) => page.name.toLowerCase() === needle)
      const matches =
        exact.length > 0 ? exact : pages.filter((page) => page.name.toLowerCase().includes(needle))
      if (matches.length === 1) return this.focusPage(matches[0].id)
      if (matches.length > 1) {
        throw new TypeError(
          `Several Boards match "${pageName}": ${matches
            .slice(0, 5)
            .map((page) => page.name)
            .join(', ')}.`
        )
      }
      throw new TypeError(`No Board named "${pageName}".`)
    }
    if (presence?.pageId) return this.focusPage(presence.pageId)
    throw new TypeError('Look at a Board first, or name one.')
  }

  private async focusPage(pageId: string): Promise<{ objectIds?: string[]; pageId: string }> {
    const embedId = await this.liveEmbedIdOnPage(pageId)
    return embedId ? { objectIds: [embedId], pageId } : { pageId }
  }

  private async liveEmbedIdOnPage(pageId: string): Promise<string | null> {
    const metadata = await this.ensureMetadata()
    const state = await this.readState(metadata)
    if (!state) {
      throw new LocalWorkspaceAuthorityStoreError(
        'invalid_document',
        'Local workspace authority has no saved Board document'
      )
    }
    let document: ReturnType<typeof readAuthorityBoardDocument>
    try {
      document = readAuthorityBoardDocument(state.document)
    } catch {
      return null
    }
    const embeds: Array<{ current: boolean; id: string; name: string }> = []
    const pending = [...(document.graph.getNode(pageId)?.childIds ?? [])]
    while (pending.length > 0) {
      const id = pending.pop()
      if (!id || id === pageId) continue
      const node = document.graph.getNode(id)
      if (!node) continue
      pending.push(...node.childIds)
      if (node.type !== 'FRAME') continue
      const data = Array.isArray(node.pluginData) ? node.pluginData : []
      const smylr = data.some(
        (entry) =>
          entry.pluginId === 'smylr-production' &&
          entry.key === 'kind' &&
          entry.value === 'smylr-code-object-frame'
      )
      if (!smylr) continue
      embeds.push({
        current: node.name.toLowerCase().includes('current'),
        id,
        name: node.name
      })
    }
    const current = embeds.filter((embed) => embed.current)
    const matches = current.length > 0 ? current : embeds
    if (matches.length === 1) return matches[0].id
    if (matches.length > 1) {
      throw new TypeError(
        `Several live embeds on this Board: ${matches
          .slice(0, 5)
          .map((embed) => embed.name)
          .join(', ')}.`
      )
    }
    return null
  }

  private async listBoardPages(): Promise<Array<{ id: string; name: string }>> {
    const metadata = await this.ensureMetadata()
    const state = await this.readState(metadata)
    if (!state) {
      throw new LocalWorkspaceAuthorityStoreError(
        'invalid_document',
        'Local workspace authority has no saved Board document'
      )
    }
    let document: ReturnType<typeof readAuthorityBoardDocument>
    try {
      document = readAuthorityBoardDocument(state.document)
    } catch {
      throw new TypeError('The saved Board document has no page list to resolve by name.')
    }
    const root = document.graph.getNode(document.source.rootId)
    return (root?.childIds ?? []).flatMap((id) => {
      const node = document.graph.getNode(id)
      return node?.type === 'CANVAS' ? [{ id, name: node.name }] : []
    })
  }

  private async readJson(filePath: string): Promise<unknown> {
    return readJsonFile(filePath)
  }

  private async readNavigationIntent(): Promise<LocalWorkspaceNavigationIntent | null> {
    const value = await this.readJson(this.navigationPath)
    if (value === null) return null
    if (!isNavigationIntent(value)) {
      throw new TypeError('Local workspace authority navigation intent is invalid')
    }
    return value
  }

  private async readScreenshotIntent(): Promise<LocalWorkspaceScreenshotIntent | null> {
    const value = await this.readJson(this.screenshotIntentPath)
    if (value === null) return null
    if (!isScreenshotIntent(value)) {
      throw new TypeError('Local workspace authority screenshot intent is invalid')
    }
    return value
  }

  private async readScreenshotResult(): Promise<LocalWorkspaceScreenshotResult | null> {
    const value = await this.readJson(this.screenshotResultPath)
    if (value === null) return null
    if (!isScreenshotResult(value)) {
      throw new TypeError('Local workspace authority screenshot result is invalid')
    }
    return value
  }

  private async readThemeIntent(): Promise<LocalWorkspaceThemeIntent | null> {
    const value = await this.readJson(this.themePath)
    if (value === null) return null
    if (!isThemeIntent(value)) {
      throw new TypeError('Local workspace authority theme intent is invalid')
    }
    return value
  }

  private async atomicWrite(filePath: string, value: unknown): Promise<void> {
    await writeJsonFile(filePath, value, { space: 0 })
  }

  private async readTraceSnapshot(includeEvidenceStatuses = true): Promise<TraceFileSnapshot> {
    const snapshot = replayTraceFileEvents(await this.traceFiles.readEvents())
    if (!includeEvidenceStatuses) return snapshot
    const evidenceIds = [
      ...new Set(
        [...snapshot.sessions.values()].flatMap((session) =>
          session.events.flatMap((event) =>
            event.evidence?.evidenceId ? [event.evidence.evidenceId] : []
          )
        )
      )
    ]
    if (evidenceIds.length === 0) return snapshot
    const statuses = await this.traceFiles.evidenceStatuses(evidenceIds)
    for (const [sessionId, session] of snapshot.sessions) {
      snapshot.sessions.set(sessionId, {
        ...session,
        events: session.events.map((event) => {
          const evidenceId = event.evidence?.evidenceId
          const evidenceStatus = evidenceId ? statuses.get(evidenceId) : undefined
          if (evidenceStatus === 'evicted' || evidenceStatus === 'ready') {
            return { ...event, evidenceStatus }
          }
          return event
        })
      })
    }
    return snapshot
  }

  private async removeDirectTraceContext(): Promise<void> {
    await unlink(this.traceFiles.currentContextPath).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') throw error
    })
  }

  private async ensureDirectTraceContext(
    state: PersistedLocalWorkspaceAuthorityState
  ): Promise<void> {
    const current = await this.traceFiles.readCurrentContext()
    if (current?.workspace_revision === state.revision) return
    await this.refreshDirectTraceContext(state)
  }

  private async refreshDirectTraceContext(
    state: PersistedLocalWorkspaceAuthorityState
  ): Promise<void> {
    const selection = selectDirectTrace(await this.readTraceSnapshot())
    if (!selection) {
      await this.removeDirectTraceContext()
      return
    }
    const { gesture, spokenTurn } = selection
    const pageId = spokenTurn?.scope.pageId ?? gesture?.boardOrigin.pageId
    const boardContext = resolveDirectTraceBoardContext(state.document, pageId, gesture)
    await this.traceFiles.writeCurrentContext({
      ...(gesture ? { gesture } : {}),
      pageMissing: boardContext.pageMissing,
      ...(boardContext.pageName ? { pageName: boardContext.pageName } : {}),
      ...(spokenTurn ? { spokenTurn } : {}),
      targetMissing: boardContext.targetMissing,
      workspaceRevision: state.revision
    })
  }

  flushHistoryWrites(): Promise<void> {
    return this.historyWriteTail
  }

  private enqueueHistoryWrite(work: () => Promise<void>): void {
    const tail = this.historyWriteTail.then(work, work)
    this.historyWriteTail = tail
    const writeLockKey = this.activeWriteLockKey
    if (!writeLockKey) return
    rootDeferredWriteTails.set(writeLockKey, { owner: this, tail })
    void tail.then(
      () => {
        if (rootDeferredWriteTails.get(writeLockKey)?.tail === tail) {
          rootDeferredWriteTails.delete(writeLockKey)
        }
        return undefined
      },
      () => undefined
    )
  }

  private async writeState(
    metadata: PersistedLocalWorkspaceAuthorityMetadata,
    state: PersistedLocalWorkspaceAuthorityState,
    contentChanged = true,
    serializedDocument = contentChanged ? serializeDocument(state.document).serialized : undefined,
    options?: { deferDocument?: boolean; deferHistory?: boolean }
  ): Promise<void> {
    const persistDocument = async () => {
      if (contentChanged && serializedDocument) {
        await writeSerializedJsonFile(this.documentPath, serializedDocument)
      }
    }
    const persistHistory = async () => {
      if (!contentChanged || !serializedDocument) return
      const snapshot = serializeAuthorityState(state, serializedDocument)
      await writeJsonHistory(this.historyPath, state.revision, state.contentHash, snapshot)
      await this.pruneHistory()
    }

    if (contentChanged && serializedDocument && !options?.deferDocument) {
      await persistDocument()
    }
    await this.atomicWrite(this.ledgerPath, {
      contentHash: state.contentHash,
      receipts: state.receipts,
      revision: state.revision,
      updatedAt: state.updatedAt,
      version: state.version
    } satisfies PersistedLocalWorkspaceAuthorityLedger)
    await this.bestEffortEnsureWorkspaceIndex(state)
    if (contentChanged) await this.refreshDirectTraceContext(state)

    const deferIo = Boolean(
      contentChanged && serializedDocument && (options?.deferDocument || options?.deferHistory)
    )
    if (deferIo) {
      await this.cacheStatus(metadata, state, undefined, undefined, {
        pendingDocumentWrite: options?.deferDocument === true
      })
      this.enqueueHistoryWrite(async () => {
        if (options?.deferDocument) await persistDocument()
        await persistHistory()
        await this.cacheStatus(metadata, state, undefined, undefined, {
          expectedCurrentRevision: state.revision
        })
      })
      return
    }

    if (contentChanged && serializedDocument) await persistHistory()
    await this.cacheStatus(metadata, state)
  }

  private async pruneHistory(): Promise<void> {
    await pruneJsonHistory(this.historyPath, MAX_HISTORY_SNAPSHOTS)
  }

  private async withReadLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.rootPath, { recursive: true })
    return operation()
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.rootPath, { recursive: true })
    const writeLockKey = await realpath(this.rootPath)
    const previous = rootWriteTails.get(writeLockKey) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    rootWriteTails.set(writeLockKey, current)
    await previous
    const deferredWrite = rootDeferredWriteTails.get(writeLockKey)
    if (deferredWrite && deferredWrite.owner !== this) await deferredWrite.tail
    this.activeWriteLockKey = writeLockKey
    try {
      return await operation()
    } finally {
      this.activeWriteLockKey = null
      release()
      if (rootWriteTails.get(writeLockKey) === current) {
        rootWriteTails.delete(writeLockKey)
      }
    }
  }
}
