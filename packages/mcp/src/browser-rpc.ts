import { randomUUID } from 'node:crypto'

import type { WebSocket } from 'ws'

import type { RpcJsonObject } from '#mcp/json'
import type { PendingRequest } from '#mcp/rpc-types'

const RPC_TIMEOUT = 20_000
const SINGLE_RUNTIME_DISCOVERY_COMMANDS = new Set(['board_context', 'list_documents'])
/**
 * A persisted-authority runtime id is a workspace alias, not a live tab. Agents naturally acquire
 * it from persisted board_context and then issue live commands with it; the live command clearly
 * targets "the app showing this workspace", so route it to the live runtime instead of failing.
 */
const PERSISTED_RUNTIME_PREFIX = 'local-authority:'

const APP_NOT_CONNECTED_MESSAGE =
  'OpenPencil app is not connected. STOP and tell the user: "The OpenPencil desktop app is not running, no document is open, or the desktop app is connected to a different MCP server. Please start OpenPencil, open a document, and try again." Do NOT attempt to start the app yourself or retry automatically.'

type BrowserRpcBridgeOptions = {
  authToken: string | null
  onConnectionChange: () => void
}

type BrowserMessage = {
  type: string
  id?: string
  token?: string
  runtime_instance_id?: string
  result?: unknown
  error?: string
  ok?: boolean
  active?: boolean
  navigation_targets?: unknown
  visibility?: string
  write_authority?: string
}

type RuntimeVisibility = 'hidden' | 'unknown' | 'visible'
type RuntimeWriteAuthority = 'unknown' | 'viewer' | 'writer'

type BrowserNavigationTarget = {
  contentDocumentId: string
  workspaceId: string
}

type BrowserNavigationResolution =
  | {
      candidateRuntimeIds: string[]
      reason: 'no_matching_editor' | 'requested_editor_unavailable'
      status: 'needs_editor'
    }
  | {
      candidateRuntimeIds: string[]
      runtimeInstanceId: string
      status: 'ready'
    }
  | {
      candidateRuntimeIds: string[]
      status: 'ambiguous_editor'
    }

type BrowserNavigationRequest = {
  contentDocumentId: string
  requestedRuntimeInstanceId?: string
  workspaceId: string
}

type BrowserRuntime = {
  active: boolean
  runtimeInstanceId: string
  token: string
  navigationTargets: BrowserNavigationTarget[]
  /** Last register/presence heartbeat. Zombie tabs keep their socket open but stop refreshing. */
  updatedAt: number
  visibility: RuntimeVisibility
  writeAuthority: RuntimeWriteAuthority
  ws: WebSocket
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stripEnvelope(msg: BrowserMessage): Record<string, unknown> {
  const { type: _type, id: _id, ...body } = msg
  return body
}

function responsePayload(result: unknown): Record<string, unknown> {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as RpcJsonObject
  }
  return { result }
}

function sendJson(ws: WebSocket, body: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(body))
}

function navigationTargets(value: unknown): BrowserNavigationTarget[] {
  if (!Array.isArray(value)) return []
  const unique = new Map<string, BrowserNavigationTarget>()
  for (const target of value) {
    if (!isRecord(target)) continue
    const contentDocumentId = target.content_document_id
    const workspaceId = target.workspace_id
    if (typeof contentDocumentId !== 'string' || typeof workspaceId !== 'string') continue
    const normalized = {
      contentDocumentId: contentDocumentId.trim(),
      workspaceId: workspaceId.trim()
    }
    if (!normalized.contentDocumentId || !normalized.workspaceId) continue
    unique.set(`${normalized.workspaceId}\u0000${normalized.contentDocumentId}`, normalized)
  }
  return [...unique.values()]
}

function createSettler<T>(resolve: (value: T) => void, reject: (error: Error) => void) {
  let settled = false
  return {
    resolve: (value: T) => {
      if (settled) return
      settled = true
      resolve(value)
    },
    reject: (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    },
    isSettled: () => settled
  }
}

