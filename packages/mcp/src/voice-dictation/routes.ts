import type { Context, Hono, Next } from 'hono'

import { bearerToken, isAuthorized } from '#mcp/auth'

import type { AgyVoiceDictationManager } from './manager'

const ROUTE = '/agent-router/v1/pi/voice-dictation'

type VoiceDictationRouteOptions = {
  getAuthToken(): string | null
  manager: AgyVoiceDictationManager
}

function unavailable(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const status = message.includes('already active')
    ? 409
    : error instanceof SyntaxError || message.startsWith('Voice context')
      ? 400
      : 503
  return context.json({ code: 'voice_dictation_unavailable', error: message }, status)
}

export function registerVoiceDictationRoutes(app: Hono, options: VoiceDictationRouteOptions): void {
  app.use(`${ROUTE}/*`, async (context: Context, next: Next) => {
    const expected = options.getAuthToken()
    if (!expected) {
      return context.json({ code: 'router_auth_unavailable', error: 'Router unavailable' }, 503)
    }
    const provided = bearerToken(context.req.header('authorization'))
    if (!isAuthorized(provided, expected)) {
      return context.json({ code: 'unauthorized', error: 'Unauthorized' }, 401)
    }
    return next()
  })

  app.post(ROUTE, async (context) => {
    try {
      const raw = await context.req.text()
      const payload: unknown = raw ? JSON.parse(raw) : null
      const voiceContext =
        payload && typeof payload === 'object' && 'context' in payload
          ? (payload as { context?: unknown }).context
          : undefined
      return context.json(options.manager.start(voiceContext), 201)
    } catch (error) {
      return unavailable(context, error)
    }
  })
  app.get(ROUTE, (context) => {
    const snapshot = options.manager.active()
    return snapshot ? context.json(snapshot) : context.body(null, 204)
  })
  app.get(`${ROUTE}/:sessionId`, (context) => {
    const snapshot = options.manager.read(context.req.param('sessionId'))
    return snapshot
      ? context.json(snapshot)
      : context.json({ code: 'voice_dictation_not_found', error: 'Voice session not found' }, 404)
  })
  app.post(`${ROUTE}/:sessionId/audio`, async (context) => {
    try {
      const accepted = options.manager.writeAudio(
        context.req.param('sessionId'),
        new Uint8Array(await context.req.arrayBuffer())
      )
      if (accepted === null) {
        return context.json(
          { code: 'voice_dictation_not_found', error: 'Voice session not found' },
          404
        )
      }
      if (!accepted) {
        return context.json(
          { code: 'voice_dictation_inactive', error: 'Voice session is no longer active' },
          409
        )
      }
      return context.body(null, 204)
    } catch (error) {
      return unavailable(context, error)
    }
  })
  app.post(`${ROUTE}/:sessionId/stop`, (context) => {
    const snapshot = options.manager.stop(context.req.param('sessionId'))
    return snapshot
      ? context.json(snapshot)
      : context.json({ code: 'voice_dictation_not_found', error: 'Voice session not found' }, 404)
  })
  app.delete(`${ROUTE}/:sessionId`, (context) => {
    const snapshot = options.manager.cancel(context.req.param('sessionId'))
    return snapshot
      ? context.json(snapshot)
      : context.json({ code: 'voice_dictation_not_found', error: 'Voice session not found' }, 404)
  })
}
