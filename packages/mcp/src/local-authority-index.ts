#!/usr/bin/env bun
import { homedir } from 'node:os'
import path from 'node:path'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { localAppLaunchersFromEnv } from './local-apps/config'
import { LocalAppManager } from './local-apps/manager'
import { registerLocalAppRoutes } from './local-apps/routes'
import { LocalWorkspaceBoardRuntime } from './local-workspace-authority/board-runtime'
import { registerLocalWorkspaceAuthorityRoutes } from './local-workspace-authority/routes'
import { LocalWorkspaceAuthorityStore } from './local-workspace-authority/store'

const port = Number.parseInt(process.env.OPENPENCIL_LOCAL_AUTHORITY_PORT ?? '7602', 10)
const host = process.env.HOST ?? '127.0.0.1'
const authToken = process.env.OPENPENCIL_LOCAL_AUTHORITY_AUTH_TOKEN?.trim() || null
const configuredCorsOrigins = process.env.OPENPENCIL_LOCAL_AUTHORITY_CORS_ORIGIN?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const localWorkspaceRoot =
  process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
  path.join(homedir(), '.openpencil', 'local-workspace-authority-v1')

const store = new LocalWorkspaceAuthorityStore({
  preferredWorkspaceId: process.env.OPENPENCIL_LOCAL_WORKSPACE_ID?.trim() || null,
  root: localWorkspaceRoot,
  semanticServices: false
})
const app = new Hono()
const boardRuntime = new LocalWorkspaceBoardRuntime(store)
const localAppManager = new LocalAppManager(localAppLaunchersFromEnv())

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
registerLocalAppRoutes(app, {
  getAuthToken: () => authToken,
  manager: localAppManager
})

await store.status()
const server = serve({ fetch: app.fetch, hostname: host, port })

function close(): void {
  server.close(() => store.close())
}

process.once('SIGINT', close)
process.once('SIGTERM', close)

process.stderr.write(`OpenPencil local workspace authority\n`)
process.stderr.write(`  HTTP:  http://${host}:${String(port)}/local-workspace/v1\n`)
process.stderr.write(`  Data:  ${localWorkspaceRoot}\n`)
