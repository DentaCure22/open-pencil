#!/usr/bin/env bun
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { registerAgentAttachmentRoutes } from './agent-attachments/routes'
import { AgentAttachmentStore } from './agent-attachments/store'
import { resolveFfmpegExecutable } from './agent-attachments/video'
import type { AgentConversationRouter } from './agent-router/contracts'
import { registerAgentRoutes } from './agent-router/routes'
import { localAppLaunchersFromEnv } from './local-apps/config'
import { LocalAppManager } from './local-apps/manager'
import { registerLocalAppRoutes } from './local-apps/routes'
import { assertLocalAuthorityPortAvailable } from './local-authority-port'
import { LocalWorkspaceBoardRuntime } from './local-workspace-authority/board-runtime'
import { registerLocalWorkspaceAuthorityRoutes } from './local-workspace-authority/routes'
import { LocalWorkspaceAuthorityStore } from './local-workspace-authority/store'
import { loadPiAgentModels } from './pi/catalog'
import { resolvePiExecutable } from './pi/executable'
import { PiAgentRouter } from './pi/router'

const port = Number.parseInt(process.env.OPENPENCIL_LOCAL_AUTHORITY_PORT ?? '7602', 10)
const host = process.env.HOST ?? '127.0.0.1'
const authToken = process.env.OPENPENCIL_LOCAL_AUTHORITY_AUTH_TOKEN?.trim() || null
const configuredCorsOrigins = process.env.OPENPENCIL_LOCAL_AUTHORITY_CORS_ORIGIN?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const localWorkspaceRoot =
  process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
  path.join(homedir(), '.openpencil', 'local-workspace-authority-v1')
const agentExecutable = resolvePiExecutable()
const agentWorkspaceRoot = process.env.OPENPENCIL_AGENT_WORKSPACE_ROOT?.trim() || process.cwd()

await assertLocalAuthorityPortAvailable(host, port)

const store = new LocalWorkspaceAuthorityStore({
  preferredWorkspaceId: process.env.OPENPENCIL_LOCAL_WORKSPACE_ID?.trim() || null,
  root: localWorkspaceRoot,
  semanticServices: false
})
const app = new Hono()
const attachmentStore = new AgentAttachmentStore(localWorkspaceRoot)
const boardRuntime = new LocalWorkspaceBoardRuntime(store)
const localAppManager = new LocalAppManager(localAppLaunchersFromEnv())
const sharedAgentRouterConfig = {
  executable: agentExecutable,
  historyPath: path.join(localWorkspaceRoot, 'pi-conversations.json'),
  stallTimeoutMs: Number.parseInt(process.env.OPENPENCIL_PI_STALL_TIMEOUT_MS ?? '900000', 10),
  watchdogProbeMs: Number.parseInt(process.env.OPENPENCIL_PI_WATCHDOG_PROBE_MS ?? '30000', 10),
  workspaceRoot: agentWorkspaceRoot
}
const agentRouter: AgentConversationRouter = new PiAgentRouter({
  ...sharedAgentRouterConfig,
  models: loadPiAgentModels(),
  sessionDir: path.join(localWorkspaceRoot, 'pi-sessions')
})
await attachmentStore.reconcile(agentRouter.conversations().map((thread) => thread.id))

if (configuredCorsOrigins && configuredCorsOrigins.length > 0) {
  app.use(
    '*',
    cors({
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['DELETE', 'GET', 'OPTIONS', 'POST'],
      origin: configuredCorsOrigins
    })
  )
}

registerLocalWorkspaceAuthorityRoutes(app, {
  getAuthToken: () => authToken,
  sendRpc: (body) => boardRuntime.sendRpc(body),
  store
})
registerAgentAttachmentRoutes(app, {
  authorityRoot: localWorkspaceRoot,
  ffmpegExecutable: resolveFfmpegExecutable(process.env, agentExecutable),
  getAuthToken: () => authToken,
  store: attachmentStore
})
registerLocalAppRoutes(app, {
  getAuthToken: () => authToken,
  manager: localAppManager
})
registerAgentRoutes(app, {
  attachmentStore,
  authorityRoot: localWorkspaceRoot,
  getAuthToken: () => authToken,
  router: agentRouter,
  traceEvidence: store
})

// Publish local agent credentials so MCP tools (e.g. dispatch_work) can reach
// the authority without sharing the Vite build-time token path.
const agentAuthPath = path.join(localWorkspaceRoot, 'agent-auth.json')
if (authToken) {
  await mkdir(localWorkspaceRoot, { recursive: true })
  await writeFile(
    agentAuthPath,
    JSON.stringify({ port, token: authToken, updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  )
} else {
  await rm(agentAuthPath, { force: true })
}

await store.status()
const server = serve({ fetch: app.fetch, hostname: host, port })

async function close(): Promise<void> {
  // Remove published agent credentials first so a stale file never implies a live server.
  await rm(agentAuthPath, { force: true }).catch(() => undefined)
  agentRouter.close()
  server.close()
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())

process.stderr.write(`OpenPencil local workspace authority\n`)
process.stderr.write(`  HTTP:  http://${host}:${String(port)}/local-workspace/v1\n`)
process.stderr.write(`  Data:  ${localWorkspaceRoot}\n`)
