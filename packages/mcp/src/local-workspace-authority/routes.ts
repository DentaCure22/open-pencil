import { Buffer } from 'node:buffer'

import type { Context, Hono, Next } from 'hono'

import { bearerToken, isAuthorized } from '#mcp/auth'

import { LocalWorkspaceAuthorityStoreError, type LocalWorkspaceAuthorityStore } from './store'
import type {
  CommitLocalWorkspaceRequest,
  InitializeLocalWorkspaceRequest,
  LocalWorkspaceAuthorityStatus,
  LocalWorkspaceCommitReceipt,
  LocalWorkspaceCommitTransaction
} from './types'

const AUTHORITY_ROUTE = '/local-workspace/v1'
const DEFAULT_HEAD_CHANGE_WAIT_MS = 25_000
const HEAD_CHANGE_POLL_MS = 100
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
  transaction?: unknown
  workspaceId?: unknown
}

type HeadChange = {
  authorityId: string
  changed: true
  contentHash: string
  revision: number
  workspaceId: string
}

type HeadChangeWaitResult = HeadChange | { changed: false; revision: number }

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

async function waitForHeadChange(
  store: LocalWorkspaceAuthorityStore,
  afterRevision: number,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HeadChangeWaitResult> {
  let finish: (result: HeadChangeWaitResult) => void = () => undefined
  let settled = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let polling = false
  let observedMarker = await store.externalStateMarker()
  let unsubscribe: () => void = () => undefined
  let abort: () => void = () => undefined
  const result = new Promise<HeadChangeWaitResult>((resolve) => {
    finish = (value) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (poll) clearInterval(poll)
      unsubscribe()
      signal.removeEventListener('abort', abort)
      resolve(value)
    }
  })
  abort = () => finish({ changed: false, revision: afterRevision })
  unsubscribe = store.subscribeHeadCommitted((receipt) => {
    if (receipt.appliedRevision > afterRevision) finish(receiptHeadChange(receipt))
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

function commitTransaction(value: unknown): LocalWorkspaceCommitTransaction | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Commit transaction requires pageId, requestId, and a supported route')
  }
  const candidate = value as Partial<LocalWorkspaceCommitTransaction>
  if (
    typeof candidate.pageId !== 'string' ||
    !candidate.pageId ||
    typeof candidate.requestId !== 'string' ||
    !candidate.requestId ||
    candidate.route !== 'board_build:plan/v1'
  ) {
    throw new TypeError('Commit transaction requires pageId, requestId, and a supported route')
  }
  return {
    pageId: candidate.pageId,
    requestId: candidate.requestId,
    route: candidate.route
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
  const transaction = commitTransaction(body.transaction)
  return {
    document: body.document,
    expectedContentHash: body.expectedContentHash,
    expectedRevision: body.expectedRevision,
    requestId: body.requestId,
    ...(transaction ? { transaction } : {}),
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
          { code: 'workspace_not_initialized', error: 'Local workspace has no saved head yet' },
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
      const timeoutMs = integerQuery(
        c,
        'timeout_ms',
        DEFAULT_HEAD_CHANGE_WAIT_MS,
        MAX_HEAD_CHANGE_WAIT_MS
      )
      return c.json(
        await waitForHeadChange(options.store, afterRevision, timeoutMs, c.req.raw.signal)
      )
    } catch (error) {
      if (error instanceof TypeError && !(error instanceof LocalWorkspaceAuthorityStoreError)) {
        return c.json({ code: 'invalid_request', error: error.message }, 400)
      }
      return errorResponse(c, error)
    }
  })

  const sendRpc = options.sendRpc
  if (sendRpc) {
    app.post(`${AUTHORITY_ROUTE}/rpc`, async (c) => {
      try {
        const body = await parseBody(c)
        return c.json(await sendRpc(body))
      } catch (error) {
        if (error instanceof TypeError && !(error instanceof LocalWorkspaceAuthorityStoreError)) {
          return c.json({ code: 'invalid_request', error: error.message }, 400)
        }
        return errorResponse(c, error)
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

  app.post(`${AUTHORITY_ROUTE}/navigation/consume`, async (c) => {
    try {
      return c.json({
        consumed: await options.store.consumeNavigationIntent(
          navigationIntentId(await parseBody(c))
        )
      })
    } catch (error) {
      if (error instanceof TypeError && !(error instanceof LocalWorkspaceAuthorityStoreError)) {
        return c.json({ code: 'invalid_request', error: error.message }, 400)
      }
      return errorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/trace/sessions`, async (c) => {
    try {
      return c.json({ summaries: await options.store.traceSessionSummaries() })
    } catch (error) {
      return errorResponse(c, error)
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
      if (error instanceof TypeError && !(error instanceof LocalWorkspaceAuthorityStoreError)) {
        return c.json({ code: 'invalid_request', error: error.message }, 400)
      }
      return errorResponse(c, error)
    }
  })

  app.delete(`${AUTHORITY_ROUTE}/trace/sessions/:sessionId`, async (c) => {
    try {
      return c.json({ deleted: await options.store.deleteTraceSession(c.req.param('sessionId')) })
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
      if (error instanceof TypeError && !(error instanceof LocalWorkspaceAuthorityStoreError)) {
        return c.json({ code: 'invalid_request', error: error.message }, 400)
      }
      return errorResponse(c, error)
    }
  })

  app.get(`${AUTHORITY_ROUTE}/trace/evidence/:evidenceId`, async (c) => {
    try {
      const evidence = await options.store.traceEvidence(c.req.param('evidenceId'))
      if (!evidence) {
        return c.json({ code: 'trace_evidence_not_found', error: 'Trace evidence not found' }, 404)
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
      if (error instanceof TypeError && !(error instanceof LocalWorkspaceAuthorityStoreError)) {
        return c.json({ code: 'invalid_request', error: error.message }, 400)
      }
      return errorResponse(c, error)
    }
  })

  app.post(`${AUTHORITY_ROUTE}/commit`, async (c) => {
    try {
      return c.json(await options.store.commit(commitRequest(await parseBody(c))))
    } catch (error) {
      if (error instanceof TypeError && !(error instanceof LocalWorkspaceAuthorityStoreError)) {
        return c.json({ code: 'invalid_request', error: error.message }, 400)
      }
      return errorResponse(c, error)
    }
  })
}
