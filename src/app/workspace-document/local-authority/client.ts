import { promiseTimeout } from '@vueuse/core'

import { IS_BROWSER } from '@open-pencil/core/constants'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { AutomationPersistenceTransaction } from '@/app/automation/bridge/persistence'
import { writeCacheValue } from '@/app/cache'
import type { CachedSmylrProductionDocument } from '@/app/smylr-production/document-state'
import type { OpenPencilWorkspaceIdentity } from '@/app/workspace-document/identity'

import {
  decodeLocalWorkspaceDocument,
  encodeLocalWorkspaceDocument,
  stringifyLocalWorkspaceAuthorityValue
} from './codec'

const LOCAL_WORKSPACE_AUTHORITY_HTTP_PORT = 7602
const AUTHORITY_ORIGIN = `http://127.0.0.1:${String(LOCAL_WORKSPACE_AUTHORITY_HTTP_PORT)}`
const DEV_LOCAL_AUTHORITY_AUTH_TOKEN =
  import.meta.env.DEV && typeof __OPENPENCIL_LOCAL_AUTHORITY_TOKEN__ === 'string'
    ? __OPENPENCIL_LOCAL_AUTHORITY_TOKEN__
    : null
const AUTHORITY_BOOT_RETRIES = 10
const AUTHORITY_BOOT_RETRY_MS = 200
const AUTHORITY_CHANGE_RETRY_MS = 500
const AUTHORITY_CHANGE_WAIT_MS = 25_000
const AUTHORITY_CHANGE_REQUEST_TIMEOUT_MS = 30_000
const RECOVERY_CACHE_PREFIX = 'workspace-authority/recovery-v1'

export type LocalWorkspaceAuthorityStatus = {
  authorityId: string
  contentHash: string | null
  identity: OpenPencilWorkspaceIdentity
  revision: number
  seedWorkspaceId: string | null
  state: 'configured' | 'ready'
  updatedAt: string | null
  version: 1
}

export type LocalWorkspaceAuthorityHead = {
  authorityId: string
  contentHash: string
  document: CachedSmylrProductionDocument
  identity: OpenPencilWorkspaceIdentity
  revision: number
  updatedAt: string
  version: 1
}

export type LocalWorkspaceAuthorityReceipt = {
  appliedRevision: number
  authorityId: string
  baseRevision: number
  contentHash: string
  committedAt: string
  requestId: string
  status: 'committed' | 'initialized' | 'unchanged'
  transaction?: AutomationPersistenceTransaction
  workspaceId: string
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
  version: 1
  workspaceId: string
}

export type LocalWorkspaceThemeSetting = 'auto' | 'dark' | 'light'

export type LocalWorkspaceThemeIntent = {
  consumedAt: string | null
  createdAt: string
  sequence: number
  theme: LocalWorkspaceThemeSetting
  updatedAt: string
  version: 1
}

type LocalWorkspaceAuthorityErrorBody = {
  code?: string
  currentRevision?: number
  error?: string
}

type AuthorityRequestOptions = {
  body?: unknown
  method?: 'DELETE' | 'GET' | 'POST'
  signal?: AbortSignal
}

type LocalWorkspaceAuthorityChange =
  | {
      authorityId: string
      changed: true
      contentHash: string
      revision: number
      workspaceId: string
    }
  | { changed: false; navigationSequence?: number; revision: number; themeSequence?: number }

export type LocalWorkspaceAuthorityChangeListeners = {
  onHeadCommitted(): void
  onNavigationQueued(): void
  onThemeQueued(): void
}

type PreservedLocalWorkspaceRecovery = {
  authorityId: string
  baseRevision: number
  document: unknown
  preservedAt: string
  reason: string
  requestId: string
  workspaceId: string
}

type LocalWorkspaceAuthorityChangeSubscriptionState = {
  controller: AbortController | null
}

type LocalWorkspaceAuthorityHotData = {
  changeSubscriptionState?: LocalWorkspaceAuthorityChangeSubscriptionState
}

type LocalWorkspaceAuthorityHeadPayload = {
  authorityId?: unknown
  contentHash?: unknown
  document?: unknown
  identity?: unknown
  revision?: unknown
  updatedAt?: unknown
  version?: unknown
}

export class LocalWorkspaceAuthorityClientError extends Error {
  override name = 'LocalWorkspaceAuthorityClientError'

  constructor(
    readonly code: string,
    message: string,
    readonly currentRevision?: number
  ) {
    super(message)
  }
}

