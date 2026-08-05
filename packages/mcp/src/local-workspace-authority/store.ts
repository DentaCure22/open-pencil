import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, type Dirent } from 'node:fs'
import { mkdir, readFile, readdir, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { WorkspaceSearchResult } from '@open-pencil/core/rpc'

import {
  buildLocalWorkspaceDirectTraceContext,
  localWorkspaceTraceEvidencePath,
  LOCAL_WORKSPACE_TRACE_CONTEXT_FILE,
  LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY
} from './agent-context'
import { LocalWorkspaceAuthorityDatabase } from './database'
import { readAuthorityBoardDocument } from './document'
import {
  jsonFileMarker,
  pruneJsonHistory,
  readJsonFile,
  readJsonHistory,
  writeBinaryFile,
  writeJsonFile,
  writeJsonHistory
} from './json-file'
import {
  isPersistedLocalWorkspaceTraceGestures,
  normalizeLocalWorkspaceTraceGesture,
  type LocalWorkspaceTraceEvidenceReference,
  type LocalWorkspaceTraceGesture,
  type LocalWorkspaceTraceGestureRead
} from './trace'
import {
  LOCAL_WORKSPACE_AUTHORITY_VERSION,
  LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION,
  type CommitLocalWorkspaceRequest,
  type InitializeLocalWorkspaceRequest,
  type LocalWorkspaceAuthorityHead,
  type LocalWorkspaceAuthorityStatus,
  type LocalWorkspaceCommitReceipt,
  type LocalWorkspaceCommitTransaction,
  type LocalWorkspaceIdentity,
  type LocalWorkspaceNavigationIntent,
  type QueueLocalWorkspaceNavigationRequest
} from './types'
import type { LocalWorkspaceSearchIndex as LocalWorkspaceSearchIndexType } from './workspace-search'

const AUTHORITY_METADATA_FILE = 'authority.json'
const AUTHORITY_DOCUMENT_FILE = 'workspace.json'
const AUTHORITY_LEDGER_FILE = 'workspace-state.json'
const AUTHORITY_NAVIGATION_FILE = 'navigation.json'
const AUTHORITY_HISTORY_DIRECTORY = 'history'
const LEGACY_AUTHORITY_TRACE_FILE = 'trace-gestures.json'
const MAX_HISTORY_SNAPSHOTS = 64
const MAX_RECEIPTS = 500
const DEFAULT_NAVIGATION_INTENT_TTL_MS = 60_000
const rootWriteTails = new Map<string, Promise<void>>()

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

export type LocalWorkspaceAuthorityStoreOptions = {
  preferredWorkspaceId?: string | null
  root: string
  semanticServices?: boolean
}

export type LocalWorkspaceAuthorityHeadListener = (receipt: LocalWorkspaceCommitReceipt) => void

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
    (candidate.transaction === undefined || isCommitTransaction(candidate.transaction)) &&
    typeof candidate.workspaceId === 'string'
  )
}

function isCommitTransaction(value: unknown): value is LocalWorkspaceCommitTransaction {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalWorkspaceCommitTransaction>
  return Boolean(
    typeof candidate.pageId === 'string' &&
    candidate.pageId.length > 0 &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.length > 0 &&
    candidate.route === 'board_build:plan/v1'
  )
}

function sameCommitTransaction(
  first: LocalWorkspaceCommitTransaction,
  second: LocalWorkspaceCommitTransaction
): boolean {
  return first.pageId === second.pageId && first.requestId === second.requestId
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
    typeof candidate.pageId === 'string' &&
    (candidate.runtimeInstanceId === undefined ||
      typeof candidate.runtimeInstanceId === 'string') &&
    typeof candidate.sequence === 'number' &&
    Number.isInteger(candidate.sequence) &&
    candidate.sequence > 0 &&
    typeof candidate.workspaceId === 'string'
  )
}

type TraceJsonRecord = Record<string, unknown>

type PersistedTraceSpokenTurn = {
  endedAt: string
  id: string
  sequence: number
  startedAt: string
  value: TraceJsonRecord
}

function jsonRecord(value: unknown): TraceJsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as TraceJsonRecord)
    : null
}

