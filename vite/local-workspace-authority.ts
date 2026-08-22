import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'

import type { Plugin, ViteDevServer } from 'vite'

const LOCAL_AUTHORITY_PORT = '7602'
const devLocalAuthorityAuthToken = process.env.OPENPENCIL_DEV_TOKEN ?? randomUUID()
const localAuthorityDisabled = process.env.OPENPENCIL_DISABLE_LOCAL_WORKSPACE_AUTHORITY === '1'

export type LocalWorkspaceAuthorityPluginOptions = {
  localWorkspaceId?: string
  localWorkspaceRoot?: string
  smylrAppRoot?: string
}

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
