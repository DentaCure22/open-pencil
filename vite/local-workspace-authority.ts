import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'

import type { Plugin, ViteDevServer } from 'vite'

import {
  emptyModelMeterSnapshot,
  parseModelMeterTurns,
  rollupModelMeterTurns
} from '../src/app/model-meter/rollup'

const LOCAL_AUTHORITY_PORT = '7602'
const DEFAULT_AUTHORITY_ROOT = join(homedir(), '.openpencil', 'local-workspace-authority-v1')
const localAuthorityDisabled = process.env.OPENPENCIL_DISABLE_LOCAL_WORKSPACE_AUTHORITY === '1'

function modelMeterLedgerPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.OPENPENCIL_MODEL_METER_LOG?.trim()
  if (override) return override
  return join(home, '.openpencil', 'model-meter', 'turns.jsonl')
}

function serveModelMeter(request: IncomingMessage, response: ServerResponse): boolean {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname !== '/__openpencil/model-meter') return false
  const parsedDays = Number.parseInt(url.searchParams.get('days') ?? '7', 10)
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 7
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json')
  try {
    const snapshot = rollupModelMeterTurns(
      parseModelMeterTurns(readFileSync(modelMeterLedgerPath(), 'utf8')),
      days
    )
    response.end(JSON.stringify(snapshot))
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      response.end(JSON.stringify(emptyModelMeterSnapshot(days)))
      return true
    }
    response.statusCode = 500
    response.end(JSON.stringify({ available: false, days, lastAt: null, rows: [], series: [], turns: 0 }))
  }
  return true
}

export type LocalWorkspaceAuthorityPluginOptions = {
  localWorkspaceId?: string
  localWorkspaceRoot?: string
  smylrAppRoot?: string
}

export function defaultLocalWorkspaceAuthorityRoot(): string {
  return DEFAULT_AUTHORITY_ROOT
}

export function readPublishedLocalAuthorityToken(root = DEFAULT_AUTHORITY_ROOT): string | null {
  try {
    const payload = JSON.parse(readFileSync(join(root, 'agent-auth.json'), 'utf8')) as {
      token?: unknown
    }
    return typeof payload.token === 'string' && payload.token.trim() ? payload.token.trim() : null
  } catch {
    return null
  }
}

export function resolveDevLocalAuthorityAuthToken(
  env: NodeJS.ProcessEnv = process.env,
  readPublishedToken: () => string | null = readPublishedLocalAuthorityToken
): string {
  return env.OPENPENCIL_DEV_TOKEN?.trim() || readPublishedToken() || randomUUID()
}

const devLocalAuthorityAuthToken = resolveDevLocalAuthorityAuthToken()

export function resolveBunExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const explicitExecutable = env.OPENPENCIL_BUN_EXECUTABLE?.trim()
  if (explicitExecutable) return explicitExecutable

  const packageManagerExecutable = env.npm_execpath?.trim()
  const packageManagerName = packageManagerExecutable
    ? basename(packageManagerExecutable).toLowerCase()
    : ''
  if (
    packageManagerExecutable &&
    (packageManagerName === 'bun' || packageManagerName === 'bun.exe')
  ) {
    return packageManagerExecutable
  }

  return 'bun'
}

export function localWorkspaceAuthorityToken(command: string): string | null {
  return command === 'serve' && !localAuthorityDisabled ? devLocalAuthorityAuthToken : null
}

function authorityCorsOrigin(host: string | undefined): string {
  return [`http://${host || '127.0.0.1'}:1420`, 'http://127.0.0.1:1420', 'http://localhost:1420']
    .filter((origin, index, origins) => origins.indexOf(origin) === index)
    .join(',')
}

export function openPencilLocalWorkspaceAuthorityPlugin(
  command: string,
  host: string | undefined,
  options: LocalWorkspaceAuthorityPluginOptions = {}
): Plugin | false {
  const authToken = localWorkspaceAuthorityToken(command)
  if (!authToken) return false

  let child: ReturnType<typeof spawn> | null = null
  const stopChild = () => {
    const runningChild = child
    child = null
    runningChild?.kill()
  }

  return {
    name: 'open-pencil-local-workspace-authority',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request, response, next) => {
        if (serveModelMeter(request, response)) return
        if (request.url?.split('?')[0] !== '/__openpencil/local-authority-auth') {
          next()
          return
        }
        const token =
          readPublishedLocalAuthorityToken(
            options.localWorkspaceRoot ?? defaultLocalWorkspaceAuthorityRoot()
          ) ?? authToken
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ token }))
      })
      if (child) return

      const bunExecutable = resolveBunExecutable()
      const spawnedChild = spawn(
        bunExecutable,
        ['run', 'packages/mcp/src/local-authority-index.ts'],
        {
          env: {
            ...process.env,
            PATH: [
              join(homedir(), '.local', 'share', 'pi-node', 'current', 'bin'),
              process.env.PATH ?? ''
            ]
              .filter(Boolean)
              .join(':'),
            OPENPENCIL_LOCAL_AUTHORITY_AUTH_TOKEN: authToken,
            OPENPENCIL_LOCAL_AUTHORITY_CORS_ORIGIN: authorityCorsOrigin(host),
            OPENPENCIL_LOCAL_AUTHORITY_PORT: LOCAL_AUTHORITY_PORT,
            ...(options.localWorkspaceId
              ? { OPENPENCIL_LOCAL_WORKSPACE_ID: options.localWorkspaceId }
              : {}),
            ...(options.localWorkspaceRoot
              ? { OPENPENCIL_LOCAL_WORKSPACE_ROOT: options.localWorkspaceRoot }
              : {}),
            ...(options.smylrAppRoot ? { OPENPENCIL_SMYLR_APP_ROOT: options.smylrAppRoot } : {})
          },
          stdio: ['ignore', 'inherit', 'pipe']
        }
      )
      child = spawnedChild
      server.httpServer?.once('close', stopChild)

      spawnedChild.stderr.on('data', (data: Buffer) => {
        const text = data.toString()
        if (text.includes('EADDRINUSE')) {
          console.error(
            '\x1b[31m[Local authority] Port 7602 is already in use by another process.\x1b[0m'
          )
          spawnedChild.kill()
          if (child === spawnedChild) child = null
          return
        }
        process.stderr.write(data)
      })

      spawnedChild.on('error', (error) => {
        console.error(`[Local authority] Failed to start with ${bunExecutable}: ${error.message}`)
        if (child === spawnedChild) child = null
      })

      spawnedChild.on('exit', (code) => {
        if (code && code !== 0 && child === spawnedChild) {
          console.error(`[Local authority] Server exited with code ${String(code)}`)
        }
        if (child === spawnedChild) child = null
      })
    },
    buildEnd() {
      stopChild()
    }
  }
}