let latestStatus: LocalWorkspaceAuthorityStatus | null = null
const localWorkspaceAuthorityHotData = import.meta.hot?.data as
  | LocalWorkspaceAuthorityHotData
  | undefined
const changeSubscriptionState = localWorkspaceAuthorityHotData?.changeSubscriptionState ?? {
  controller: null
}
if (localWorkspaceAuthorityHotData) {
  // EditorView stays mounted across Vite updates, so its long poll must survive
  // the client module replacement as well. The returned disposer still owns
  // normal teardown and a later subscription replaces this one explicitly.
  localWorkspaceAuthorityHotData.changeSubscriptionState = changeSubscriptionState
}

function isWorkspaceIdentity(value: unknown): value is OpenPencilWorkspaceIdentity {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<OpenPencilWorkspaceIdentity>
  return Boolean(
    candidate.schemaVersion === 1 &&
    candidate.documentName === 'OpenPencil Workspace' &&
    typeof candidate.workspaceId === 'string' &&
    typeof candidate.documentId === 'string' &&
    typeof candidate.roomId === 'string'
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isNavigationRegion(value: unknown): value is LocalWorkspaceNavigationRegion {
  if (!isRecord(value)) return false
  const candidate = value as Partial<LocalWorkspaceNavigationRegion>
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

function hasNavigationIntentStrings(candidate: Partial<LocalWorkspaceNavigationIntent>): boolean {
  return (
    typeof candidate.authorityId === 'string' &&
    typeof candidate.contentDocumentId === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.intentId === 'string' &&
    typeof candidate.pageId === 'string' &&
    typeof candidate.workspaceId === 'string'
  )
}

function parseNavigationIntent(value: unknown): LocalWorkspaceNavigationIntent | null {
  if (value === null) return null
  if (!isRecord(value)) {
    throw new TypeError('Local workspace authority returned an invalid navigation intent')
  }
  const candidate = value as Partial<LocalWorkspaceNavigationIntent>
  if (
    candidate.version !== 1 ||
    !hasNavigationIntentStrings(candidate) ||
    (candidate.consumedAt !== null && typeof candidate.consumedAt !== 'string') ||
    !isNavigationObjectIds(candidate.objectIds) ||
    (candidate.region !== undefined && !isNavigationRegion(candidate.region)) ||
    (candidate.runtimeInstanceId !== undefined &&
      typeof candidate.runtimeInstanceId !== 'string') ||
    typeof candidate.sequence !== 'number' ||
    !Number.isInteger(candidate.sequence) ||
    candidate.sequence < 1
  ) {
    throw new TypeError('Local workspace authority returned an invalid navigation intent')
  }
  return candidate as LocalWorkspaceNavigationIntent
}

function parseStatus(value: unknown): LocalWorkspaceAuthorityStatus {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Local workspace authority returned an invalid status')
  }
  const candidate = value as Partial<LocalWorkspaceAuthorityStatus>
  if (
    candidate.version !== 1 ||
    typeof candidate.authorityId !== 'string' ||
    !isWorkspaceIdentity(candidate.identity) ||
    typeof candidate.revision !== 'number' ||
    (candidate.seedWorkspaceId !== null && typeof candidate.seedWorkspaceId !== 'string') ||
    (candidate.state !== 'configured' && candidate.state !== 'ready')
  ) {
    throw new TypeError('Local workspace authority returned an invalid status')
  }
  return candidate as LocalWorkspaceAuthorityStatus
}

function parseAuthorityChange(value: unknown): LocalWorkspaceAuthorityChange {
  if (!isRecord(value) || typeof value.changed !== 'boolean') {
    throw new TypeError('Local workspace authority returned an invalid change')
  }
  if (
    !value.changed &&
    typeof value.revision === 'number' &&
    (value.navigationSequence === undefined ||
      (typeof value.navigationSequence === 'number' &&
        Number.isInteger(value.navigationSequence) &&
        value.navigationSequence >= 0)) &&
    (value.themeSequence === undefined ||
      (typeof value.themeSequence === 'number' &&
        Number.isInteger(value.themeSequence) &&
        value.themeSequence >= 0))
  ) {
    return {
      changed: false,
      ...(typeof value.navigationSequence === 'number'
        ? { navigationSequence: value.navigationSequence }
        : {}),
      revision: value.revision,
      ...(typeof value.themeSequence === 'number' ? { themeSequence: value.themeSequence } : {})
    }
  }
  if (
    value.changed &&
    typeof value.authorityId === 'string' &&
    typeof value.contentHash === 'string' &&
    typeof value.revision === 'number' &&
    typeof value.workspaceId === 'string'
  ) {
    return value as LocalWorkspaceAuthorityChange
  }
  throw new TypeError('Local workspace authority returned an invalid change')
}

export function parseLocalWorkspaceAuthorityReceipt(
  value: unknown
): LocalWorkspaceAuthorityReceipt {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Local workspace authority returned an invalid commit receipt')
  }
  const candidate = value as Partial<LocalWorkspaceAuthorityReceipt>
  if (
    typeof candidate.appliedRevision !== 'number' ||
    typeof candidate.authorityId !== 'string' ||
    typeof candidate.baseRevision !== 'number' ||
    typeof candidate.contentHash !== 'string' ||
    typeof candidate.committedAt !== 'string' ||
    typeof candidate.requestId !== 'string' ||
    (candidate.status !== 'committed' &&
      candidate.status !== 'initialized' &&
      candidate.status !== 'unchanged') ||
    typeof candidate.workspaceId !== 'string'
  ) {
    throw new TypeError('Local workspace authority returned an invalid commit receipt')
  }
  return candidate as LocalWorkspaceAuthorityReceipt
}

async function authorityToken(): Promise<string> {
  const token = DEV_LOCAL_AUTHORITY_AUTH_TOKEN
  if (!token) {
    throw new LocalWorkspaceAuthorityClientError(
      'authority_auth_unavailable',
      'Local workspace authority authentication is unavailable'
    )
  }
  return token
}

export type LocalWorkspacePresenceInput = {
  contentDocumentId: string
  pageId: string
  pageName: string
  selectedIds: string[]
  viewport?: { panX: number; panY: number; zoom: number }
  workspaceId: string
}

export async function publishLocalWorkspacePresence(
  input: LocalWorkspacePresenceInput
): Promise<void> {
  const selectedIds = [...new Set(input.selectedIds)]
  const selectionLimit = 24
  await authorityRequest('/presence', {
    body: {
      ...input,
      selectedIds: selectedIds.slice(0, selectionLimit),
      selectionTruncated: selectedIds.length > selectionLimit
    },
    method: 'POST'
  })
}

export async function localWorkspaceAuthorityFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${await authorityToken()}`)
  return fetch(`${AUTHORITY_ORIGIN}${path}`, { ...init, headers })
}

async function authorityRequest(
  path: string,
  options: AuthorityRequestOptions = {}
): Promise<unknown> {
  const token = await authorityToken()
  const response = await localWorkspaceAuthorityFetch(`/local-workspace/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    ...(options.body === undefined
      ? {}
      : { body: stringifyLocalWorkspaceAuthorityValue(options.body) }),
    signal: options.signal ?? AbortSignal.timeout(10_000)
  })
  const payload = (await response
    .json()
    .catch(() => null)) as LocalWorkspaceAuthorityErrorBody | null
  if (!response.ok) {
    throw new LocalWorkspaceAuthorityClientError(
      payload?.code ?? `authority_http_${response.status}`,
      payload?.error ?? `Local workspace authority request failed (${response.status})`,
      payload?.currentRevision
    )
  }
  return payload
}

