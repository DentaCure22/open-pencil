import { describe, expect, test } from 'bun:test'

import { localAppLaunchersFromEnv } from '#mcp/local-apps/config'
import { LocalAppLaunchError, LocalAppManager } from '#mcp/local-apps/manager'
import type { LocalAppLauncherConfig } from '#mcp/local-apps/types'
import { startServer } from '#mcp/server'

const launcher: LocalAppLauncherConfig = {
  args: ['run', 'dev'],
  command: 'npm',
  cwd: '/tmp/smylr',
  healthUrl: 'http://127.0.0.1:3000/',
  id: 'smylr',
  label: 'Smylr',
  startScript: 'npm run dev'
}

describe('local app launcher', () => {
  test('keeps the Smylr command allowlisted while resolving its local root from configuration', () => {
    expect(localAppLaunchersFromEnv({})).toEqual([])
    expect(
      localAppLaunchersFromEnv({ OPENPENCIL_SMYLR_APP_ROOT: '/workspace/Smylr-Elite' })
    ).toMatchObject([
      {
        args: ['run', 'dev'],
        cwd: '/workspace/Smylr-Elite',
        environment: { PORT: '3000' },
        id: 'smylr',
        startScript: 'npm run dev'
      }
    ])
  })

  test('coalesces start requests and reports the app as soon as its health check passes', async () => {
    let healthChecks = 0
    let launches = 0
    const manager = new LocalAppManager([launcher], {
      isHealthy: async () => {
        healthChecks += 1
        return healthChecks >= 3
      },
      launch: async () => {
        launches += 1
      },
      validateRoot: async () => undefined,
      wait: async () => undefined
    })

    expect(await manager.status('smylr')).toMatchObject({ state: 'stopped' })
    const first = manager.start('smylr')
    const second = manager.start('smylr')
    expect(first).toBe(second)
    expect(await first).toMatchObject({ state: 'started', startScript: 'npm run dev' })
    expect(launches).toBe(1)
    expect(await manager.status('smylr')).toMatchObject({ state: 'running' })
  })

  test('rejects an unavailable configured root before spawning', async () => {
    const manager = new LocalAppManager([launcher], {
      isHealthy: async () => false,
      launch: async () => {
        throw new Error('launch should not run')
      },
      validateRoot: async () => {
        throw new LocalAppLaunchError('invalid_root', 'The configured app folder is unavailable')
      },
      wait: async () => undefined
    })

    expect(manager.start('missing')).toBeNull()
    await expect(manager.start('smylr')).rejects.toMatchObject({ code: 'invalid_root' })
  })

  test('protects launcher status with the local automation token', async () => {
    const server = startServer({
      authToken: 'local-token',
      httpPort: 0,
      localAppLaunchers: [launcher],
      wsPort: 0
    })
    try {
      const unauthorized = await server.app.request('/local-apps/v1/smylr/status')
      expect(unauthorized.status).toBe(401)

      const response = await server.app.request('/local-apps/v1/smylr/status', {
        headers: { Authorization: 'Bearer local-token' }
      })
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body).toMatchObject({
        appId: 'smylr',
        startScript: 'npm run dev'
      })
      expect(['running', 'stopped']).toContain(body.state)
    } finally {
      server.close()
    }
  })
})
