import { spawn } from 'node:child_process'
import { basename } from 'node:path'

import type { Plugin, ViteDevServer } from 'vite'

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

// TODO: production — bundle MCP server as Tauri sidecar or spawn via shell plugin
export function automationPlugin(authToken: string | null, corsOrigin: string): Plugin {
  let child: ReturnType<typeof spawn> | null = null
  const stopChild = () => {
    const runningChild = child
    child = null
    runningChild?.kill()
  }

  return {
    name: 'open-pencil-automation',
    configureServer(server: ViteDevServer) {
      if (child) return

      const bunExecutable = resolveBunExecutable()
      const spawnedChild = spawn(bunExecutable, ['run', 'packages/mcp/src/index.ts'], {
        stdio: ['ignore', 'inherit', 'pipe'],
        env: {
          ...process.env,
          PORT: '7600',
          WS_PORT: '7601',
          ...(authToken ? { OPENPENCIL_MCP_AUTH_TOKEN: authToken } : {}),
          OPENPENCIL_MCP_CORS_ORIGIN: corsOrigin
        }
      })
      child = spawnedChild
      server.httpServer?.once('close', stopChild)

      spawnedChild.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        if (text.includes('EADDRINUSE')) {
          console.error(
            '\x1b[31m[MCP] Port 7600 already in use. Is another OpenPencil instance running?\x1b[0m'
          )
          spawnedChild.kill()
          if (child === spawnedChild) child = null
          return
        }
        process.stderr.write(data)
      })

      spawnedChild.on('error', (error) => {
        console.error(`[MCP] Failed to start with ${bunExecutable}: ${error.message}`)
        if (child === spawnedChild) child = null
      })

      spawnedChild.on('exit', (code) => {
        if (code && code !== 0 && child === spawnedChild) {
          console.error(`[MCP] Server exited with code ${code}`)
        }
        if (child === spawnedChild) child = null
      })
    },
    buildEnd() {
      stopChild()
    }
  }
}