async function authorityRpcRequest(
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const payload = await authorityRequest('/rpc', { body, method: 'POST' })
  if (!isRecord(payload) || payload.ok !== true) {
    throw new TypeError('Local workspace authority returned an invalid RPC response')
  }
  return payload
}

export async function refreshLocalWorkspaceAuthorityStatus(): Promise<LocalWorkspaceAuthorityStatus | null> {
  if (!IS_BROWSER) return null
  for (let attempt = 0; attempt < AUTHORITY_BOOT_RETRIES; attempt += 1) {
    try {
      latestStatus = parseStatus(await authorityRequest('/status'))
      return latestStatus
    } catch (error) {
      if (attempt === AUTHORITY_BOOT_RETRIES - 1) {
        console.warn(
          '[Local workspace authority] Backend unavailable:',
          error instanceof Error ? error.message : error
        )
        return null
      }
      await promiseTimeout(AUTHORITY_BOOT_RETRY_MS)
    }
  }
  return null
}

export function currentLocalWorkspaceAuthorityStatus(): LocalWorkspaceAuthorityStatus | null {
  return latestStatus
}

async function applyReceiptToLatestStatus(receipt: LocalWorkspaceAuthorityReceipt): Promise<void> {
  const status = latestStatus ?? (await refreshLocalWorkspaceAuthorityStatus())
  if (!status) return
  latestStatus = {
    ...status,
    contentHash: receipt.contentHash,
    revision: receipt.appliedRevision,
    state: 'ready',
    updatedAt: receipt.committedAt
  }
}

