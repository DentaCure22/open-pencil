import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { resolveCommand } from 'package-manager-detector/commands'
import { detect, getUserAgent } from 'package-manager-detector/detect'
import { WebSocketServer, type WebSocket } from 'ws'

import {
  classifyRpcExecutionSurface,
  normalizePersistedExecutionError,
  persistedAuthorityUnavailableError
} from '@open-pencil/core/rpc'

import type { RpcJsonObject } from '#mcp/json'

import packageJson from '../package.json' with { type: 'json' }
import { bearerToken, isAuthorized, mcpRequestToken } from './auth'
import { createBrowserRpcBridge } from './browser-rpc'
import { MCP_CORS_HEADERS, MCP_CORS_METHODS, MCP_EXPOSED_HEADERS } from './http-options'
import { preprocessRpc } from './jsx-preprocess'
import { LocalAppManager } from './local-apps/manager'
import { registerLocalAppRoutes } from './local-apps/routes'
import type { LocalAppLauncherConfig } from './local-apps/types'
import { LocalWorkspaceBoardRuntime } from './local-workspace-authority/board-runtime'
import { registerLocalWorkspaceAuthorityRoutes } from './local-workspace-authority/routes'
import { LocalWorkspaceAuthorityStore } from './local-workspace-authority/store'
import { createMcpSessionManager } from './mcp-sessions'
import { registerTools } from './tool/registration'

export const MCP_VERSION: string = packageJson.version

const HEARTBEAT_INTERVAL_MS = 5_000

let installCommandPromise: Promise<string> | null = null

async function resolveMcpInstallCommand(): Promise<string> {
  const agent =
    getUserAgent() ??
    (
      await detect({
        strategies: ['install-metadata', 'lockfile', 'packageManager-field', 'devEngines-field']
      })
    )?.agent ??
    'npm'
  const resolved = resolveCommand(agent, 'global', [`@open-pencil/mcp@${MCP_VERSION}`])
  if (!resolved) return `npm install -g @open-pencil/mcp@${MCP_VERSION}`
  return [resolved.command, ...resolved.args].join(' ')
}

function mcpInstallCommand(): Promise<string> {
  installCommandPromise ??= resolveMcpInstallCommand()
  return installCommandPromise
}

export { fail, ok, type MCPContent, type MCPResult } from './result'

export { registerTools, type RegisterToolsOptions, type RpcSender } from './tool/registration'
export { paramToZod } from './tool/schema'
export {
  createSourceActionAdapter,
  sourceTargetRef,
  sourceWriteScope,
  type SourceActionAdapter,
  type SourceActionAdapterOptions,
  type SourceActionAuthorization,
  type SourceApplyReceipt,
  type SourceApplyRequest,
  type SourceRollbackReceipt,
  type SourceRollbackRequest,
  type SourceVerificationProfile
} from './source-action-adapter'

export interface ServerOptions {
  httpPort?: number
  wsPort?: number
  enableEval?: boolean
  mcpRoot?: string | null
  authToken?: string | null
  corsOrigin?: string | string[] | null
  localAppLaunchers?: readonly LocalAppLauncherConfig[]
  localWorkspaceId?: string | null
  localWorkspaceRoot?: string | null
}

