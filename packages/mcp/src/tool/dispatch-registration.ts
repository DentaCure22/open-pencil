import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fail, ok } from '#mcp/result'
import { agentAuth } from '#mcp/tool/authority-client'

const DISPATCH_TIMEOUT_MS = 15_000
function connectionFailure(error: unknown, port: number): Error {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new Error(
      `The worker launcher did not answer within ${String(DISPATCH_TIMEOUT_MS / 1000)}s; the assignment may still exist — check worker conversations before retrying.`
    )
  }
  const cause =
    error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
  return new Error(
    `Could not reach the OpenPencil local authority at 127.0.0.1:${String(port)}${cause}. ` +
      'The OpenPencil dev server is not running and agent-auth.json is stale. Start the dev server, then retry.'
  )
}

export type DispatchWorkArgs = {
  continue_thread_id?: string
  done: string
  exact_words: string
  turn_ended_at: string
  turn_started_at: string
}

type DispatchResponsePayload = {
  dispatchedAt?: string
  error?: string
  jobId?: string
  state?: string
  threadId?: string
}

const isoTimestamp = z
  .string()
  .trim()
  .refine((value) => Number.isFinite(Date.parse(value)), 'Expected an ISO timestamp')

export function composeDispatchWorkPrompt(args: DispatchWorkArgs): string {
  return [
    `/skill:openpencil ${args.exact_words.trim()}`,
    '',
    `Spoken turn: ${args.turn_started_at} to ${args.turn_ended_at}`,
    `Done: ${args.done.trim()}`
  ].join('\n')
}

function dispatchRequest(args: DispatchWorkArgs, continuingThreadId?: string) {
  return continuingThreadId
    ? {
        body: {
          displayPrompt: args.exact_words.trim(),
          message: composeDispatchWorkPrompt(args)
        },
        route: `/agent-router/v1/pi/conversations/${encodeURIComponent(continuingThreadId)}/follow-up`
      }
    : {
        body: {
          displayPrompt: args.exact_words.trim(),
          effort: '',
          model: '',
          prompt: composeDispatchWorkPrompt(args)
        },
        route: '/agent-router/v1/pi/dispatch'
      }
}

async function sendDispatch(args: DispatchWorkArgs) {
  if (Date.parse(args.turn_started_at) > Date.parse(args.turn_ended_at)) {
    throw new TypeError('turn_started_at must not be after turn_ended_at.')
  }
  const auth = await agentAuth()
  const continuingThreadId = args.continue_thread_id?.trim()
  const request = dispatchRequest(args, continuingThreadId)
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${String(auth.port)}${request.route}`, {
      body: JSON.stringify(request.body),
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json'
      },
      method: 'POST',
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS)
    })
  } catch (error) {
    throw connectionFailure(error, auth.port)
  }
  const payload = (await response.json().catch(() => null)) as DispatchResponsePayload | null
  if (!response.ok) {
    throw new Error(payload?.error ?? `Worker dispatch failed (${String(response.status)}).`)
  }
  return ok(
    {
      action: continuingThreadId ? 'continue' : 'new',
      dispatchedAt: payload?.dispatchedAt ?? new Date().toISOString(),
      jobId: payload?.jobId ?? '',
      reason: continuingThreadId
        ? 'Sent the continuation directly to the existing worker.'
        : 'Started a Board worker directly.',
      state: payload?.state ?? 'queued',
      targetThreadId: payload?.threadId ?? continuingThreadId ?? ''
    },
    'dispatch_work'
  )
}

export function registerDispatchWorkTool(mcpServer: McpServer): void {
  const register = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void
  register(
    'dispatch_work',
    {
      description:
        'Send exactly what the user said directly to a Board worker. Returns assignment, not completion.',
      inputSchema: z.object({
        continue_thread_id: z
          .string()
          .trim()
          .min(1)
          .describe('Prior worker thread ID, only for a genuine continuation')
          .optional(),
        done: z.string().trim().min(1).describe('One sentence describing the finished result'),
        exact_words: z.string().trim().min(1).describe('What the user said, verbatim'),
        turn_ended_at: isoTimestamp.describe('End of the spoken turn'),
        turn_started_at: isoTimestamp.describe('Start of the spoken turn')
      })
    },
    async (args: DispatchWorkArgs) => {
      try {
        return await sendDispatch(args)
      } catch (error) {
        return fail(error)
      }
    }
  )
}