export function subscribeLocalWorkspaceAuthorityChanges(
  listeners: LocalWorkspaceAuthorityChangeListeners
): () => void {
  if (!IS_BROWSER) return () => undefined
  changeSubscriptionState.controller?.abort()
  const controller = new AbortController()
  changeSubscriptionState.controller = controller
  let observedNavigationSequence = 0
  let observedThemeSequence = 0
  let observedRevision = latestStatus?.revision ?? 0

  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(AUTHORITY_CHANGE_REQUEST_TIMEOUT_MS)
        ])
        const change = parseAuthorityChange(
          await authorityRequest(
            `/changes?after_revision=${String(observedRevision)}&after_navigation_sequence=${String(observedNavigationSequence)}&after_theme_sequence=${String(observedThemeSequence)}&timeout_ms=${String(AUTHORITY_CHANGE_WAIT_MS)}`,
            { signal }
          )
        )
        const navigationSequence = change.changed ? undefined : change.navigationSequence
        const themeSequence = change.changed ? undefined : change.themeSequence
        if (navigationSequence !== undefined && navigationSequence > observedNavigationSequence) {
          observedNavigationSequence = navigationSequence
          listeners.onNavigationQueued()
        }
        if (themeSequence !== undefined && themeSequence > observedThemeSequence) {
          observedThemeSequence = themeSequence
          listeners.onThemeQueued()
        }
        if (change.changed) {
          observedRevision = Math.max(observedRevision, change.revision)
        }
        listeners.onHeadCommitted()
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TimeoutError')
        ) {
          continue
        }
        console.warn(
          '[Local workspace authority] Head subscription interrupted:',
          error instanceof Error ? error.message : error
        )
        await promiseTimeout(AUTHORITY_CHANGE_RETRY_MS)
      }
    }
  }
  void run()
  return () => {
    controller.abort()
    if (changeSubscriptionState.controller === controller) {
      changeSubscriptionState.controller = null
    }
  }
}

export async function readLocalWorkspaceAuthorityHead(): Promise<LocalWorkspaceAuthorityHead | null> {
  const status = latestStatus ?? (await refreshLocalWorkspaceAuthorityStatus())
  if (status?.state !== 'ready') return null
  const value = await authorityRequest('/head')
  if (!value || typeof value !== 'object') {
    throw new TypeError('Local workspace authority returned an invalid head')
  }
  const candidate = value as LocalWorkspaceAuthorityHeadPayload
  if (
    candidate.version !== 1 ||
    typeof candidate.authorityId !== 'string' ||
    typeof candidate.contentHash !== 'string' ||
    !isWorkspaceIdentity(candidate.identity) ||
    typeof candidate.revision !== 'number' ||
    typeof candidate.updatedAt !== 'string' ||
    !Object.hasOwn(candidate, 'document')
  ) {
    throw new TypeError('Local workspace authority returned an invalid head')
  }
  latestStatus = {
    ...status,
    contentHash: candidate.contentHash,
    identity: candidate.identity,
    revision: candidate.revision,
    state: 'ready',
    updatedAt: candidate.updatedAt
  }
  return {
    authorityId: candidate.authorityId,
    contentHash: candidate.contentHash,
    document: decodeLocalWorkspaceDocument(candidate.document) as CachedSmylrProductionDocument,
    identity: candidate.identity,
    revision: candidate.revision,
    updatedAt: candidate.updatedAt,
    version: 1
  }
}

export async function revertLocalWorkspaceBoardTransaction(input: {
  head: LocalWorkspaceAuthorityHead
  pageId: string
  requestId: string
  transactionId: string
}): Promise<void> {
  const runtimeInstanceId = `local-authority:${input.head.authorityId}`
  const target = {
    content_document_id: input.head.identity.documentId,
    document_id: input.head.identity.documentId,
    page_id: input.pageId,
    runtime_instance_id: runtimeInstanceId,
    workspace_id: input.head.identity.workspaceId
  }
  const contextEnvelope = await authorityRpcRequest({
    args: { ...target, target: 'known' },
    command: 'board_context'
  })
  const contextResult = isRecord(contextEnvelope.result) ? contextEnvelope.result : null
  const boardBuildBase =
    contextResult && isRecord(contextResult.board_build_base)
      ? contextResult.board_build_base
      : null
  if (!boardBuildBase) {
    throw new TypeError('Local workspace authority returned no Board build context for Undo')
  }

  const buildEnvelope = await authorityRpcRequest({
    args: {
      ...boardBuildBase,
      intent: 'Undo persisted agent Board transaction',
      plan: {
        artifacts: [],
        contract: 'board-build-plan/v1',
        operations: [{ kind: 'transaction.revert', transaction_id: input.transactionId }]
      },
      request_id: input.requestId
    },
    command: 'board_build'
  })
  const buildResult = isRecord(buildEnvelope.result) ? buildEnvelope.result : null
  const persistence =
    buildResult && isRecord(buildResult.persistence) ? buildResult.persistence : null
  if (persistence?.status !== 'durable') {
    throw new Error('Persisted Board transaction Undo was not durably acknowledged')
  }
}