function traceSession(value: unknown): { id: string; startedAt: string } {
  const session = jsonRecord(value)
  if (
    !session ||
    typeof session.id !== 'string' ||
    !session.id.trim() ||
    typeof session.startedAt !== 'string' ||
    !Number.isFinite(Date.parse(session.startedAt)) ||
    typeof session.durationMs !== 'number' ||
    !Number.isFinite(session.durationMs) ||
    !Array.isArray(session.events) ||
    !Array.isArray(session.contextDraft)
  ) {
    throw new TypeError('Trace session payload is invalid.')
  }
  return { id: session.id.trim(), startedAt: new Date(session.startedAt).toISOString() }
}

function traceSummary(value: unknown, sessionId: string): Record<string, unknown> {
  const summary = jsonRecord(value)
  if (
    !summary ||
    summary.id !== sessionId ||
    typeof summary.startedAt !== 'string' ||
    typeof summary.updatedAt !== 'string' ||
    typeof summary.title !== 'string'
  ) {
    throw new TypeError('Trace session summary is invalid.')
  }
  return summary
}

function traceEvidenceReferences(
  value: unknown
): Map<string, LocalWorkspaceTraceEvidenceReference> {
  const session = jsonRecord(value)
  if (!Array.isArray(session?.events)) return new Map()
  return new Map(
    session.events.flatMap((value) => {
      const event = jsonRecord(value)
      const evidence = jsonRecord(event?.evidence)
      if (
        !event ||
        typeof event.id !== 'string' ||
        !event.id.trim() ||
        !evidence ||
        typeof evidence.evidenceId !== 'string' ||
        !evidence.evidenceId.trim()
      ) {
        return []
      }
      const mimeType = evidence.mimeType === 'image/png' ? evidence.mimeType : undefined
      return [
        [
          event.id.trim(),
          {
            evidenceId: evidence.evidenceId.trim(),
            ...(mimeType ? { mimeType } : {})
          }
        ] as const
      ]
    })
  )
}

function gestureWithEvidenceReference(
  value: unknown,
  references: Map<string, LocalWorkspaceTraceEvidenceReference>
): unknown {
  const gesture = jsonRecord(value)
  if (!gesture || gesture.evidence !== undefined) return value
  const reference =
    typeof gesture.gestureId === 'string' ? references.get(gesture.gestureId.trim()) : undefined
  return reference ? { ...gesture, evidence: reference } : gesture
}

type ValidTraceSpokenTurn = TraceJsonRecord & {
  endedAt: string
  endedAtEpochMs: number
  id: string
  sequence: number
  startedAt: string
  startedAtEpochMs: number
  text: string
}

function hasValidTraceSpokenTurnFields(turn: TraceJsonRecord): turn is ValidTraceSpokenTurn {
  return (
    typeof turn.id === 'string' &&
    Boolean(turn.id.trim()) &&
    typeof turn.sequence === 'number' &&
    Number.isInteger(turn.sequence) &&
    turn.sequence > 0 &&
    typeof turn.text === 'string' &&
    Boolean(turn.text.trim())
  )
}

function hasValidTraceSpokenTurnTiming(turn: TraceJsonRecord): turn is ValidTraceSpokenTurn {
  return (
    typeof turn.startedAt === 'string' &&
    Number.isFinite(Date.parse(turn.startedAt)) &&
    typeof turn.endedAt === 'string' &&
    Number.isFinite(Date.parse(turn.endedAt)) &&
    typeof turn.startedAtEpochMs === 'number' &&
    Number.isFinite(turn.startedAtEpochMs) &&
    typeof turn.endedAtEpochMs === 'number' &&
    Number.isFinite(turn.endedAtEpochMs) &&
    turn.startedAtEpochMs <= turn.endedAtEpochMs &&
    turn.endedAtEpochMs - turn.startedAtEpochMs <= 60_000
  )
}

function hasValidTraceSpokenTurnScope(
  scope: TraceJsonRecord | null,
  metadata: PersistedLocalWorkspaceAuthorityMetadata
): boolean {
  return Boolean(
    scope &&
    scope.workspaceId === metadata.identity.workspaceId &&
    scope.documentId === metadata.identity.documentId &&
    typeof scope.pageId === 'string' &&
    scope.pageId.trim()
  )
}

