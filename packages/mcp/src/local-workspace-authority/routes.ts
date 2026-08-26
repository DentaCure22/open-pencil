import { Buffer } from 'node:buffer'

import type { Context, Hono, Next } from 'hono'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import { bearerToken, isAuthorized } from '#mcp/auth'

import { LocalWorkspaceAuthorityStoreError, type LocalWorkspaceAuthorityStore } from './store'
import {
  LOCAL_WORKSPACE_PRESENCE_SELECTION_LIMIT,
  type CommitLocalWorkspaceRequest,
  type CompleteLocalWorkspaceScreenshotRequest,
  type InitializeLocalWorkspaceRequest,
  type LocalWorkspaceAuthorityStatus,
  type LocalWorkspaceCommitReceipt,
  type QueueResolvedLocalWorkspaceNavigationRequest,
  type RecordLocalWorkspacePresenceRequest,
  type RecordLocalWorkspaceThemeRequest
} from './types'

const AUTHORITY_ROUTE = '/local-workspace/v1'
const DEFAULT_HEAD_CHANGE_WAIT_MS = 25_000
const HEAD_CHANGE_POLL_MS = 500
const MAX_HEAD_CHANGE_WAIT_MS = 30_000
const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024

type LocalWorkspaceAuthorityRouteOptions = {
  getAuthToken(): string | null
  sendRpc?: (body: Record<string, unknown>) => Promise<unknown>
  store: LocalWorkspaceAuthorityStore
}

type ErrorStatus = 400 | 401 | 404 | 409 | 413 | 422 | 503
type AuthorityRequestBody = {
  [key: string]: unknown
  document?: unknown
  expectedContentHash?: unknown
  expectedRevision?: unknown
  evidenceBase64?: unknown
  evidenceId?: unknown
  evidenceIds?: unknown
  gesture?: unknown
  gestures?: unknown
  intentId?: unknown
  mimeType?: unknown
  requestId?: unknown
  session?: unknown
  sessionId?: unknown
  sourceWorkspaceId?: unknown
  spokenTurns?: unknown
  summary?: unknown
  theme?: unknown
  workspaceId?: unknown
}

type HeadChange = {
  authorityId: string
  changed: true
  contentHash: string
  revision: number
  workspaceId: string
}

type HeadChangeWaitResult =
  | HeadChange
  | {
      changed: false
      navigationSequence?: number
      revision: number
      screenshotSequence?: number
      themeSequence?: number
    }

function integerQuery(c: Context, name: string, fallback: number, maximum: number): number {
  const raw = c.req.query(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new TypeError(`${name} must be an integer between 0 and ${maximum}`)
  }
  return value
}

function receiptHeadChange(receipt: LocalWorkspaceCommitReceipt): HeadChange {
  return {
    authorityId: receipt.authorityId,
    changed: true,
    contentHash: receipt.contentHash,
    revision: receipt.appliedRevision,
    workspaceId: receipt.workspaceId
  }
}