export async function readLocalWorkspaceNavigationIntent(): Promise<LocalWorkspaceNavigationIntent | null> {
  if (!IS_BROWSER) return null
  const payload = await authorityRequest('/navigation')
  if (!isRecord(payload) || !Object.hasOwn(payload, 'intent')) {
    throw new TypeError('Local workspace authority returned an invalid navigation response')
  }
  return parseNavigationIntent(payload.intent)
}

export async function consumeLocalWorkspaceNavigationIntent(intentId: string): Promise<boolean> {
  if (!IS_BROWSER) return false
  const payload = await authorityRequest('/navigation/consume', {
    method: 'POST',
    body: { intentId }
  })
  if (!isRecord(payload) || typeof payload.consumed !== 'boolean') {
    throw new TypeError('Local workspace authority returned an invalid navigation receipt')
  }
  return payload.consumed
}

function parseThemeIntent(value: unknown): LocalWorkspaceThemeIntent | null {
  if (value === null) return null
  if (!isRecord(value)) {
    throw new TypeError('Local workspace authority returned an invalid theme intent')
  }
  const candidate = value as Partial<LocalWorkspaceThemeIntent>
  if (
    candidate.version !== 1 ||
    (candidate.consumedAt !== null && typeof candidate.consumedAt !== 'string') ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.sequence !== 'number' ||
    !Number.isInteger(candidate.sequence) ||
    candidate.sequence < 1 ||
    (candidate.theme !== 'auto' && candidate.theme !== 'dark' && candidate.theme !== 'light') ||
    typeof candidate.updatedAt !== 'string'
  ) {
    throw new TypeError('Local workspace authority returned an invalid theme intent')
  }
  return candidate as LocalWorkspaceThemeIntent
}

export async function readLocalWorkspaceThemeIntent(): Promise<LocalWorkspaceThemeIntent | null> {
  if (!IS_BROWSER) return null
  const payload = await authorityRequest('/theme')
  if (!isRecord(payload) || !Object.hasOwn(payload, 'theme')) {
    throw new TypeError('Local workspace authority returned an invalid theme response')
  }
  return parseThemeIntent(payload.theme)
}

export async function consumeLocalWorkspaceThemeIntent(sequence: number): Promise<boolean> {
  if (!IS_BROWSER) return false
  const payload = await authorityRequest('/theme/consume', {
    method: 'POST',
    body: { sequence }
  })
  if (!isRecord(payload) || typeof payload.consumed !== 'boolean') {
    throw new TypeError('Local workspace authority returned an invalid theme receipt')
  }
  return payload.consumed
}

export async function persistLocalWorkspaceTraceSession(input: {
  gestures: unknown[]
  session: unknown
  spokenTurns?: unknown[]
  summary: unknown
}): Promise<void> {
  if (!IS_BROWSER) return
  const payload = await authorityRequest('/trace/sessions', {
    method: 'POST',
    body: input
  })
  if (!isRecord(payload) || typeof payload.gestureCount !== 'number') {
    throw new TypeError('Local workspace authority returned an invalid Trace session receipt')
  }
}

export async function persistLocalWorkspaceTraceSpokenTurns(spokenTurns: unknown[]): Promise<void> {
  if (!IS_BROWSER) return
  const payload = await authorityRequest('/trace/spoken-turns', {
    method: 'POST',
    body: { spokenTurns }
  })
  if (!isRecord(payload) || typeof payload.spokenTurnCount !== 'number') {
    throw new TypeError('Local workspace authority returned an invalid spoken turn receipt')
  }
}

