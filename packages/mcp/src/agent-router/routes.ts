import type { Context, Hono, Next } from 'hono'

import { bearerToken, isAuthorized } from '#mcp/auth'
import { localWorkspaceTraceEvidencePath } from '#mcp/local-workspace-authority/agent-context'

import type { AgentConversationRouter } from './contracts'

const ROUTE = '/agent-router/v1/pi'

type RouteOptions = {
  authorityRoot: string
  getAuthToken(): string | null
  router: AgentConversationRouter
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function errorResponse(context: Context, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const status = message.includes('unavailable') || message.includes('could not start') ? 503 : 422
  return context.json({ code: 'agent_dispatch_error', error: message }, status)
}

export function registerAgentRoutes(app: Hono, options: RouteOptions): void {
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

  app.get(`${ROUTE}/status`, async (context) => context.json(await options.router.status()))
  app.get(`${ROUTE}/models`, (context) => context.json({ models: options.router.models() }))
  app.get(`${ROUTE}/provider-usage/:provider`, async (context) =>
    context.json({ usage: await options.router.providerUsage(context.req.param('provider')) })
  )
  app.get(`${ROUTE}/conversations`, (context) =>
    context.json({
      threads:
        context.req.query('preview') === '1'
          ? options.router.conversationPreviews()
          : options.router.conversations()
    })
  )
  app.get(`${ROUTE}/conversations/:threadId`, (context) => {
    const thread = options.router.conversation(context.req.param('threadId'))
    return thread
      ? context.json(thread)
      : context.json({ code: 'agent_thread_not_found', error: 'Agent conversation not found' }, 404)
  })

  app.get(`${ROUTE}/jobs/:jobId`, (context) => {
    const job = options.router.job(context.req.param('jobId'))
    return job
      ? context.json(job)
      : context.json({ code: 'agent_job_not_found', error: 'Agent job not found' }, 404)
  })

  app.post(`${ROUTE}/conversations/:threadId/stop`, (context) =>
    options.router.stop(context.req.param('threadId'))
      ? context.json({ stopped: true })
      : context.json(
          { code: 'agent_thread_not_running', error: 'Agent conversation is not running' },
          409
        )
  )

  app.delete(`${ROUTE}/conversations/:threadId`, (context) =>
    options.router.delete(context.req.param('threadId'))
      ? context.json({ deleted: true })
      : context.json({ code: 'agent_thread_not_found', error: 'Agent conversation not found' }, 404)
  )

  app.post(`${ROUTE}/reset-workers`, (context) => context.json(options.router.resetWorkers()))

  async function acceptConversationMessage(context: Context, action: 'followUp' | 'steer') {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid request body' }, 400)
    }
    try {
      return context.json(
        await options.router[action](
          context.req.param('threadId'),
          typeof body.message === 'string' ? body.message : '',
          {
            displayPrompt: typeof body.displayPrompt === 'string' ? body.displayPrompt : undefined,
            effort: typeof body.effort === 'string' ? body.effort : undefined,
            model: typeof body.model === 'string' ? body.model : undefined
          }
        ),
        202
      )
    } catch (error) {
      return errorResponse(context, error)
    }
  }

  app.post(`${ROUTE}/conversations/:threadId/follow-up`, (context) =>
    acceptConversationMessage(context, 'followUp')
  )
  app.post(`${ROUTE}/conversations/:threadId/steer`, (context) =>
    acceptConversationMessage(context, 'steer')
  )

  app.post(`${ROUTE}/dispatch`, async (context) => {
    const body = await context.req.json().catch(() => null)
    if (!isRecord(body)) {
      return context.json({ code: 'invalid_request', error: 'Invalid request body' }, 400)
    }
    try {
      return context.json(
        await options.router.dispatch({
          displayPrompt: typeof body.displayPrompt === 'string' ? body.displayPrompt : undefined,
          effort: typeof body.effort === 'string' ? body.effort : '',
          ...(typeof body.evidenceId === 'string' && body.evidenceId.trim()
            ? {
                evidencePath: localWorkspaceTraceEvidencePath(
                  options.authorityRoot,
                  body.evidenceId.trim()
                )
              }
            : {}),
          model: typeof body.model === 'string' ? body.model : '',
          prompt: typeof body.prompt === 'string' ? body.prompt : ''
        }),
        202
      )
    } catch (error) {
      return errorResponse(context, error)
    }
  })
}