export function startServer(options: ServerOptions = {}) {
  const httpPort = options.httpPort ?? 7600
  const wsPort = options.wsPort ?? 7601
  const enableEval = options.enableEval ?? false
  const mcpRoot = options.mcpRoot ?? null
  const authToken = options.authToken ?? null
  const corsOrigin = options.corsOrigin ?? null
  const localWorkspaceRoot = options.localWorkspaceRoot ?? null
  const localAppManager = new LocalAppManager(options.localAppLaunchers ?? [])
  const localWorkspaceStore = localWorkspaceRoot
    ? new LocalWorkspaceAuthorityStore({
        preferredWorkspaceId: options.localWorkspaceId,
        root: localWorkspaceRoot
      })
    : null
  const localWorkspaceBoard = localWorkspaceStore
    ? new LocalWorkspaceBoardRuntime(localWorkspaceStore)
    : null

  const mcpSessions = createMcpSessionManager({
    serverVersion: MCP_VERSION,
    registerTools: (mcpServer: McpServer) =>
      registerTools(mcpServer, { enableEval, mcpRoot, sendRpc })
  })
  const browserRpc = createBrowserRpcBridge({
    authToken,
    onConnectionChange: mcpSessions.notifyToolsChanged
  })
  const sendToBrowser = browserRpc.sendRpc

  async function sendRpc(body: Record<string, unknown>): Promise<unknown> {
    const command = typeof body.command === 'string' ? body.command : ''
    const surface = classifyRpcExecutionSurface(command, body.args)
    if (surface === 'persisted_authority') {
      if (!localWorkspaceBoard || !localWorkspaceStore) {
        throw persistedAuthorityUnavailableError(command)
      }
      const authorityStatus = await localWorkspaceStore.status().catch(() => null)
      if (authorityStatus?.state !== 'ready') throw persistedAuthorityUnavailableError(command)
      try {
        return await localWorkspaceBoard.sendRpc(body)
      } catch (error) {
        throw normalizePersistedExecutionError(command, error)
      }
    }
    return sendToBrowser(body)
  }

  // --- WebSocket: browser connects here ---

  const wss = new WebSocketServer({ port: wsPort, host: '127.0.0.1' })
  const alive = new WeakMap<WebSocket, boolean>()

  wss.on('connection', (ws) => {
    alive.set(ws, true)
    browserRpc.handleConnection(ws)

    ws.on('pong', () => alive.set(ws, true))
    ws.on('message', (raw) => {
      alive.set(ws, true)
      const data = typeof raw === 'string' ? raw : Buffer.from(raw as Buffer).toString('utf-8')
      browserRpc.handleMessage(data, ws)
    })

    ws.on('close', () => {
      browserRpc.handleClose(ws)
    })

    ws.on('error', () => {
      try {
        ws.terminate()
      } catch {
        alive.delete(ws)
      }
    })
  })

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        try {
          ws.terminate()
        } catch {
          continue
        }
        continue
      }
      alive.set(ws, false)
      try {
        ws.ping()
      } catch {
        continue
      }
    }
  }, HEARTBEAT_INTERVAL_MS)
  heartbeat.unref()
  wss.on('close', () => clearInterval(heartbeat))

  // --- HTTP server ---

  const app = new Hono()

  if (corsOrigin) {
    app.use(
      '*',
      cors({
        origin: corsOrigin,
        allowMethods: MCP_CORS_METHODS,
        allowHeaders: MCP_CORS_HEADERS,
        exposeHeaders: MCP_EXPOSED_HEADERS
      })
    )
  }

  app.get('/health', async (c) => {
    const authorityStatus = await localWorkspaceStore?.status().catch(() => null)
    const browserConnected = browserRpc.isConnected()
    const authorityReady = authorityStatus?.state === 'ready'
    const rpcToken = authToken ?? browserRpc.currentRpcToken()
    let executionSurface = 'unavailable'
    if (authorityReady) executionSurface = 'local_workspace_authority'
    else if (browserConnected) executionSurface = 'live_browser'
    return c.json({
      status: browserConnected || authorityReady ? 'ok' : 'no_app',
      version: MCP_VERSION,
      installCommand: await mcpInstallCommand(),
      authRequired: authToken !== null,
      executionSurface,
      presentationSurface: browserConnected ? 'live_browser' : 'unavailable',
      browserConnected,
      authorityReady,
      ...(rpcToken ? { token: rpcToken } : {})
    })
  })

  app.use('/rpc', async (c, next) => {
    const rpcToken = authToken ?? browserRpc.currentRpcToken()
    if (!rpcToken) {
      return c.json({ error: 'OpenPencil RPC authentication is unavailable.' }, 503)
    }
    const provided = bearerToken(c.req.header('authorization'))
    if (!isAuthorized(provided, rpcToken)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return next()
  })

  app.post('/rpc', async (c) => {
    let body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'Invalid request body' }, 400)
    }
    try {
      body = preprocessRpc(body as RpcJsonObject)
      const result = await sendRpc(body as RpcJsonObject)
      return c.json(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ ok: false, error: msg }, 502)
    }
  })

  registerLocalAppRoutes(app, {
    getAuthToken: () => authToken ?? browserRpc.currentRpcToken(),
    manager: localAppManager
  })

  if (localWorkspaceStore) {
    registerLocalWorkspaceAuthorityRoutes(app, {
      getAuthToken: () => authToken ?? browserRpc.currentRpcToken(),
      store: localWorkspaceStore
    })
  }

  // --- MCP Streamable HTTP ---

  app.all('/mcp', async (c) => {
    if (authToken) {
      const token = mcpRequestToken(c.req.header('authorization'), c.req.header('x-mcp-token'))
      if (!isAuthorized(token, authToken)) {
        return c.json({ error: 'Unauthorized' }, 401)
      }
    }
    const sessionId = c.req.header('mcp-session-id') ?? undefined
    const transport = mcpSessions.resolveTransport(sessionId)
    if ('error' in transport) {
      return c.json(
        { error: 'Too many active MCP sessions' },
        { status: 503, headers: { 'Retry-After': '5' } }
      )
    }
    mcpSessions.touch(sessionId, transport)
    const response = await transport.handleRequest(c.req.raw)
    if (c.req.method === 'DELETE') {
      mcpSessions.deleteSession(sessionId)
    }
    return response
  })

  function close() {
    browserRpc.close()
    mcpSessions.clear()
    wss.close()
  }

  return { app, wss, httpPort, close }
}
