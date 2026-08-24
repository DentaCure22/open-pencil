import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ALL_TOOLS, type ToolDef } from '@open-pencil/core/tools'

import type { RpcJsonObject } from '#mcp/json'
import { MAX_RESULT_BYTES, fail, ok, resultTooLargeMessage } from '#mcp/result'

import { registerDispatchWorkTool } from './dispatch-registration'
import { writeToolOutput } from './output'
import { paramToZod } from './schema'
import {
  ADVERTISED_BOARD_TOOL_NAMES,
  INVOKE_TOOL_NAME,
  SEARCH_TOOLS_NAME,
  findOpenPencilTool,
  searchOpenPencilTools
} from './search'

export function mcpToolSearchEnabled(
  env: NodeJS.ProcessEnv = process.env,
  override?: boolean
): boolean {
  if (typeof override === 'boolean') return override
  const raw = env.OPENPENCIL_MCP_TOOL_SEARCH?.trim().toLowerCase()
  return raw !== '0' && raw !== 'false' && raw !== 'off'
}

export type RpcSender = (body: Record<string, unknown>) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const advertisedBoardToolNameSet = new Set<string>(ADVERTISED_BOARD_TOOL_NAMES)

const automationTargetSchema = {
  content_document_id: z
    .string()
    .describe('Stable persisted content document ID returned by board_context')
    .optional(),
  document_id: z.string().describe('Optional OpenPencil document/tab ID to target').optional(),
  page_id: z.string().describe('Optional page ID to target within the document').optional(),
  runtime_instance_id: z
    .string()
    .describe('Exact running OpenPencil client returned by board_context')
    .optional(),
  workspace_id: z
    .string()
    .describe('Stable OpenPencil workspace ID; preferred for normal Board work')
    .optional()
}

const invokeToolSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).optional(),
  name: z.string().trim().min(1),
  ...automationTargetSchema,
  context_token: z.string().trim().min(1).optional(),
  expected_revision: z.number().int().nonnegative().optional(),
  request_id: z.string().trim().min(1).optional(),
  task_id: z.string().trim().min(1).optional(),
  trace_id: z.string().trim().min(1).optional()
})

function guardedMutationToolSchema(shape: Record<string, z.ZodType>) {
  return z.object({
    ...shape,
    content_document_id: z.string().trim().min(1),
    context_token: z
      .string()
      .trim()
      .min(1)
      .describe('Board context token; required when the target is persisted authority')
      .optional(),
    document_id: z.string().trim().min(1),
    page_id: z.string().trim().min(1),
    runtime_instance_id: z.string().trim().min(1),
    workspace_id: z.string().trim().min(1),
    expected_revision: z.number().int().nonnegative(),
    request_id: z.string().trim().min(1),
    task_id: z.string().trim().min(1).optional(),
    trace_id: z.string().trim().min(1).optional()
  })
}

function toolDescription(def: ToolDef): string {
  if (!def.mutates) return def.description
  const guard =
    'Requires the exact runtime, workspace, runtime document, stable content document, page, current Board revision, and a stable request ID; active-Board fallback is disabled.'
  return def.execute.constructor.name === 'AsyncFunction'
    ? `${def.description} ${guard} Guarded OpenPencil automation currently refuses this asynchronous mutation until its applied receipt can be durably acknowledged.`
    : `${def.description} ${guard}`
}