export async function readLocalWorkspaceTraceSessionSummaries(): Promise<unknown[]> {
  if (!IS_BROWSER) return []
  const payload = await authorityRequest('/trace/sessions')
  if (!isRecord(payload) || !Array.isArray(payload.summaries)) {
    throw new TypeError('Local workspace authority returned invalid Trace summaries')
  }
  return payload.summaries
}

export async function readLocalWorkspaceTraceSession(sessionId: string): Promise<unknown> {
  if (!IS_BROWSER) return null
  try {
    const payload = await authorityRequest(`/trace/sessions/${encodeURIComponent(sessionId)}`)
    if (!isRecord(payload) || !Object.hasOwn(payload, 'session')) {
      throw new TypeError('Local workspace authority returned an invalid Trace session')
    }
    return payload.session
  } catch (error) {
    if (
      error instanceof LocalWorkspaceAuthorityClientError &&
      error.code === 'trace_session_not_found'
    ) {
      return null
    }
    throw error
  }
}

export async function deleteLocalWorkspaceTraceSession(sessionId: string): Promise<boolean> {
  if (!IS_BROWSER) return false
  const payload = await authorityRequest(`/trace/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  })
  if (!isRecord(payload) || typeof payload.deleted !== 'boolean') {
    throw new TypeError('Local workspace authority returned an invalid Trace deletion receipt')
  }
  return payload.deleted
}

export async function persistLocalWorkspaceTraceEvidence(input: {
  evidenceBase64: string
  evidenceId: string
  mimeType: 'image/png'
  sessionId: string
}): Promise<void> {
  if (!IS_BROWSER) return
  const payload = await authorityRequest('/trace/evidence', { body: input, method: 'POST' })
  if (!isRecord(payload) || payload.persisted !== true) {
    throw new TypeError('Local workspace authority returned an invalid Trace evidence receipt')
  }
}

export async function readLocalWorkspaceTraceEvidence(evidenceId: string): Promise<{
  evidenceBase64: string
  mimeType: 'image/png'
} | null> {
  if (!IS_BROWSER) return null
  try {
    const payload = await authorityRequest(`/trace/evidence/${encodeURIComponent(evidenceId)}`)
    if (
      !isRecord(payload) ||
      typeof payload.evidenceBase64 !== 'string' ||
      payload.mimeType !== 'image/png'
    ) {
      throw new TypeError('Local workspace authority returned invalid Trace evidence')
    }
    return { evidenceBase64: payload.evidenceBase64, mimeType: payload.mimeType }
  } catch (error) {
    if (
      error instanceof LocalWorkspaceAuthorityClientError &&
      error.code === 'trace_evidence_not_found'
    ) {
      return null
    }
    throw error
  }
}

export async function initializeLocalWorkspaceAuthority(
  sourceWorkspaceId: string,
  document: CachedSmylrProductionDocument,
  requestId: string
): Promise<LocalWorkspaceAuthorityReceipt> {
  const receipt = parseLocalWorkspaceAuthorityReceipt(
    await authorityRequest('/initialize', {
      method: 'POST',
      body: {
        document,
        requestId,
        sourceWorkspaceId
      }
    })
  )
  await applyReceiptToLatestStatus(receipt)
  return receipt
}

export async function commitLocalWorkspaceAuthority(
  workspaceId: string,
  expectedRevision: number,
  expectedContentHash: string,
  document: CachedSmylrProductionDocument,
  requestId: string,
  transaction?: AutomationPersistenceTransaction
): Promise<LocalWorkspaceAuthorityReceipt> {
  const receipt = parseLocalWorkspaceAuthorityReceipt(
    await authorityRequest('/commit', {
      method: 'POST',
      body: {
        document,
        expectedContentHash,
        expectedRevision,
        requestId,
        ...(transaction ? { transaction } : {}),
        workspaceId
      }
    })
  )
  await applyReceiptToLatestStatus(receipt)
  return receipt
}

export async function preserveLocalWorkspaceAuthorityRecovery(options: {
  authorityId: string
  baseRevision: number
  document: CachedSmylrProductionDocument
  reason: string
  requestId: string
  workspaceId: string
}): Promise<void> {
  const recovery: PreservedLocalWorkspaceRecovery = {
    authorityId: options.authorityId,
    baseRevision: options.baseRevision,
    document: encodeLocalWorkspaceDocument(options.document),
    preservedAt: new Date().toISOString(),
    reason: options.reason,
    requestId: options.requestId,
    workspaceId: options.workspaceId
  }
  await writeCacheValue(
    `${RECOVERY_CACHE_PREFIX}/${encodeURIComponent(options.workspaceId)}/${options.requestId}`,
    recovery
  )
}
