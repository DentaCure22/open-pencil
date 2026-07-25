import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ALL_TOOLS, CODEGEN_PROMPT } from '@open-pencil/core/tools'

import type { RpcJsonObject } from '#mcp/json'
import { MAX_RESULT_BYTES, fail, ok, resultTooLargeMessage } from '#mcp/result'

import { resolveSafePath, writeToolOutput } from './output'
import { paramToZod } from './schema'
import { registerSmylrSemanticTools } from './smylr-semantic-registration'

export type RpcSender = (body: Record<string, unknown>) => Promise<unknown>

const automationTargetSchema = {
  document_id: z.string().describe('Optional OpenPencil document/tab ID to target').optional(),
  page_id: z.string().describe('Optional page ID to target within the document').optional(),
  workspace_id: z
    .string()
    .describe('Stable OpenPencil workspace ID; preferred for normal Board work')
    .optional()
}

const automationMutationSchema = {
  expected_revision: z
    .number()
    .int()
    .nonnegative()
    .describe('Board revision returned by the latest OpenPencil read; stale edits are rejected')
    .optional(),
  request_id: z.string().describe('Stable ID for this proposed board mutation').optional(),
  task_id: z.string().describe('Delegated agent task ID, when applicable').optional(),
  trace_id: z.string().describe('Narrated Trace ID that requested this mutation').optional()
}

const traceRegionSchema = z.object({
  height: z.number().nonnegative(),
  width: z.number().nonnegative(),
  x: z.number(),
  y: z.number()
})

function splitAutomationTarget(args: Record<string, unknown>): {
  target: { document_id?: string; page_id?: string; workspace_id?: string }
  args: Record<string, unknown>
  mutation: {
    expectedRevision?: number
    requestId?: string
    taskId?: string
    traceId?: string
  }
} {
  const {
    document_id,
    expected_revision,
    page_id,
    request_id,
    task_id,
    trace_id,
    workspace_id,
    ...rest
  } = args
  return {
    target: {
      ...(typeof document_id === 'string' ? { document_id } : {}),
      ...(typeof page_id === 'string' ? { page_id } : {}),
      ...(typeof workspace_id === 'string' ? { workspace_id } : {})
    },
    args: rest,
    mutation: {
      ...(typeof expected_revision === 'number' ? { expectedRevision: expected_revision } : {}),
      ...(typeof request_id === 'string' ? { requestId: request_id } : {}),
      ...(typeof task_id === 'string' ? { taskId: task_id } : {}),
      ...(typeof trace_id === 'string' ? { traceId: trace_id } : {})
    }
  }
}

export interface RegisterToolsOptions {
  enableEval: boolean
  mcpRoot?: string | null
  sendRpc: RpcSender
}