async function waitForAuthorityChange(
  store: LocalWorkspaceAuthorityStore,
  afterRevision: number,
  afterNavigationSequence: number,
  afterScreenshotSequence: number,
  afterThemeSequence: number,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HeadChangeWaitResult> {
  let finish: (result: HeadChangeWaitResult) => void = () => undefined
  let settled = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let polling = false
  let observedMarker = await store.externalStateMarker()
  let unsubscribeHead: () => void = () => undefined
  let unsubscribeNavigation: () => void = () => undefined
  let unsubscribeScreenshot: () => void = () => undefined
  let unsubscribeTheme: () => void = () => undefined
  let abort: () => void = () => undefined
  const result = new Promise<HeadChangeWaitResult>((resolve) => {
    finish = (value) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (poll) clearInterval(poll)
      unsubscribeHead()
      unsubscribeNavigation()
      unsubscribeScreenshot()
      unsubscribeTheme()
      signal.removeEventListener('abort', abort)
      resolve(value)
    }
  })
  abort = () => finish({ changed: false, revision: afterRevision })
  unsubscribeHead = store.subscribeHeadCommitted((receipt) => {
    if (receipt.appliedRevision > afterRevision) finish(receiptHeadChange(receipt))
  })
  unsubscribeNavigation = store.subscribeNavigationQueued((intent) => {
    if (intent.sequence > afterNavigationSequence) {
      finish({
        changed: false,
        navigationSequence: intent.sequence,
        revision: afterRevision
      })
    }
  })
  unsubscribeScreenshot = store.subscribeScreenshotQueued((intent) => {
    if (intent.sequence > afterScreenshotSequence) {
      finish({
        changed: false,
        revision: afterRevision,
        screenshotSequence: intent.sequence
      })
    }
  })
  unsubscribeTheme = store.subscribeThemeQueued((intent) => {
    if (intent.sequence > afterThemeSequence) {
      finish({
        changed: false,
        revision: afterRevision,
        themeSequence: intent.sequence
      })
    }
  })
  signal.addEventListener('abort', abort, { once: true })
  timeout = setTimeout(() => finish({ changed: false, revision: afterRevision }), timeoutMs)
  timeout.unref()

  async function detectChangedHead(): Promise<void> {
    const status: LocalWorkspaceAuthorityStatus = await store.status()
    if (
      status.state === 'ready' &&
      status.revision > afterRevision &&
      status.contentHash !== null
    ) {
      finish({
        authorityId: status.authorityId,
        changed: true,
        contentHash: status.contentHash,
        revision: status.revision,
        workspaceId: status.identity.workspaceId
      })
    }
  }

  async function detectQueuedNavigation(): Promise<void> {
    const intent = await store.pendingNavigationIntent()
    if (intent && intent.sequence > afterNavigationSequence) {
      finish({
        changed: false,
        navigationSequence: intent.sequence,
        revision: afterRevision
      })
    }
  }

  async function detectQueuedTheme(): Promise<void> {
    const intent = await store.pendingThemeIntent()
    if (intent && intent.sequence > afterThemeSequence) {
      finish({
        changed: false,
        revision: afterRevision,
        themeSequence: intent.sequence
      })
    }
  }

  async function detectQueuedScreenshot(): Promise<void> {
    const intent = await store.pendingScreenshotIntent()
    if (intent && intent.sequence > afterScreenshotSequence) {
      finish({
        changed: false,
        revision: afterRevision,
        screenshotSequence: intent.sequence
      })
    }
  }

  async function pollForExternalCommit(): Promise<void> {
    if (polling || settled) return
    polling = true
    try {
      const marker = await store.externalStateMarker()
      if (marker === observedMarker) return
      observedMarker = marker
      await detectChangedHead()
    } finally {
      polling = false
    }
  }

  poll = setInterval(() => void pollForExternalCommit().catch(() => undefined), HEAD_CHANGE_POLL_MS)
  poll.unref()
  try {
    await detectChangedHead()
    await detectQueuedNavigation()
    await detectQueuedScreenshot()
    await detectQueuedTheme()
    await pollForExternalCommit()
  } catch (error) {
    abort()
    throw error
  }
  return result
}

function navigationIntentId(body: AuthorityRequestBody): string {
  if (typeof body.intentId !== 'string' || !body.intentId.trim()) {
    throw new TypeError('Navigation consumption requires intentId')
  }
  return body.intentId.trim()
}

function screenshotCompletion(body: AuthorityRequestBody): CompleteLocalWorkspaceScreenshotRequest {
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
  if (!requestId) throw new TypeError('Screenshot completion requires requestId')
  const objectIds = optionalStringList(body.objectIds, 'objectIds')
  if (!objectIds) throw new TypeError('Screenshot completion requires objectIds')
  if (body.status === 'failed' || typeof body.error === 'string') {
    return {
      error: typeof body.error === 'string' ? body.error : 'Live Board capture failed.',
      objectIds,
      requestId,
      status: 'failed'
    }
  }
  return {
    base64: typeof body.base64 === 'string' ? body.base64 : undefined,
    bounds: navigationRegion(body.bounds),
    byteLength: typeof body.byteLength === 'number' ? body.byteLength : undefined,
    mimeType: body.mimeType === 'image/png' ? 'image/png' : undefined,
    objectIds,
    pixelHeight: typeof body.pixelHeight === 'number' ? body.pixelHeight : undefined,
    pixelWidth: typeof body.pixelWidth === 'number' ? body.pixelWidth : undefined,
    requestId,
    source: body.source === 'live_board' ? 'live_board' : undefined,
    status: 'completed'
  }
}

