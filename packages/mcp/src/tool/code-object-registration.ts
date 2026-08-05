import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fail, ok } from '#mcp/result'

type RpcSender = (body: Record<string, unknown>) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function codeObjectPayload(response: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(response.result)) return response.result
  const { error: _error, ok: _ok, result: _result, target: _target, ...payload } = response
  return payload
}

const exactTargetSchema = {
  content_document_id: z.string().trim().min(1),
  document_id: z.string().trim().min(1),
  page_id: z.string().trim().min(1),
  runtime_instance_id: z.string().trim().min(1),
  workspace_id: z.string().trim().min(1)
}

export const codeObjectReadInputSchema = z
  .object({
    ...exactTargetSchema,
    include_source: z.boolean().optional(),
    owner_id: z.string().trim().min(1),
    source_length: z.number().int().min(1).max(32_000).optional(),
    source_start: z.number().int().min(0).max(100_000).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.source_length !== undefined || value.source_start !== undefined) &&
      !value.include_source
    ) {
      context.addIssue({
        code: 'custom',
        message: 'source_start and source_length require include_source true.'
      })
    }
  })

function boundedCodeObjectPayload(
  payload: Record<string, unknown>,
  args: z.infer<typeof codeObjectReadInputSchema>
): Record<string, unknown> {
  if (!isRecord(payload.component)) return payload
  const component = payload.component
  const source = typeof component.source === 'string' ? component.source : null
  if (!source) return payload
  const { source: _source, ...metadata } = component
  const sourceHash = typeof component.source_hash === 'string' ? component.source_hash : undefined
  const sourceRef = {
    owner_id: args.owner_id,
    ...(sourceHash ? { source_hash: sourceHash } : {}),
    tool: 'get_code_object'
  }
  if (!args.include_source) {
    return { ...payload, component: { ...metadata, source_ref: sourceRef } }
  }
  const start = Math.min(args.source_start ?? 0, source.length)
  const length = args.source_length ?? 16_000
  const end = Math.min(source.length, start + length)
  return {
    ...payload,
    component: {
      ...metadata,
      source_excerpt: source.slice(start, end),
      source_range: {
        end,
        start,
        total: source.length,
        truncated: start > 0 || end < source.length
      },
      source_ref: sourceRef
    }
  }
}

export function registerCodeObjectReadTool(mcpServer: McpServer, sendRpc: RpcSender): void {
  mcpServer.registerTool(
    'get_code_object',
    {
      description:
        'Read one exact authored Code Object by owner ID on an exact OpenPencil target. Returns metadata, the exact SHA-256 source hash, props/state, frame readback, a resolvable source reference, and a writer-only board_build_refine_recipe_base. Source is omitted by default; request one bounded excerpt with include_source, source_start, and source_length. Never puts full large TSX into normal model context.',
      inputSchema: codeObjectReadInputSchema
    },
    async (args) => {
      try {
        const parsed = codeObjectReadInputSchema.parse(args)
        const {
          include_source: _includeSource,
          source_length: _sourceLength,
          source_start: _sourceStart,
          ...rpcArgs
        } = parsed
        const result = await sendRpc({ command: 'get_code_object', args: rpcArgs })
        const response = result as Record<string, unknown> & { error?: string; ok?: boolean }
        if (response.ok === false) return fail(new Error(response.error))
        const payload = boundedCodeObjectPayload(codeObjectPayload(response), parsed)
        return ok(
          {
            ...payload,
            ...(response.target ? { target: response.target } : {})
          },
          'get_code_object'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )
}