function traceSpokenTurn(
  value: unknown,
  metadata: PersistedLocalWorkspaceAuthorityMetadata
): PersistedTraceSpokenTurn {
  const turn = jsonRecord(value)
  const scope = jsonRecord(turn?.scope)
  if (
    !turn ||
    !hasValidTraceSpokenTurnFields(turn) ||
    !hasValidTraceSpokenTurnTiming(turn) ||
    !hasValidTraceSpokenTurnScope(scope, metadata)
  ) {
    throw new TypeError('Trace spoken turn payload is invalid.')
  }
  return {
    endedAt: new Date(turn.endedAt).toISOString(),
    id: turn.id.trim(),
    sequence: turn.sequence,
    startedAt: new Date(turn.startedAt).toISOString(),
    value: structuredClone(turn)
  }
}

function serializedDocument(document: unknown): string {
  const serialized = JSON.stringify(document)
  if (typeof serialized !== 'string') {
    throw new LocalWorkspaceAuthorityStoreError(
      'invalid_document',
      'Workspace document must be JSON-serializable'
    )
  }
  return serialized
}

function documentHash(document: unknown): string {
  return createHash('sha256').update(serializedDocument(document)).digest('hex')
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
  private readonly database: LocalWorkspaceAuthorityDatabase
  private readonly headListeners = new Set<LocalWorkspaceAuthorityHeadListener>()
  private readonly rootPath: string
  private readonly metadataPath: string
  private readonly documentPath: string
  private readonly ledgerPath: string
  private readonly historyPath: string
  private readonly navigationPath: string
  private readonly legacyTracePath: string
  private readonly traceContextPath: string
  private readonly preferredWorkspaceId: string | null
  private readonly semanticServices: boolean

  constructor(options: LocalWorkspaceAuthorityStoreOptions) {
    this.rootPath = path.resolve(options.root)
    this.database = new LocalWorkspaceAuthorityDatabase(this.rootPath)
    this.metadataPath = path.join(this.rootPath, AUTHORITY_METADATA_FILE)
    this.documentPath = path.join(this.rootPath, AUTHORITY_DOCUMENT_FILE)
    this.ledgerPath = path.join(this.rootPath, AUTHORITY_LEDGER_FILE)
    this.historyPath = path.join(this.rootPath, AUTHORITY_HISTORY_DIRECTORY)
    this.navigationPath = path.join(this.rootPath, AUTHORITY_NAVIGATION_FILE)
    this.legacyTracePath = path.join(this.rootPath, LEGACY_AUTHORITY_TRACE_FILE)
    this.traceContextPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_CONTEXT_FILE)
    this.preferredWorkspaceId = normalizedId(options.preferredWorkspaceId)
    this.semanticServices = options.semanticServices ?? true
  }

  close(): void {
    this.database.close()
  }

  subscribeHeadCommitted(listener: LocalWorkspaceAuthorityHeadListener): () => void {
    this.headListeners.add(listener)
    return () => this.headListeners.delete(listener)
  }

  hasSavedHead(): boolean {
    return existsSync(this.documentPath)
  }

  externalStateMarker(): Promise<string> {
    return jsonFileMarker(this.documentPath)
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
      const createdAt = new Date()
      const intent: LocalWorkspaceNavigationIntent = {
        authorityId: metadata.authorityId,
        contentDocumentId: metadata.identity.documentId,
        consumedAt: null,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
        intentId: `board-open-${randomUUID()}`,
        pageId: request.pageId,
        ...(request.runtimeInstanceId ? { runtimeInstanceId: request.runtimeInstanceId } : {}),
        sequence: (existing?.sequence ?? 0) + 1,
        version: LOCAL_WORKSPACE_NAVIGATION_INTENT_VERSION,
        workspaceId: metadata.identity.workspaceId
      }
      await this.atomicWrite(this.navigationPath, intent)
      return intent
    })
  }

  pendingNavigationIntent(): Promise<LocalWorkspaceNavigationIntent | null> {
    return this.withWriteLock(async () => {
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

  recordTraceSession(input: {
    gestures: unknown
    session: unknown
    spokenTurns?: unknown
    summary: unknown
  }): Promise<{ gestureCount: number; spokenTurnCount: number; summary: unknown }> {
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
      this.database.writeTraceSession({
        gestures,
        session,
        sessionValue: input.session,
        spokenTurns,
        summaryValue: summary,
        updatedAt: new Date().toISOString()
      })
      await this.refreshDirectTraceContext(state)
      return {
        gestureCount: gestures.length,
        spokenTurnCount: spokenTurns?.length ?? 0,
        summary: structuredClone(input.summary)
      }
    })
  }

  traceSessionSummaries(): Promise<unknown[]> {
    return this.withReadLock(async () => structuredClone(this.database.readTraceSessionSummaries()))
  }

  traceSession(sessionId: string): Promise<unknown> {
    const normalizedSessionId = normalizedId(sessionId)
    if (!normalizedSessionId) throw new TypeError('Trace session ID is required.')
    return this.withReadLock(async () => {
      const session = this.database.readTraceSession(normalizedSessionId)
      return session === undefined ? null : structuredClone(session)
    })
  }

  traceSpokenTurns(): Promise<unknown[]> {
    return this.withReadLock(async () => structuredClone(this.database.readTraceSpokenTurns()))
  }

  deleteTraceSession(sessionId: string): Promise<boolean> {
    const normalizedSessionId = normalizedId(sessionId)
    if (!normalizedSessionId) throw new TypeError('Trace session ID is required.')
    return this.withWriteLock(async () => {
      const deleted = this.database.deleteTraceSession(normalizedSessionId)
      if (!deleted) return false
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
      this.database.writeTraceEvidence({
        bytes: input.bytes,
        evidenceId,
        mimeType: input.mimeType,
        sessionId
      })
      await this.refreshDirectTraceContext(state)
    })
  }

  traceEvidence(evidenceId: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
    const normalizedEvidenceId = normalizedId(evidenceId)
    if (!normalizedEvidenceId) throw new TypeError('Trace evidence ID is required.')
    return this.withReadLock(async () => this.database.readTraceEvidence(normalizedEvidenceId))
  }

  async traceGesture(selector: {
    gestureId?: string
    includeImage?: boolean
    latest?: boolean
  }): Promise<
    | { gesture: LocalWorkspaceTraceGestureRead; scanned: { sessions: number }; status: 'matched' }
    | { reason: 'gesture_not_found'; scanned: { sessions: number }; status: 'empty' }
  > {
    const gestureId = normalizedId(selector.gestureId)
    if (Boolean(gestureId) === (selector.latest === true)) {
      throw new TypeError('Trace gesture retrieval requires exactly one selector.')
    }
    const readGesture = () =>
      this.withReadLock(async () => {
        const scanned = { sessions: this.database.traceSessionCount() }
        const gesture = this.database.readTraceGesture(gestureId ?? undefined) as
          | LocalWorkspaceTraceGesture
          | undefined
        if (!gesture) {
          return { reason: 'gesture_not_found' as const, scanned, status: 'empty' as const }
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
        const image = this.database.readTraceEvidence(persisted.evidence.evidenceId)
        if (!image || image.mimeType !== 'image/png') {
          return {
            gesture: { ...persisted, imageStatus: 'missing' as const },
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
    const persisted = await readGesture()
    if (persisted.status === 'matched' || !existsSync(this.legacyTracePath)) return persisted
    await this.migrateLegacyTraceGestures()
    return readGesture()
  }

  status(): Promise<LocalWorkspaceAuthorityStatus> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (state) await this.ensureDirectTraceContext(state)
      return {
        authorityId: metadata.authorityId,
        contentHash: state?.contentHash ?? null,
        identity: structuredClone(metadata.identity),
        revision: state?.revision ?? 0,
        seedWorkspaceId: metadata.seedWorkspaceId,
        state: state ? 'ready' : 'configured',
        updatedAt: state?.updatedAt ?? null,
        version: LOCAL_WORKSPACE_AUTHORITY_VERSION
      }
    })
  }

  head(): Promise<LocalWorkspaceAuthorityHead | null> {
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const state = await this.readState(metadata)
      if (!state) return null
      this.assertStateMatchesMetadata(state, metadata)
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
      const { LocalWorkspaceSearchIndex } = await import('./workspace-search')
      const index = new LocalWorkspaceSearchIndex(this.rootPath)
      try {
        index.sync(this.headFromState(state))
        return index.search(query, limit)
      } finally {
        index.close()
      }
    })
  }

  headAtRevision(revision: number): Promise<LocalWorkspaceAuthorityHead | null> {
    if (!Number.isInteger(revision) || revision < 0) {
      throw new TypeError('Local workspace authority revision must be a non-negative integer')
    }
    return this.withWriteLock(async () => {
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

  transactionReceipts(requestId: string): Promise<LocalWorkspaceCommitReceipt[]> {
    const normalizedRequestId = normalizedId(requestId)
    if (!normalizedRequestId) {
      throw new TypeError('Local workspace transaction request ID is required')
    }
    return this.withWriteLock(async () => {
      const metadata = await this.ensureMetadata()
      const current = await this.readState(metadata)
      if (!current) return []
      this.assertStateMatchesMetadata(current, metadata)
      return Object.values(current.receipts)
        .filter(
          (receipt): receipt is LocalWorkspaceCommitReceipt =>
            receipt?.transaction?.requestId === normalizedRequestId
        )
        .map((receipt) => structuredClone(receipt))
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
      const contentHash = documentHash(materialized.document)
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
          await this.writeState({
            ...current,
            receipts: boundedReceipts(current.receipts, receipt)
          })
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
        document: structuredClone(materialized.document),
        identity: structuredClone(metadata.identity),
        receipts: { [request.requestId]: receipt },
        revision: 1,
        updatedAt: receipt.committedAt,
        version: LOCAL_WORKSPACE_AUTHORITY_VERSION
      }
      await this.writeState(state)
      await this.bestEffortSyncSearchIndex(state)
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
      const materialized = await this.materializeDocument(request.document)
      const contentHash = documentHash(materialized.document)
      const replay = current.receipts[request.requestId]
      if (replay) {
        if (
          replay.contentHash === contentHash &&
          ((replay.transaction === undefined && request.transaction === undefined) ||
            (replay.transaction !== undefined &&
              request.transaction !== undefined &&
              sameCommitTransaction(replay.transaction, request.transaction)))
        ) {
          return replay
        }
        throw new LocalWorkspaceAuthorityStoreError(
          'idempotency_conflict',
          `Request "${request.requestId}" was already used for different content`
        )
      }

      let transaction = request.transaction
      if (transaction) {
        const prior = Object.values(current.receipts).find(
          (receipt) => receipt?.transaction?.requestId === transaction?.requestId
        )?.transaction
        if (prior && !sameCommitTransaction(prior, transaction)) {
          throw new LocalWorkspaceAuthorityStoreError(
            'idempotency_conflict',
            `Board transaction "${transaction.requestId}" was already recorded for a different target`
          )
        }
        if (prior) transaction = undefined
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
          transaction,
          baseRevision: current.revision,
          appliedRevision: current.revision
        })
        await this.writeState({
          ...current,
          receipts: boundedReceipts(current.receipts, receipt)
        })
        return receipt
      }

      const nextRevision = current.revision + 1
      const receipt = this.createReceipt({
        contentHash,
        metadata,
        requestId: request.requestId,
        status: 'committed',
        transaction,
        baseRevision: current.revision,
        appliedRevision: nextRevision
      })
      const nextState: PersistedLocalWorkspaceAuthorityState = {
        ...current,
        contentHash,
        document: structuredClone(materialized.document),
        receipts: boundedReceipts(current.receipts, receipt),
        revision: nextRevision,
        updatedAt: receipt.committedAt
      }
      await this.writeState(nextState)
      await this.bestEffortSyncSearchIndex(nextState)
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

  private async readState(
    metadata: PersistedLocalWorkspaceAuthorityMetadata
  ): Promise<PersistedLocalWorkspaceAuthorityState | null> {
    const savedDocument = await this.readJson(this.documentPath)
    if (savedDocument === null) return null
    const materialized = await this.materializeDocument(savedDocument)
    const document = materialized.document
    if (materialized.changed) await this.atomicWrite(this.documentPath, document)
    const persistedLedger = await this.readJson(this.ledgerPath)
    if (persistedLedger !== null && !isLedger(persistedLedger)) {
      throw new TypeError('Local workspace authority ledger is invalid')
    }
    const contentHash = documentHash(document)
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
      identity: structuredClone(metadata.identity),
      ...currentLedger
    }
    if (persistedLedger !== currentLedger) {
      await this.atomicWrite(this.ledgerPath, currentLedger)
      await writeJsonHistory(this.historyPath, state.revision, state.contentHash, state)
      await this.pruneHistory()
      await this.bestEffortSyncSearchIndex(state)
      await this.refreshDirectTraceContext(state)
    }
    return state
  }

  private async materializeDocument(document: unknown): Promise<{
    changed: boolean
    document: unknown
  }> {
    if (!this.semanticServices) return { changed: false, document }
    const { materializeAuthorityMermaidDocument } = await import('./mermaid-materialization')
    return materializeAuthorityMermaidDocument(document)
  }

  private async bestEffortSyncSearchIndex(
    state: PersistedLocalWorkspaceAuthorityState
  ): Promise<void> {
    if (!this.semanticServices) return
    let index: LocalWorkspaceSearchIndexType | null = null
    try {
      const { LocalWorkspaceSearchIndex } = await import('./workspace-search')
      index = new LocalWorkspaceSearchIndex(this.rootPath)
      index.sync(this.headFromState(state))
    } catch (error) {
      console.warn('[Workspace search] Could not update the disposable index:', error)
    } finally {
      index?.close()
    }
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
      document: structuredClone(state.document),
      identity: structuredClone(state.identity),
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
    transaction?: LocalWorkspaceCommitTransaction
  }): LocalWorkspaceCommitReceipt {
    return {
      appliedRevision: options.appliedRevision,
      authorityId: options.metadata.authorityId,
      baseRevision: options.baseRevision,
      contentHash: options.contentHash,
      committedAt: new Date().toISOString(),
      requestId: options.requestId,
      status: options.status,
      ...(options.transaction ? { transaction: structuredClone(options.transaction) } : {}),
      workspaceId: options.metadata.identity.workspaceId
    }
  }

  private notifyHeadCommitted(receipt: LocalWorkspaceCommitReceipt): void {
    for (const listener of this.headListeners) listener(receipt)
  }

  private migrateLegacyTraceGestures(): Promise<void> {
    return this.withWriteLock(async () => {
      if (this.database.readTraceMetadata('legacy_trace_migrated') === true) return
      let value: unknown
      try {
        value = JSON.parse(await readFile(this.legacyTracePath, 'utf8')) as unknown
      } catch (error) {
        if (errorCode(error) === 'ENOENT') {
          this.database.writeTraceMetadata('legacy_trace_migrated', true)
          return
        }
        throw error
      }
      if (!isPersistedLocalWorkspaceTraceGestures(value)) {
        throw new TypeError('Legacy local workspace Trace gestures are invalid')
      }
      const metadata = await this.ensureMetadata()
      const sessions = new Map<string, LocalWorkspaceTraceGesture[]>()
      for (const candidate of value.gestures) {
        const gesture = normalizeLocalWorkspaceTraceGesture(candidate, metadata)
        const gestures = sessions.get(gesture.sessionId) ?? []
        gestures.push(gesture)
        sessions.set(gesture.sessionId, gestures)
      }
      for (const [sessionId, gestures] of sessions) {
        gestures.sort(
          (first, second) =>
            Date.parse(first.capturedAt) - Date.parse(second.capturedAt) ||
            first.gestureId.localeCompare(second.gestureId)
        )
        const startedAt = gestures[0]?.capturedAt
        const updatedAt = gestures.at(-1)?.capturedAt
        if (!startedAt || !updatedAt) continue
        const session = {
          contextDraft: [],
          durationMs: Math.max(0, Date.parse(updatedAt) - Date.parse(startedAt)),
          events: [],
          id: sessionId,
          startedAt,
          title: 'Imported Trace target'
        }
        this.database.writeTraceSession({
          gestures,
          session,
          sessionValue: session,
          summaryValue: {
            durationMs: session.durationMs,
            eventCount: 0,
            evidenceCount: 0,
            gestureCount: gestures.length,
            id: sessionId,
            startedAt,
            title: session.title,
            updatedAt
          },
          updatedAt
        })
      }
      this.database.writeTraceMetadata('legacy_trace_migrated', true)
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

  private async atomicWrite(filePath: string, value: unknown): Promise<void> {
    await writeJsonFile(filePath, value)
  }

  private async removeDirectTraceContext(): Promise<void> {
    await unlink(this.traceContextPath).catch((error: unknown) => {
      if (errorCode(error) !== 'ENOENT') throw error
    })
    await this.pruneDirectTraceEvidence()
  }

  private async pruneDirectTraceEvidence(retainPath?: string): Promise<void> {
    const directoryPath = path.join(this.rootPath, LOCAL_WORKSPACE_TRACE_EVIDENCE_DIRECTORY)
    let entries: Dirent[]
    try {
      entries = await readdir(directoryPath, { withFileTypes: true })
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return
      throw error
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
        .map((entry) => path.join(directoryPath, entry.name))
        .filter((filePath) => filePath !== retainPath)
        .map((filePath) => unlink(filePath))
    )
  }

  private async ensureDirectTraceContext(
    state: PersistedLocalWorkspaceAuthorityState
  ): Promise<void> {
    if (existsSync(this.traceContextPath) || !this.database.readTraceGesture()) return
    await this.refreshDirectTraceContext(state)
  }

  private async refreshDirectTraceContext(
    state: PersistedLocalWorkspaceAuthorityState
  ): Promise<void> {
    const value = this.database.readTraceGesture()
    if (!value) {
      await this.removeDirectTraceContext()
      return
    }
    let gesture: LocalWorkspaceTraceGesture
    try {
      gesture = normalizeLocalWorkspaceTraceGesture(value, {
        authorityId: state.authorityId,
        identity: state.identity
      })
    } catch {
      await this.removeDirectTraceContext()
      return
    }

    const evidencePath = gesture.evidence
      ? localWorkspaceTraceEvidencePath(this.rootPath, gesture.evidence.evidenceId)
      : undefined
    const evidence = gesture.evidence
      ? this.database.readTraceEvidence(gesture.evidence.evidenceId)
      : null
    const evidenceReady = evidence?.mimeType === 'image/png'
    if (evidenceReady && evidencePath) {
      await writeBinaryFile(evidencePath, evidence.bytes)
    }

    let document: ReturnType<typeof readAuthorityBoardDocument>
    try {
      document = readAuthorityBoardDocument(state.document)
    } catch {
      await this.removeDirectTraceContext()
      return
    }

    await this.atomicWrite(
      this.traceContextPath,
      buildLocalWorkspaceDirectTraceContext({
        document,
        ...(evidencePath ? { evidencePath } : {}),
        evidenceReady,
        gesture,
        identity: state.identity,
        revision: state.revision
      })
    )
    await this.pruneDirectTraceEvidence(evidenceReady ? evidencePath : undefined)
  }

  private async writeState(state: PersistedLocalWorkspaceAuthorityState): Promise<void> {
    await this.atomicWrite(this.documentPath, state.document)
    await this.atomicWrite(this.ledgerPath, {
      contentHash: state.contentHash,
      receipts: state.receipts,
      revision: state.revision,
      updatedAt: state.updatedAt,
      version: state.version
    } satisfies PersistedLocalWorkspaceAuthorityLedger)
    await writeJsonHistory(this.historyPath, state.revision, state.contentHash, state)
    await this.pruneHistory()
    await this.refreshDirectTraceContext(state)
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
    try {
      this.database.beginImmediate()
      try {
        const result = await operation()
        this.database.commit()
        return result
      } catch (error) {
        this.database.rollback()
        throw error
      }
    } finally {
      release()
      if (rootWriteTails.get(writeLockKey) === current) {
        rootWriteTails.delete(writeLockKey)
      }
    }
  }
}