function themeSequence(body: AuthorityRequestBody): number {
  if (typeof body.sequence !== 'number' || !Number.isInteger(body.sequence) || body.sequence < 1) {
    throw new TypeError('Theme consumption requires sequence')
  }
  return body.sequence
}

function themeRequest(body: AuthorityRequestBody): RecordLocalWorkspaceThemeRequest {
  if (body.theme !== 'auto' && body.theme !== 'dark' && body.theme !== 'light') {
    throw new TypeError('Theme must be light, dark, or auto.')
  }
  return { theme: body.theme }
}

function optionalStringList(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((id) => typeof id === 'string' && id.trim())
  ) {
    throw new TypeError(`${field} must be a non-empty list of IDs.`)
  }
  return value.map((id) => id.trim())
}

function navigationRegion(value: unknown): Rect | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Navigation region requires finite x, y, and positive width and height.')
  }
  const candidate = value as Partial<Rect>
  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y) ||
    typeof candidate.width !== 'number' ||
    !Number.isFinite(candidate.width) ||
    candidate.width <= 0 ||
    typeof candidate.height !== 'number' ||
    !Number.isFinite(candidate.height) ||
    candidate.height <= 0
  ) {
    throw new TypeError('Navigation region requires finite x, y, and positive width and height.')
  }
  return {
    height: candidate.height,
    width: candidate.width,
    x: candidate.x,
    y: candidate.y
  }
}

function presenceViewport(
  value: unknown
): RecordLocalWorkspacePresenceRequest['viewport'] | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Presence viewport requires finite panX, panY, and zoom')
  }
  const candidate = value as Partial<NonNullable<RecordLocalWorkspacePresenceRequest['viewport']>>
  if (
    typeof candidate.panX !== 'number' ||
    !Number.isFinite(candidate.panX) ||
    typeof candidate.panY !== 'number' ||
    !Number.isFinite(candidate.panY) ||
    typeof candidate.zoom !== 'number' ||
    !Number.isFinite(candidate.zoom)
  ) {
    throw new TypeError('Presence viewport requires finite panX, panY, and zoom')
  }
  return { panX: candidate.panX, panY: candidate.panY, zoom: candidate.zoom }
}

function resolvedNavigationRequest(
  body: AuthorityRequestBody
): QueueResolvedLocalWorkspaceNavigationRequest {
  const region = navigationRegion(body.region)
  const objectIds = optionalStringList(body.objectIds, 'objectIds')
  const request: QueueResolvedLocalWorkspaceNavigationRequest = {
    ...(objectIds ? { objectIds } : {}),
    ...(typeof body.pageId === 'string' && body.pageId.trim()
      ? { pageId: body.pageId.trim() }
      : {}),
    ...(typeof body.pageName === 'string' && body.pageName.trim()
      ? { pageName: body.pageName.trim() }
      : {}),
    ...(typeof body.query === 'string' && body.query.trim() ? { query: body.query.trim() } : {}),
    ...(region ? { region } : {}),
    ...(typeof body.runtimeInstanceId === 'string' && body.runtimeInstanceId.trim()
      ? { runtimeInstanceId: body.runtimeInstanceId.trim() }
      : {})
  }
  return request
}

