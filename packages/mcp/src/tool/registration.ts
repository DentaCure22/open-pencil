import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { ALL_TOOLS, CODEGEN_PROMPT, type ToolDef } from '@open-pencil/core/tools'

import type { RpcJsonObject } from '#mcp/json'
import { MAX_RESULT_BYTES, fail, ok, resultTooLargeMessage, type MCPResult } from '#mcp/result'

import { registerBoardBuildTool } from './board-build-registration'
import { registerBoardTools } from './board-registration'
import { registerCodeObjectReadTool } from './code-object-registration'
import { resolveSafePath, writeToolOutput } from './output'
import { paramToZod } from './schema'

export type RpcSender = (body: Record<string, unknown>) => Promise<unknown>

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function traceGestureToolResult(payload: Record<string, unknown>): MCPResult {
  const gesture = isRecord(payload.gesture) ? payload.gesture : null
  const evidence = gesture && isRecord(gesture.evidence) ? gesture.evidence : null
  const image = evidence && isRecord(evidence.image) ? evidence.image : null
  const base64 = typeof image?.base64 === 'string' ? image.base64 : null
  const mimeType = image?.mimeType === 'image/png' ? image.mimeType : null
  if (!gesture || !evidence || !base64 || !mimeType) return ok(payload, 'get_trace_gesture')
  const imageBytes = Buffer.byteLength(base64, 'utf8')
  if (imageBytes > MAX_RESULT_BYTES) {
    return fail(
      new Error(
        resultTooLargeMessage(
          'Trace gesture evidence image',
          imageBytes,
          'Retry with include_image false; object candidates and geometry remain available.'
        )
      )
    )
  }
  const { image: _image, ...evidenceWithoutImage } = evidence
  const publicPayload = {
    ...payload,
    gesture: {
      ...gesture,
      evidence: { ...evidenceWithoutImage, image: { included: true, mimeType } }
    }
  }
  return {
    content: [
      { text: JSON.stringify(publicPayload, null, 2), type: 'text' },
      { data: base64, mimeType, type: 'image' }
    ]
  }
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
        description: toolDescription(def),
        inputSchema: def.mutates
          ? guardedMutationToolSchema(shape)
          : z.object({
              ...shape,
              ...automationTargetSchema
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

  registerBoardTools(mcpServer, sendRpc)
  registerBoardBuildTool(mcpServer, sendRpc)
  registerCodeObjectReadTool(mcpServer, sendRpc)

  register(
    'get_trace_gesture',
    {
      description:
        'Resolve one immutable OpenPencil Trace gesture by exact gesture ID or latest gesture. Defaults to a compact agent packet with exact Board origin, one region, top-level candidates, relevant connection IDs when the recorded Board is current, and an optional image content block. Set raw only for diagnostics. Read-only; normal traced mutations use the trace selector on board_build directly.',
      inputSchema: z
        .object({
          gesture_id: z.string().trim().min(1).optional(),
          include_image: z.boolean().optional(),
          latest: z.boolean().optional(),
          raw: z.boolean().optional()
        })
        .strict()
        .refine((args) => Boolean(args.gesture_id) !== (args.latest === true), {
          message: 'Provide exactly one of gesture_id or latest true'
        })
    },
    async (args: Record<string, unknown>) => {
      try {
        const result = await sendRpc({ command: 'trace_get_gesture', args })
        const response = result as {
          error?: string
          ok?: boolean
          result?: Record<string, unknown>
        }
        if (response.ok === false) return fail(new Error(response.error))
        return traceGestureToolResult(response.result ?? {})
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'insert_mermaid_diagram',
    {
      description:
        'Create one native editable Mermaid diagram on one exact ordinary OpenPencil Board, then retain the returned owner_id. Requires the exact runtime, workspace, runtime document, stable content document, page, current Board revision, and a stable request ID; active-Board fallback is disabled. On later calls update that owner in place and omit x/y unless repositioning; after every create or update call get_mermaid_source and require reconciliation status "current". Set allow_additional_owner only when intentionally creating multiple diagrams on the same board.',
      inputSchema: guardedMutationToolSchema({
        source: z.string().trim().min(1).describe('Complete Mermaid diagram source'),
        owner_id: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Retained Mermaid owner ID to update in place; capture it from the first create response'
          )
          .optional(),
        anchor_id: z
          .string()
          .trim()
          .min(1)
          .describe(
            'Exact singleton selected native object to place a new diagram beside; cannot be combined with owner_id, x, or y'
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
          .optional()
      })
    },
    async (args: Record<string, unknown>) => {
      try {
        const { target, args: toolArgs, mutation } = splitAutomationTarget(args)
        const result = await sendRpc({
          command: 'insert_mermaid_diagram',
          args: { ...target, ...toolArgs, mutation }
        })
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
        'Retrieve bounded, read-only OpenPencil Trace evidence without first resolving a runtime or Board. Each match returns the stable workspace, document, and Board scope where the gesture or activity was recorded. Use exactly one selector: query or task_cursor for ranked history, or latest_spoken_turn, spoken_turn_id, or spoken_text after an explicit request about what was shown while speaking. Spoken selectors read only the recorded volatile turn window. Never call continuously; matched, ambiguous, empty, and error are returned honestly.',
      inputSchema: z
        .object({
          latest_spoken_turn: z
            .boolean()
            .describe('Resolve the latest non-expired spoken Trace turn and its source Board')
            .optional(),
          limit: z.number().int().min(1).max(5).optional(),
          query: z.string().trim().min(1).optional(),
          since: z.string().describe('Optional inclusive ISO timestamp').optional(),
          spoken_text: z
            .string()
            .trim()
            .min(1)
            .describe('Resolve one non-expired spoken turn containing this quoted text')
            .optional(),
          spoken_turn_id: z
            .string()
            .trim()
            .min(1)
            .describe('Resolve one exact non-expired spoken Trace turn ID')
            .optional(),
          task_cursor: z.string().trim().min(1).optional(),
          until: z.string().describe('Optional inclusive ISO timestamp').optional()
        })
        .refine(
          (args) =>
            [
              Boolean(args.query),
              Boolean(args.task_cursor),
              args.latest_spoken_turn === true,
              Boolean(args.spoken_text),
              Boolean(args.spoken_turn_id)
            ].filter(Boolean).length === 1,
          {
            message:
              'Provide exactly one of query, task_cursor, latest_spoken_turn, spoken_turn_id, or spoken_text'
          }
        )
        .refine(
          (args) => {
            const hasSpokenTurn = Boolean(
              args.latest_spoken_turn || args.spoken_text || args.spoken_turn_id
            )
            return !hasSpokenTurn || (!args.since && !args.until)
          },
          {
            message: 'Spoken-turn retrieval cannot be combined with since or until'
          }
        )
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
        return ok(response.result ?? {}, 'query_trace_history')
      } catch (error) {
        return fail(error)
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