export function registerTools(mcpServer: McpServer, options: RegisterToolsOptions) {
  const { enableEval, sendRpc } = options
  const resolvedRoot = options.mcpRoot ? resolve(options.mcpRoot) : null
  const register = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void

  for (const def of ALL_TOOLS) {
    if (!enableEval && def.name === 'eval') continue
    const shape: Record<string, z.ZodType> = {}
    for (const [key, param] of Object.entries(def.params)) {
      shape[key] = paramToZod(param)
    }
    register(
      def.name,
      {
        description: def.description,
        inputSchema: z.object({
          ...shape,
          ...automationTargetSchema,
          ...(def.mutates ? automationMutationSchema : {})
        })
      },
      async (args: Record<string, unknown>) => {
        try {
          const { target, args: toolArgs, mutation } = splitAutomationTarget(args)
          const result = await sendRpc({
            command: 'tool',
            args: { ...target, mutation, name: def.name, args: toolArgs }
          })
          const res = result as { ok?: boolean; result?: unknown; error?: string; target?: unknown }
          if (res.ok === false) return fail(new Error(res.error))
          const r = res.result as RpcJsonObject | undefined
          const filePath = typeof toolArgs.path === 'string' ? toolArgs.path : null
          if (r && filePath && resolvedRoot) {
            const written = await writeToolOutput(def.name, r, filePath, resolvedRoot)
            if (written) return written
          }
          if (r && 'base64' in r && 'mimeType' in r) {
            const base64 = String(r.base64)
            const bytes = Buffer.byteLength(base64, 'utf8')
            if (bytes > MAX_RESULT_BYTES) {
              return fail(
                new Error(
                  resultTooLargeMessage(
                    `Image from "${def.name}"`,
                    bytes,
                    'Export a smaller region or lower the scale/resolution.'
                  )
                )
              )
            }
            return {
              content: [
                {
                  type: 'image' as const,
                  data: base64,
                  mimeType: r.mimeType as string
                }
              ]
            }
          }
          return ok(
            r && typeof r === 'object'
              ? { ...r, ...(res.target ? { target: res.target } : {}) }
              : { value: r, ...(res.target ? { target: res.target } : {}) },
            def.name
          )
        } catch (e) {
          return fail(e)
        }
      }
    )
  }

  registerSmylrSemanticTools(mcpServer, sendRpc)

  register(
    'insert_mermaid_diagram',
    {
      description:
        'Create one native editable Mermaid diagram on an ordinary OpenPencil Board inside a Project, then retain the returned owner_id. On later calls update that owner in place and omit x/y unless repositioning; after every create or update call get_mermaid_source and require reconciliation status "current". Set allow_additional_owner only when intentionally creating multiple diagrams on the same board.',
      inputSchema: z.object({
        source: z.string().trim().min(1).describe('Complete Mermaid diagram source'),
        board_name: z
          .string()
          .trim()
          .min(1)
          .describe('Ordinary OpenPencil Board name to target')
          .optional(),
        project_name: z
          .string()
          .trim()
          .min(1)
          .describe('Project containing the ordinary Board')
          .optional(),
        owner_id: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Retained Mermaid owner ID to update in place; capture it from the first create response'
          )
          .optional(),
        allow_additional_owner: z
          .boolean()
          .describe(
            'Explicit opt-in to create another Mermaid owner on a Board that already has one'
          )
          .optional(),
        x: z.number().finite().describe('Optional canvas x coordinate; provide with y').optional(),
        y: z.number().finite().describe('Optional canvas y coordinate; provide with x').optional(),
        zoom_to_selection: z
          .boolean()
          .describe('Zoom to the inserted diagram; defaults to true')
          .optional(),
        ...automationTargetSchema
      })
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await sendRpc({ command: 'insert_mermaid_diagram', args })
        const response = result as {
          error?: string
          ok?: boolean
          result?: Record<string, unknown>
          target?: unknown
        }
        if (response.ok === false) return fail(new Error(response.error))
        return ok(
          {
            ...response.result,
            ...(response.target ? { target: response.target } : {})
          },
          'insert_mermaid_diagram'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'get_mermaid_source',
    {
      description:
        'Read retained Mermaid source, parser, appearance, stable diagram identity, native layer IDs, bounds, and computed source-reconciliation status for one Mermaid owner. After every insert or update, call this with the returned owner_id and require reconciliation status "current" before treating the board as reconciled.',
      inputSchema: z.object({
        owner_id: z.string().trim().min(1).describe('Exact Mermaid owner ID'),
        ...automationTargetSchema
      })
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await sendRpc({ command: 'get_mermaid_source', args })
        const response = result as {
          error?: string
          ok?: boolean
          result?: Record<string, unknown>
          target?: unknown
        }
        if (response.ok === false) return fail(new Error(response.error))
        return ok(
          {
            ...response.result,
            ...(response.target ? { target: response.target } : {})
          },
          'get_mermaid_source'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'query_trace_history',
    {
      description:
        'Retrieve a small ranked slice of durable OpenPencil Trace history for the exact target document and page, including page-space anchors for Focus gestures and explicit target clicks. Use task_cursor for follow-up commands; empty and ambiguous matches are returned explicitly.',
      inputSchema: z
        .object({
          include_current_context: z
            .boolean()
            .describe('Use the current selection and viewport as ranking context')
            .optional(),
          limit: z.number().int().min(1).max(5).optional(),
          query: z.string().trim().min(1).optional(),
          since: z.string().describe('Optional inclusive ISO timestamp').optional(),
          task_cursor: z.string().trim().min(1).optional(),
          traced_region: traceRegionSchema.optional(),
          until: z.string().describe('Optional inclusive ISO timestamp').optional(),
          ...automationTargetSchema
        })
        .refine((args) => Boolean(args.query || args.task_cursor), {
          message: 'Provide query or task_cursor'
        })
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await sendRpc({ command: 'trace_query', args })
        const response = result as {
          error?: string
          ok?: boolean
          result?: Record<string, unknown>
          target?: unknown
        }
        if (response.ok === false) return fail(new Error(response.error))
        return ok(
          {
            ...response.result,
            ...(response.target ? { target: response.target } : {})
          },
          'query_trace_history'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'list_documents',
    {
      description:
        'List the persistent OpenPencil workspace plus explicitly opened documents, with stable workspace, document, and page IDs.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        const result = await sendRpc({ command: 'list_documents', args: {} })
        const res = result as { ok?: boolean; result?: unknown; error?: string }
        if (res.ok === false) return fail(new Error(res.error))
        return ok(res.result ?? {})
      } catch (e) {
        return fail(e)
      }
    }
  )

  register(
    'save_file',
    {
      description: resolvedRoot
        ? `Save the current document to disk. If path is provided, it must be inside ${resolvedRoot}.`
        : 'Save the current document to disk. Uses the existing file path if available, otherwise prompts for a location.',
      inputSchema: resolvedRoot
        ? z.object({
            path: z.string().describe('Optional absolute path for the .fig file').optional(),
            ...automationTargetSchema
          })
        : z.object({ ...automationTargetSchema })
    },
    async (args: {
      path?: string
      document_id?: string
      page_id?: string
      workspace_id?: string
    }) => {
      try {
        const safePath =
          args.path && resolvedRoot ? resolveSafePath(args.path, resolvedRoot) : undefined
        const { target } = splitAutomationTarget(args)
        const result = await sendRpc({ command: 'save_file', args: { ...target, path: safePath } })
        const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
        if (res.ok === false) return fail(new Error(res.error))
        return ok({
          saved: true,
          ...(safePath ? { path: safePath } : {}),
          ...(res.target ? { target: res.target } : {})
        })
      } catch (e) {
        return fail(e)
      }
    }
  )

  if (resolvedRoot) {
    register(
      'open_file',
      {
        description: `Open a .fig or .pen file from disk into a new tab. Path must be inside ${resolvedRoot}.`,
        inputSchema: z.object({
          path: z.string().describe('Absolute path to the design file'),
          ...automationTargetSchema
        })
      },
      async (args: {
        path: string
        document_id?: string
        page_id?: string
        workspace_id?: string
      }) => {
        try {
          const safe = resolveSafePath(args.path, resolvedRoot)
          const { target } = splitAutomationTarget(args)
          const result = await sendRpc({ command: 'open_file', args: { ...target, path: safe } })
          const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
          if (res.ok === false) return fail(new Error(res.error))
          return ok({ opened: true, ...(res.target ? { target: res.target } : {}) })
        } catch (e) {
          return fail(e)
        }
      }
    )

    register(
      'new_document',
      {
        description: `Create a new empty document. Optionally set a save path inside ${resolvedRoot}.`,
        inputSchema: z.object({
          path: z.string().describe('Optional absolute path for the new file').optional(),
          ...automationTargetSchema
        })
      },
      async (args: {
        path?: string
        document_id?: string
        page_id?: string
        workspace_id?: string
      }) => {
        try {
          const safePath = args.path ? resolveSafePath(args.path, resolvedRoot) : undefined
          const { target } = splitAutomationTarget(args)
          const result = await sendRpc({
            command: 'new_document',
            args: { ...target, path: safePath }
          })
          const res = result as { ok?: boolean; result?: unknown; target?: unknown; error?: string }
          if (res.ok === false) return fail(new Error(res.error))
          return ok({ created: true, ...(res.target ? { target: res.target } : {}) })
        } catch (e) {
          return fail(e)
        }
      }
    )
  }

  register(
    'get_codegen_prompt',
    {
      description:
        'Get design-to-code generation guidelines. Call before generating frontend code.',
      inputSchema: z.object({})
    },
    async () => ok({ prompt: CODEGEN_PROMPT })
  )
}