function presenceRequest(body: AuthorityRequestBody): RecordLocalWorkspacePresenceRequest {
  const field = (name: string): string => {
    const value = body[name]
    if (typeof value !== 'string' || !value.trim()) {
      throw new TypeError(`Presence requires ${name}`)
    }
    return value.trim()
  }
  const viewport = presenceViewport(body.viewport)
  const selectedIds = body.selectedIds ?? []
  if (
    !Array.isArray(selectedIds) ||
    selectedIds.length > LOCAL_WORKSPACE_PRESENCE_SELECTION_LIMIT ||
    !selectedIds.every((id) => typeof id === 'string' && id.trim())
  ) {
    throw new TypeError(
      `Presence selectedIds must contain at most ${String(LOCAL_WORKSPACE_PRESENCE_SELECTION_LIMIT)} non-empty IDs.`
    )
  }
  if (body.selectionTruncated !== undefined && typeof body.selectionTruncated !== 'boolean') {
    throw new TypeError('Presence selectionTruncated must be a boolean.')
  }
  return {
    contentDocumentId: field('contentDocumentId'),
    pageId: field('pageId'),
    pageName: field('pageName'),
    ...(typeof body.runtimeInstanceId === 'string' && body.runtimeInstanceId.trim()
      ? { runtimeInstanceId: body.runtimeInstanceId.trim() }
      : {}),
    selectedIds: selectedIds.map((id) => id.trim()),
    selectionTruncated: body.selectionTruncated ?? false,
    ...(viewport ? { viewport } : {}),
    workspaceId: field('workspaceId')
  }
}

function requiredBodyString(body: AuthorityRequestBody, field: keyof AuthorityRequestBody): string {
  const value = body[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function requestSize(c: Context): number | null {
  const raw = c.req.header('content-length')
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function errorResponse(c: Context, error: unknown) {
  if (error instanceof LocalWorkspaceAuthorityStoreError) {
    const status: ErrorStatus = error.code === 'invalid_document' ? 422 : 409
    return c.json(
      {
        code: error.code,
        error: error.message,
        ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision })
      },
      status
    )
  }
  const message = error instanceof Error ? error.message : String(error)
  return c.json({ code: 'authority_error', error: message }, 500)
}

function requestErrorResponse(c: Context, error: unknown) {
  if (error instanceof TypeError && !(error instanceof LocalWorkspaceAuthorityStoreError)) {
    return c.json({ code: 'invalid_request', error: error.message }, 400)
  }
  return errorResponse(c, error)
}

async function parseBody(c: Context): Promise<AuthorityRequestBody> {
  const size = requestSize(c)
  if (size !== null && size > MAX_DOCUMENT_BYTES) {
    throw new LocalWorkspaceAuthorityStoreError(
      'invalid_document',
      `Workspace request exceeds ${MAX_DOCUMENT_BYTES} bytes`
    )
  }
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new TypeError('Workspace request body must be a JSON object')
  }
  return body as AuthorityRequestBody
}

function initializeRequest(body: AuthorityRequestBody): InitializeLocalWorkspaceRequest {
  if (
    typeof body.requestId !== 'string' ||
    body.requestId.trim().length === 0 ||
    typeof body.sourceWorkspaceId !== 'string' ||
    body.sourceWorkspaceId.trim().length === 0 ||
    !Object.hasOwn(body, 'document')
  ) {
    throw new TypeError('Initialize requires requestId, sourceWorkspaceId, and a document payload')
  }
  return {
    document: body.document,
    requestId: body.requestId,
    sourceWorkspaceId: body.sourceWorkspaceId
  }
}

function commitRequest(body: AuthorityRequestBody): CommitLocalWorkspaceRequest {
  if (
    typeof body.requestId !== 'string' ||
    body.requestId.trim().length === 0 ||
    typeof body.workspaceId !== 'string' ||
    body.workspaceId.trim().length === 0 ||
    typeof body.expectedContentHash !== 'string' ||
    body.expectedContentHash.trim().length === 0 ||
    typeof body.expectedRevision !== 'number' ||
    !Number.isInteger(body.expectedRevision) ||
    body.expectedRevision < 0 ||
    !Object.hasOwn(body, 'document')
  ) {
    throw new TypeError(
      'Commit requires workspaceId, expectedRevision, expectedContentHash, requestId, and a document payload'
    )
  }
  return {
    document: body.document,
    expectedContentHash: body.expectedContentHash,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    workspaceId: body.workspaceId
  }
}