export function createBrowserRpcBridge({ authToken, onConnectionChange }: BrowserRpcBridgeOptions) {
  const pending = new Map<string, PendingRequest>()
  const pendingRoutes = new Map<string, { pinned: boolean; ws: WebSocket }>()
  const clients = new Set<WebSocket>()
  const runtimes = new Map<string, BrowserRuntime>()
  const runtimeBySocket = new WeakMap<WebSocket, string>()
  let browserWs: WebSocket | null = null
  let browserToken: string | null = null
  let browserRuntimeInstanceId: string | null = null
  let browserRegistered = false

  function currentRpcToken(): string | null {
    return authToken ?? browserToken
  }

  function isConnected(): boolean {
    return Boolean(browserWs && browserRegistered)
  }

  function rejectAllPending(reason: string) {
    for (const [id, req] of pending) {
      clearTimeout(req.timer)
      req.reject(new Error(reason))
      pending.delete(id)
      pendingRoutes.delete(id)
    }
  }

  function rejectPendingForSocket(ws: WebSocket, reason: string, unpinnedOnly = false) {
    for (const [id, route] of pendingRoutes) {
      if (route.ws !== ws || (unpinnedOnly && route.pinned)) continue
      const req = pending.get(id)
      if (!req) continue
      clearTimeout(req.timer)
      req.reject(new Error(reason))
      pending.delete(id)
      pendingRoutes.delete(id)
    }
  }

  function sendRegisterToken(ws: WebSocket) {
    const token = currentRpcToken()
    if (token) sendJson(ws, { type: 'register', token })
  }

  function broadcastRegisterToken() {
    for (const client of clients) sendRegisterToken(client)
  }

  function handleConnection(ws: WebSocket) {
    clients.add(ws)
    sendRegisterToken(ws)
  }

  function requestedRuntimeInstanceId(body: Record<string, unknown>): string | undefined {
    const args = body.args
    if (!isRecord(args)) return undefined
    const runtimeInstanceId = args.runtime_instance_id
    return typeof runtimeInstanceId === 'string' && runtimeInstanceId.trim()
      ? runtimeInstanceId.trim()
      : undefined
  }

  function availableRuntimes(): BrowserRuntime[] {
    return [...runtimes.values()].filter((runtime) => runtime.ws.readyState === runtime.ws.OPEN)
  }

  function visibleWriterRuntimes(): BrowserRuntime[] {
    return availableRuntimes().filter(
      (runtime) => runtime.visibility === 'visible' && runtime.writeAuthority === 'writer'
    )
  }

  function resolveNavigationRuntime(
    request: BrowserNavigationRequest
  ): BrowserNavigationResolution {
    const matching = availableRuntimes().filter((runtime) =>
      runtime.navigationTargets.some(
        (target) =>
          target.workspaceId === request.workspaceId &&
          target.contentDocumentId === request.contentDocumentId
      )
    )
    const candidateRuntimeIds = matching
      .map((runtime) => runtime.runtimeInstanceId)
      .sort((left, right) => left.localeCompare(right))

    if (request.requestedRuntimeInstanceId) {
      const requested = matching.find(
        (runtime) => runtime.runtimeInstanceId === request.requestedRuntimeInstanceId
      )
      return requested
        ? {
            candidateRuntimeIds,
            runtimeInstanceId: requested.runtimeInstanceId,
            status: 'ready'
          }
        : { candidateRuntimeIds, reason: 'requested_editor_unavailable', status: 'needs_editor' }
    }
    if (matching.length === 0) {
      return { candidateRuntimeIds, reason: 'no_matching_editor', status: 'needs_editor' }
    }
    if (matching.length === 1) {
      return {
        candidateRuntimeIds,
        runtimeInstanceId: matching[0].runtimeInstanceId,
        status: 'ready'
      }
    }

    const activeVisible = matching.filter(
      (runtime) => runtime.active && runtime.visibility === 'visible'
    )
    if (activeVisible.length === 1) {
      return {
        candidateRuntimeIds,
        runtimeInstanceId: activeVisible[0].runtimeInstanceId,
        status: 'ready'
      }
    }
    const visible = matching.filter((runtime) => runtime.visibility === 'visible')
    if (visible.length === 1) {
      return {
        candidateRuntimeIds,
        runtimeInstanceId: visible[0].runtimeInstanceId,
        status: 'ready'
      }
    }
    return { candidateRuntimeIds, status: 'ambiguous_editor' }
  }

  /**
   * A persisted-authority alias means "the app the user is looking at". When several runtimes are
   * connected (e.g. a zombie tab whose socket never closed), pick the most plausible one instead
   * of erroring: prefer active runtimes, then the freshest heartbeat.
   */
  function singleLiveRuntime(preferVisibleWriter: boolean): BrowserRuntime | null {
    const preferred = preferVisibleWriter ? visibleWriterRuntimes() : availableRuntimes()
    const available = preferred.length > 0 ? preferred : availableRuntimes()
    const activeOnly = available.filter((runtime) => runtime.active)
    const candidates = activeOnly.length > 0 ? activeOnly : available
    return [...candidates].sort((first, second) => second.updatedAt - first.updatedAt)[0] ?? null
  }

  function routePersistedRuntime(
    body: Record<string, unknown>,
    args: Record<PropertyKey, unknown>
  ): { body: Record<string, unknown>; requestedRuntime: string } {
    const workspaceId = args.workspace_id
    const contentDocumentId = args.content_document_id
    const resolution =
      typeof workspaceId === 'string' && typeof contentDocumentId === 'string'
        ? resolveNavigationRuntime({ contentDocumentId, workspaceId })
        : null
    if (resolution && resolution.status !== 'ready') {
      throw new Error(
        resolution.status === 'ambiguous_editor'
          ? `Live Board target is ambiguous across runtimes: ${resolution.candidateRuntimeIds.join(', ')}.`
          : APP_NOT_CONNECTED_MESSAGE
      )
    }
    const runtime = resolution
      ? runtimes.get(resolution.runtimeInstanceId)
      : singleLiveRuntime(true)
    if (!runtime) throw new Error(APP_NOT_CONNECTED_MESSAGE)
    return {
      body: { ...body, args: { ...args, runtime_instance_id: runtime.runtimeInstanceId } },
      requestedRuntime: runtime.runtimeInstanceId
    }
  }

  function routeBody(body: Record<string, unknown>): {
    body: Record<string, unknown>
    requestedRuntime?: string
  } {
    const requestedRuntime = requestedRuntimeInstanceId(body)
    const args = isRecord(body.args) ? body.args : {}

    if (requestedRuntime?.startsWith(PERSISTED_RUNTIME_PREFIX)) {
      return routePersistedRuntime(body, args)
    }
    if (requestedRuntime || !SINGLE_RUNTIME_DISCOVERY_COMMANDS.has(String(body.command))) {
      return { body, ...(requestedRuntime ? { requestedRuntime } : {}) }
    }

    const currentVisible = body.command === 'board_context' && args.target === 'current_visible'
    const available = currentVisible ? visibleWriterRuntimes() : availableRuntimes()
    if (currentVisible && available.length === 0) {
      throw new Error(
        'no_visible_writer: No visible writer-capable OpenPencil Board is connected. Focus a writable Board and retry target current_visible.'
      )
    }
    if (available.length > 1) {
      const runtimeIds = available.map((runtime) => runtime.runtimeInstanceId).sort()
      throw new Error(
        `${String(body.command)} is ambiguous across ${currentVisible ? 'visible writer-capable' : 'connected'} OpenPencil runtimes: ${runtimeIds.join(', ')}. Retry with one exact runtime_instance_id.`
      )
    }
    const runtime = available[0]
    if (!runtime) return { body }
    return {
      body: {
        ...body,
        args: { ...args, runtime_instance_id: runtime.runtimeInstanceId }
      },
      requestedRuntime: runtime.runtimeInstanceId
    }
  }

  function sendRpc(body: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let routed: ReturnType<typeof routeBody>
      try {
        routed = routeBody(body)
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
        return
      }
      const requestedRuntime = routed.requestedRuntime
      const runtime = requestedRuntime ? runtimes.get(requestedRuntime) : undefined
      const ws = runtime?.ws ?? (requestedRuntime ? null : browserWs)
      if (!ws || ws.readyState !== ws.OPEN || !browserRegistered) {
        reject(
          new Error(
            requestedRuntime
              ? `OpenPencil runtime "${requestedRuntime}" is unavailable. Reacquire board context; do not retarget the mutation.`
              : APP_NOT_CONNECTED_MESSAGE
          )
        )
        return
      }
      const id = randomUUID()
      const settle = createSettler(resolve, reject)
      const timer = setTimeout(() => {
        pending.delete(id)
        pendingRoutes.delete(id)
        settle.reject(new Error(`RPC timeout (${Math.round(RPC_TIMEOUT / 1000)}s)`))
      }, RPC_TIMEOUT)
      pending.set(id, { resolve: settle.resolve, reject: settle.reject, timer })
      pendingRoutes.set(id, { pinned: Boolean(requestedRuntime), ws })
      try {
        ws.send(JSON.stringify({ type: 'request', id, ...routed.body }))
      } catch (e) {
        clearTimeout(timer)
        pending.delete(id)
        pendingRoutes.delete(id)
        if (!settle.isSettled()) {
          settle.reject(e instanceof Error ? e : new Error(String(e)))
        }
      }
    })
  }

  async function handleClientRequest(ws: WebSocket, msg: BrowserMessage) {
    if (!msg.id) return
    try {
      const result = await sendRpc(stripEnvelope(msg))
      sendJson(ws, { type: 'response', id: msg.id, ok: true, ...responsePayload(result) })
    } catch (e) {
      sendJson(ws, {
        type: 'response',
        id: msg.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }

  function registerBrowser(
    ws: WebSocket,
    token: string,
    runtimeInstanceId: string,
    active: boolean,
    targets: BrowserNavigationTarget[],
    visibility: RuntimeVisibility,
    writeAuthority: RuntimeWriteAuthority
  ) {
    if (authToken && token !== authToken) {
      ws.close()
      return
    }
    const previousRuntimeInstanceId = runtimeBySocket.get(ws)
    if (previousRuntimeInstanceId && previousRuntimeInstanceId !== runtimeInstanceId) {
      runtimes.delete(previousRuntimeInstanceId)
    }
    const runtime: BrowserRuntime = {
      active,
      navigationTargets: targets,
      runtimeInstanceId,
      token,
      updatedAt: Date.now(),
      visibility,
      writeAuthority,
      ws
    }
    runtimes.set(runtimeInstanceId, runtime)
    runtimeBySocket.set(ws, runtimeInstanceId)

    const previousBrowserWs = browserWs
    const previousToken = browserToken
    if (previousBrowserWs && previousBrowserWs !== ws && !active) {
      return
    }
    browserWs = ws
    browserToken = token
    browserRuntimeInstanceId = runtimeInstanceId
    browserRegistered = true
    const didChangeBrowser = previousBrowserWs !== ws
    const didChangeToken = previousToken !== token
    if (didChangeBrowser && previousBrowserWs) {
      rejectPendingForSocket(previousBrowserWs, 'Active OpenPencil client changed', true)
    }
    if (didChangeBrowser) onConnectionChange()
    if (didChangeBrowser || didChangeToken) broadcastRegisterToken()
  }

  function handleBrowserResponse(msg: BrowserMessage, ws: WebSocket) {
    if (!browserRegistered || !msg.id) return
    const route = pendingRoutes.get(msg.id)
    if (!route || route.ws !== ws) return
    const req = pending.get(msg.id)
    if (!req) return
    pending.delete(msg.id)
    pendingRoutes.delete(msg.id)
    clearTimeout(req.timer)
    if (msg.ok === false) req.reject(new Error(msg.error ?? 'RPC failed'))
    else req.resolve(stripEnvelope(msg))
  }

  function handleMessage(data: string, ws: WebSocket) {
    let msg: BrowserMessage
    try {
      msg = JSON.parse(data) as BrowserMessage
    } catch (e) {
      console.warn('Malformed automation message:', e)
      return
    }

    if (msg.type === 'register' && msg.token && msg.runtime_instance_id) {
      registerBrowser(
        ws,
        msg.token,
        msg.runtime_instance_id,
        msg.active === true,
        navigationTargets(msg.navigation_targets),
        msg.visibility === 'visible' || msg.visibility === 'hidden' ? msg.visibility : 'unknown',
        msg.write_authority === 'writer' || msg.write_authority === 'viewer'
          ? msg.write_authority
          : 'unknown'
      )
      return
    }
    if (msg.type === 'presence' && msg.token && msg.runtime_instance_id) {
      registerBrowser(
        ws,
        msg.token,
        msg.runtime_instance_id,
        msg.active === true,
        navigationTargets(msg.navigation_targets),
        msg.visibility === 'visible' || msg.visibility === 'hidden' ? msg.visibility : 'unknown',
        msg.write_authority === 'writer' || msg.write_authority === 'viewer'
          ? msg.write_authority
          : 'unknown'
      )
      return
    }
    if (msg.type === 'request') {
      void handleClientRequest(ws, msg)
      return
    }
    if (msg.type === 'response') handleBrowserResponse(msg, ws)
  }

  function handleClose(ws: WebSocket) {
    clients.delete(ws)
    const runtimeInstanceId = runtimeBySocket.get(ws)
    if (runtimeInstanceId && runtimes.get(runtimeInstanceId)?.ws === ws) {
      runtimes.delete(runtimeInstanceId)
    }
    rejectPendingForSocket(ws, 'Browser disconnected')
    if (browserWs !== ws) return
    const fallback =
      [...runtimes.values()].find((runtime) => runtime.active) ?? [...runtimes.values()][0]
    browserWs = fallback?.ws ?? null
    browserToken = fallback?.token ?? null
    browserRuntimeInstanceId = fallback?.runtimeInstanceId ?? null
    browserRegistered = Boolean(fallback)
    onConnectionChange()
  }

  function close() {
    rejectAllPending('Server shutting down')
    clients.clear()
    runtimes.clear()
    browserWs = null
    browserToken = null
    browserRuntimeInstanceId = null
    browserRegistered = false
  }

  return {
    close,
    currentRpcToken,
    handleClose,
    handleConnection,
    handleMessage,
    isConnected,
    resolveNavigationRuntime,
    sendRpc,
    currentRuntimeInstanceId: () => browserRuntimeInstanceId
  }
}
