import type { Context, Hono, Next } from 'hono'

import { bearerToken, isAuthorized } from '#mcp/auth'

import { LocalAppLaunchError, type LocalAppManager } from './manager'

const LOCAL_APPS_ROUTE = '/local-apps/v1'

type LocalAppRouteOptions = {
  getAuthToken(): string | null
  manager: LocalAppManager
}

function launchErrorResponse(c: Context, error: unknown) {
  if (error instanceof LocalAppLaunchError) {
    return c.json({ code: error.code, error: error.message }, 422)
  }
  const message = error instanceof Error ? error.message : String(error)
  return c.json({ code: 'launch_error', error: message }, 500)
}

export function registerLocalAppRoutes(app: Hono, options: LocalAppRouteOptions): void {
  app.use(`${LOCAL_APPS_ROUTE}/*`, async (c: Context, next: Next) => {
    const expected = options.getAuthToken()
    if (!expected) {
      return c.json({ code: 'launcher_auth_unavailable', error: 'Launcher unavailable' }, 503)
    }
    const provided = bearerToken(c.req.header('authorization'))
    if (!isAuthorized(provided, expected)) {
      return c.json({ code: 'unauthorized', error: 'Unauthorized' }, 401)
    }
    return next()
  })

  app.get(`${LOCAL_APPS_ROUTE}/:appId/status`, async (c) => {
    try {
      const status = await options.manager.status(c.req.param('appId'))
      return status
        ? c.json(status)
        : c.json({ code: 'launcher_not_configured', error: 'Launcher not configured' }, 404)
    } catch (error) {
      return launchErrorResponse(c, error)
    }
  })

  app.post(`${LOCAL_APPS_ROUTE}/:appId/start`, async (c) => {
    try {
      const request = options.manager.start(c.req.param('appId'))
      return request
        ? c.json(await request)
        : c.json({ code: 'launcher_not_configured', error: 'Launcher not configured' }, 404)
    } catch (error) {
      return launchErrorResponse(c, error)
    }
  })
}