export function registerLocalWorkspaceAuthorityRoutes(
  app: Hono,
  options: LocalWorkspaceAuthorityRouteOptions
): void {
  app.use(`${AUTHORITY_ROUTE}/*`, async (c: Context, next: Next) => {
    const expected = options.getAuthToken()
    if (!expected) {
      return c.json(
        {
          code: 'authority_auth_unavailable',
          error: 'Local authority authentication is unavailable'
        },
        503
      )
    }
    const provided = bearerToken(c.req.header('authorization'))
    if (!isAuthorized(provided, expected)) {
      return c.json({ code: 'unauthorized', error: 'Unauthorized' }, 401)
    }
    const size = requestSize(c)
    if (size !== null && size > MAX_DOCUMENT_BYTES) {
      return c.json({ code: 'request_too_large', error: 'Workspace request is too large' }, 413)
    }
    return next()
  })

  app.get(`${AUTHORITY_ROUTE}/status`, async (c) => {
    try {
      return c.json(await options.store.status())
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/head`, async (c) => {
    try {
      const head = await options.store.head()
      if (!head) {
        return c.json(
          {
            code: 'workspace_not_initialized',
            error: 'Local workspace has no saved head yet'
          },
          404
        )
      }
      return c.json(head)
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/changes`, async (c) => {
    try {
      const afterRevision = integerQuery(c, 'after_revision', 0, Number.MAX_SAFE_INTEGER)
      const afterNavigationSequence = integerQuery(
        c,
        'after_navigation_sequence',
        0,
        Number.MAX_SAFE_INTEGER
      )
      const afterScreenshotSequence = integerQuery(
        c,
        'after_screenshot_sequence',
        0,
        Number.MAX_SAFE_INTEGER
      )
      const afterThemeSequence = integerQuery(c, 'after_theme_sequence', 0, Number.MAX_SAFE_INTEGER)
      const timeoutMs = integerQuery(
        c,
        'timeout_ms',
        DEFAULT_HEAD_CHANGE_WAIT_MS,
        MAX_HEAD_CHANGE_WAIT_MS
      )
      return c.json(
        await waitForAuthorityChange(
          options.store,
          afterRevision,
          afterNavigationSequence,
          afterScreenshotSequence,
          afterThemeSequence,
          timeoutMs,
          c.req.raw.signal
        )
      )
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  const sendRpc = options.sendRpc
  if (sendRpc) {
    app.post(`${AUTHORITY_ROUTE}/rpc`, async (c) => {
      try {
        const body = await parseBody(c)
        return c.json(await sendRpc(body))
      } catch (error) {
        return requestErrorResponse(c, error)
      }
    })
  }

  app.get(`${AUTHORITY_ROUTE}/navigation`, async (c) => {
    try {
      return c.json({ intent: await options.store.pendingNavigationIntent() })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/navigation`, async (c) => {
    try {
      return c.json({
        intent: await options.store.queueResolvedNavigationIntent(
          resolvedNavigationRequest(await parseBody(c))
        )
      })
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/presence`, async (c) => {
    try {
      return c.json({ presence: await options.store.readPresence() })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/screenshot`, async (c) => {
    try {
      return c.json({ intent: await options.store.pendingScreenshotIntent() })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/screenshot/complete`, async (c) => {
    try {
      return c.json({
        result: await options.store.completeScreenshot(screenshotCompletion(await parseBody(c)))
      })
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/presence`, async (c) => {
    try {
      return c.json({
        presence: await options.store.recordPresence(presenceRequest(await parseBody(c)))
      })
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/navigation/consume`, async (c) => {
    try {
      return c.json({
        consumed: await options.store.consumeNavigationIntent(
          navigationIntentId(await parseBody(c))
        )
      })
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/theme`, async (c) => {
    try {
      return c.json({ theme: await options.store.readTheme() })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/theme`, async (c) => {
    try {
      return c.json({
        theme: await options.store.recordTheme(themeRequest(await parseBody(c)))
      })
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/theme/consume`, async (c) => {
    try {
      return c.json({
        consumed: await options.store.consumeThemeIntent(themeSequence(await parseBody(c)))
      })
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/trace/sessions`, async (c) => {
    try {
      return c.json({ summaries: await options.store.traceSessionSummaries() })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/trace/activity`, async (c) => {
    try {
      const limit = integerQuery(c, 'limit', 80, 80)
      if (limit < 1) throw new TypeError('limit must be an integer between 1 and 80')
      const before = c.req.query('before')
      return c.json(
        await options.store.traceActivityPage({
          ...(before ? { before } : {}),
          limit
        })
      )
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/trace/sessions/:sessionId`, async (c) => {
    try {
      const session = await options.store.traceSession(c.req.param('sessionId'))
      if (!session) {
        return c.json({ code: 'trace_session_not_found', error: 'Trace session not found' }, 404)
      }
      return c.json({ session })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/trace/sessions`, async (c) => {
    try {
      const body = await parseBody(c)
      if (
        !Object.hasOwn(body, 'session') ||
        !Object.hasOwn(body, 'summary') ||
        !Object.hasOwn(body, 'gestures')
      ) {
        throw new TypeError('Trace persistence requires session, summary, and gestures payloads')
      }
      return c.json(
        await options.store.recordTraceSession({
          gestures: body.gestures,
          session: body.session,
          spokenTurns: body.spokenTurns,
          summary: body.summary
        })
      )
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/trace/spoken-turns`, async (c) => {
    try {
      const body = await parseBody(c)
      return c.json(
        await options.store.recordTraceSpokenTurns({
          spokenTurns: body.spokenTurns
        })
      )
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.delete(`${AUTHORITY_ROUTE}/trace/sessions/:sessionId`, async (c) => {
    try {
      return c.json({
        deleted: await options.store.deleteTraceSession(c.req.param('sessionId'))
      })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/trace/evidence`, async (c) => {
    try {
      const body = await parseBody(c)
      const evidenceBase64 = requiredBodyString(body, 'evidenceBase64')
      await options.store.recordTraceEvidence({
        bytes: Buffer.from(evidenceBase64, 'base64'),
        evidenceId: requiredBodyString(body, 'evidenceId'),
        mimeType: requiredBodyString(body, 'mimeType'),
        sessionId: requiredBodyString(body, 'sessionId')
      })
      return c.json({ persisted: true })
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/trace/evidence-overview`, async (c) => {
    try {
      const body = await parseBody(c)
      if (
        !Array.isArray(body.evidenceIds) ||
        body.evidenceIds.length > 100 ||
        !body.evidenceIds.every((evidenceId) => typeof evidenceId === 'string' && evidenceId.trim())
      ) {
        throw new TypeError('Trace evidence overview requires up to 100 evidence IDs.')
      }
      return c.json(
        await options.store.traceEvidenceOverview(
          body.evidenceIds.map((evidenceId) => evidenceId.trim())
        )
      )
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/trace/evidence/:evidenceId`, async (c) => {
    try {
      const evidence = await options.store.traceEvidence(c.req.param('evidenceId'))
      if (!evidence) {
        return c.json(
          {
            code: 'trace_evidence_not_found',
            error: 'Trace evidence not found'
          },
          404
        )
      }
      return c.json({
        evidenceBase64: Buffer.from(evidence.bytes).toString('base64'),
        mimeType: evidence.mimeType
      })
    } catch (error) {
      return errorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/initialize`, async (c) => {
    try {
      return c.json(await options.store.initialize(initializeRequest(await parseBody(c))))
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/commit`, async (c) => {
    try {
      return c.json(await options.store.commit(commitRequest(await parseBody(c))))
    } catch (error) {
      return requestErrorResponse(c, error)
    }
  })
}