function splitAutomationTarget(args: Record<string, unknown>): {
  target: {
    content_document_id?: string
    context_token?: string
    document_id?: string
    page_id?: string
    runtime_instance_id?: string
    workspace_id?: string
  }
  args: Record<string, unknown>
  mutation: {
    expectedRevision?: number
    requestId?: string
    taskId?: string
    traceId?: string
  }
} {
  const {
    content_document_id,
    context_token,
    document_id,
    expected_revision,
    page_id,
    request_id,
    runtime_instance_id,
    task_id,
    trace_id,
    workspace_id,
    ...rest
  } = args
  return {
    target: {
      ...(typeof content_document_id === 'string' ? { content_document_id } : {}),
      ...(typeof context_token === 'string' ? { context_token } : {}),
      ...(typeof document_id === 'string' ? { document_id } : {}),
      ...(typeof page_id === 'string' ? { page_id } : {}),
      ...(typeof runtime_instance_id === 'string' ? { runtime_instance_id } : {}),
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
  toolSearch?: boolean
}

export function registerTools(mcpServer: McpServer, options: RegisterToolsOptions) {
  const { enableEval, sendRpc } = options
  const resolvedRoot = options.mcpRoot ? resolve(options.mcpRoot) : null
  const toolSearch = mcpToolSearchEnabled(process.env, options.toolSearch)
  const register = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void

  const executeTool = async (def: ToolDef, args: Record<string, unknown>) => {
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

  const registerNamedTool = (def: ToolDef) => {
    if (!enableEval && def.name === 'eval') return
    const shape: Record<string, z.ZodType> = {}
    for (const [key, param] of Object.entries(def.params)) {
      shape[key] = paramToZod(param)
    }
    register(
      def.name,
      {
        description: toolDescription(def),
        inputSchema: def.mutates
          ? guardedMutationToolSchema(shape)
          : z.object({
              ...shape,
              ...automationTargetSchema
            })
      },
      async (args: Record<string, unknown>) => executeTool(def, args)
    )
  }

  for (const def of ALL_TOOLS) {
    if (toolSearch && !advertisedBoardToolNameSet.has(def.name)) {
      continue
    }
    registerNamedTool(def)
  }

  register(
    SEARCH_TOOLS_NAME,
    {
      description: toolSearch
        ? 'Search the OpenPencil tool catalog by task. Returns names and short descriptions. Call invoke_tool with a returned name to run it.'
        : 'Search the OpenPencil tool catalog by task. Returns names and short descriptions. Then call the matching tool by name.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(16).optional(),
        query: z.string().trim().min(1).describe('What you need to do on the Board')
      })
    },
    (args: { limit?: number; query: string }) =>
      ok({
        tools: searchOpenPencilTools(args.query, args.limit),
        use: 'Call invoke_tool with name and the tool arguments, including Board target fields for mutations.'
      })
  )

  if (toolSearch) {
    register(
      INVOKE_TOOL_NAME,
      {
        description:
          'Run an OpenPencil catalog tool by name after search_tools. Mutations still need the exact Board target and request ID.',
        inputSchema: invokeToolSchema
      },
      async (args: Record<string, unknown>) => {
        const name = typeof args.name === 'string' ? args.name : ''
        const def = findOpenPencilTool(name)
        if (!def) return fail(new Error(`Unknown tool "${name}". Search with search_tools first.`))
        if (!enableEval && def.name === 'eval') {
          return fail(new Error('eval is disabled on this server.'))
        }
        const forwarded = isRecord(args.arguments) ? { ...args.arguments } : {}
        for (const [key, value] of Object.entries(args)) {
          if (key === 'name' || key === 'arguments') continue
          if (forwarded[key] === undefined) forwarded[key] = value
        }
        if (def.mutates) {
          const required = [
            'content_document_id',
            'document_id',
            'page_id',
            'runtime_instance_id',
            'workspace_id',
            'expected_revision',
            'request_id'
          ]
          const missing = required.filter((key) => forwarded[key] === undefined)
          if (missing.length) {
            return fail(new Error(`invoke_tool ${def.name} is missing ${missing.join(', ')}.`))
          }
        }
        return executeTool(def, forwarded)
      }
    )
  }

  registerDispatchWorkTool(mcpServer)

  register(
    'set_theme',
    {
      description: 'Switch the OpenPencil editor theme.',
      inputSchema: z.object({ mode: z.enum(['light', 'dark', 'system']) })
    },
    async (args: { mode: string }) => {
      try {
        const result = await sendRpc({ command: 'set_theme', args })
        const res = result as { ok?: boolean; result?: unknown; error?: string }
        if (res.ok === false) return fail(new Error(res.error))
        return ok(res.result ?? {})
      } catch (e) {
        return fail(e)
      }
    }
  )

  register(
    'list_documents',
    {
      description:
        'List the persistent OpenPencil workspace plus explicitly opened documents, with runtime tab, stable content document, workspace, and page IDs.',
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
}
