#!/usr/bin/env node
import { homedir } from 'node:os'
import path from 'node:path'

import { serve } from '@hono/node-server'

import { localAppLaunchersFromEnv } from './local-apps/config.js'
import { startServer } from './server.js'
import { mcpToolSearchEnabled } from './tool/registration.js'

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    `openpencil-mcp-http\n\nStart the OpenPencil MCP HTTP and WebSocket server.\n\nOptions:\n  --help, -h    Show this help message\n`
  )
  process.exit(0)
}

const port = Number.parseInt(process.env.PORT ?? '7600', 10)
const wsPort = Number.parseInt(process.env.WS_PORT ?? '7601', 10)
const host = process.env.HOST ?? '127.0.0.1'
const configuredCorsOrigins = process.env.OPENPENCIL_MCP_CORS_ORIGIN?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const localWorkspaceRoot =
  process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
  path.join(homedir(), '.openpencil', 'local-workspace-authority-v1')

const { app, httpPort } = startServer({
  httpPort: port,
  wsPort,
  enableEval: process.env.OPENPENCIL_MCP_EVAL === '1',
  toolSearch: mcpToolSearchEnabled(),
  mcpRoot: process.env.OPENPENCIL_MCP_ROOT?.trim() || process.cwd(),
  authToken: process.env.OPENPENCIL_MCP_AUTH_TOKEN?.trim() || null,
  corsOrigin:
    configuredCorsOrigins && configuredCorsOrigins.length > 0 ? configuredCorsOrigins : null,
  localAppLaunchers: localAppLaunchersFromEnv(),
  localWorkspaceId: process.env.OPENPENCIL_LOCAL_WORKSPACE_ID?.trim() || null,
  localWorkspaceRoot
})

serve({ fetch: app.fetch, port: httpPort, hostname: host })

process.stderr.write(`OpenPencil MCP server\n`)
process.stderr.write(`  HTTP:  http://${host}:${httpPort}\n`)
process.stderr.write(`  WS:    ws://${host}:${wsPort}\n`)
process.stderr.write(`  MCP:   http://${host}:${httpPort}/mcp\n`)
process.stderr.write(`  Data:  ${localWorkspaceRoot}\n`)
