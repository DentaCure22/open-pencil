import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fail, ok } from '#mcp/result'

type RpcSender = (body: Record<string, unknown>) => Promise<unknown>

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>
type DurableTargetSchemaOptions = { strict?: boolean }

const contextTargetFields = {
  content_document_id: z.string().trim().min(1).optional(),
  document_id: z.string().trim().min(1).optional(),
  page_id: z.string().trim().min(1),
  runtime_instance_id: z.string().trim().min(1).optional(),
  workspace_id: z.string().trim().min(1).optional()
}

const currentVisibleContextSchema = z
  .object({
    runtime_instance_id: z.string().trim().min(1).optional(),
    target: z.literal('current_visible')
  })
  .strict()

const pageRegionSchema = z
  .object({
    height: z.number().finite().positive(),
    width: z.number().finite().positive(),
    x: z.number().finite(),
    y: z.number().finite()
  })
  .strict()

const boardReadQuerySchema = z
  .object({
    name: z.string().trim().min(1).max(240).optional(),
    parent_id: z.string().trim().min(1).max(240).optional(),
    region: pageRegionSchema.optional(),
    text: z.string().trim().min(1).max(240).optional(),
    types: z.array(z.string().trim().min(1)).min(1).max(16).optional()
  })
  .strict()
  .refine((query) => Object.keys(query).length > 0, {
    message: 'query requires at least one filter.'
  })

const exactTargetFields = {
  content_document_id: z.string().trim().min(1),
  document_id: z.string().trim().min(1),
  page_id: z.string().trim().min(1),
  runtime_instance_id: z.string().trim().min(1),
  workspace_id: z.string().trim().min(1)
}

const connectObjectsBaseSchema = z
  .object({
    ...exactTargetFields,
    context_token: z.string().trim().min(1),
    expected_revision: z.number().int().nonnegative()
  })
  .strict()
  .describe('Copy board_build.connect_objects_base as one atomic packet.')

const nativeTextOperationSchema = z.object({
  kind: z.literal('artifact.create'),
  anchor_id: z.string().trim().min(1),
  artifact: z.object({
    kind: z.literal('native_text'),
    text: z.string().trim().min(1),
    name: z.string().trim().min(1).optional(),
    font_size: z.number().finite().min(8).max(256).optional(),
    max_width: z.number().finite().min(48).max(2_000).optional()
  }),
  placement: z
    .object({
      clearance: z.number().finite().min(0).max(512).optional(),
      preferred_directions: z
        .array(z.enum(['above', 'below', 'left', 'right']))
        .length(4)
        .optional()
    })
    .optional()
})

const placementTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('auto') }).strict(),
  z.object({ kind: z.literal('point'), x: z.number().finite(), y: z.number().finite() }).strict(),
  z.object({ kind: z.literal('relative'), object_id: z.string().trim().min(1) }).strict(),
  z
    .object({
      height: z.number().finite().positive(),
      kind: z.literal('region'),
      width: z.number().finite().positive(),
      x: z.number().finite(),
      y: z.number().finite()
    })
    .strict()
])

const nativeCardOperationSchema = z.object({
  kind: z.literal('artifact.create'),
  anchor_id: z.string().trim().min(1).optional(),
  artifact: z.object({
    body: z.string().trim().min(1).max(1_200),
    kind: z.literal('native_card'),
    name: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(120),
    width: z.number().finite().min(240).max(640).optional()
  }),
  placement: z
    .object({
      clearance: z.number().finite().min(0).max(512).optional(),
      preferred_directions: z
        .array(z.enum(['above', 'below', 'left', 'right']))
        .length(4)
        .optional(),
      target: placementTargetSchema.optional()
    })
    .optional()
})

const objectUpdateOperationSchema = z
  .object({
    kind: z.literal('object.update'),
    object_id: z.string().trim().min(1),
    patch: z
      .object({
        cornerRadius: z.number().finite().min(0).max(100_000).optional(),
        fill: z.string().trim().min(1).max(32).optional(),
        locked: z.boolean().optional(),
        name: z.string().trim().min(1).max(240).optional(),
        opacity: z.number().finite().min(0).max(1).optional(),
        text: z.string().trim().min(1).max(10_000).optional(),
        visible: z.boolean().optional()
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0, 'object.update patch cannot be empty.')
  })
  .strict()

const objectMoveOperationSchema = z
  .object({
    kind: z.literal('object.move'),
    object_id: z.string().trim().min(1),
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000)
  })
  .strict()

const objectResizeOperationSchema = z
  .object({
    height: z.number().finite().min(1).max(100_000),
    kind: z.literal('object.resize'),
    object_id: z.string().trim().min(1),
    width: z.number().finite().min(1).max(100_000)
  })
  .strict()

const objectDeleteOperationSchema = z
  .object({
    kind: z.literal('object.delete'),
    object_id: z.string().trim().min(1)
  })
  .strict()

const objectDuplicateOperationSchema = z
  .object({
    kind: z.literal('object.duplicate'),
    object_id: z.string().trim().min(1),
    offset_x: z.number().finite().min(-10_000).max(10_000).optional(),
    offset_y: z.number().finite().min(-10_000).max(10_000).optional()
  })
  .strict()

const boardChangeOperationSchema = z
  .union([
    nativeTextOperationSchema,
    nativeCardOperationSchema,
    objectUpdateOperationSchema,
    objectMoveOperationSchema,
    objectResizeOperationSchema,
    objectDeleteOperationSchema,
    objectDuplicateOperationSchema
  ])
  .superRefine((value, context) => {
    if (Boolean(value.anchor_id) === Boolean(value.placement?.target)) {
      context.addIssue({
        code: 'custom',
        message: 'native_card requires exactly one of anchor_id or placement.target.'
      })
    }
  })

function requireDurableTarget<T extends z.ZodRawShape>(
  shape: T,
  options: DurableTargetSchemaOptions = {}
) {
  const schema = options.strict ? z.object(shape).strict() : z.object(shape)
  return schema.refine(
    (args) =>
      ('workspace_id' in args && Boolean(args.workspace_id)) ||
      ('document_id' in args && Boolean(args.document_id)),
    {
      message:
        'Provide workspace_id or document_id; implicit active-document targeting is disabled.'
    }
  )
}

const connectObjectsLogicalShape = {
  request_id: z.string().trim().min(1),
  source_id: z.string().trim().min(1),
  target_id: z.string().trim().min(1),
  kind: z.enum(['visual', 'data', 'action']),
  label: z.string().trim().min(1).max(80).optional(),
  source_port: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u)
    .optional(),
  target_port: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u)
    .optional(),
  automatic: z
    .boolean()
    .optional()
    .describe('Forbidden true for visual; required explicitly for data and action.'),
  task_id: z.string().trim().min(1).optional(),
  trace_id: z.string().trim().min(1).optional()
}

function validateConnectionActivation(
  args: { automatic?: boolean; kind: 'action' | 'data' | 'visual' },
  context: z.RefinementCtx
) {
  if (args.kind === 'visual' && args.automatic === true) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Visual connections cannot be automatic.',
      path: ['automatic']
    })
  }
  if (args.kind !== 'visual' && typeof args.automatic !== 'boolean') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Data and action connections require explicit automatic true or false.',
      path: ['automatic']
    })
  }
}

const flatConnectObjectsInputSchema = requireDurableTarget(
  {
    ...exactTargetFields,
    context_token: z.string().trim().min(1),
    expected_revision: z.number().int().nonnegative(),
    ...connectObjectsLogicalShape
  },
  { strict: true }
).superRefine(validateConnectionActivation)

const packetConnectObjectsInputSchema = z
  .object({ base: connectObjectsBaseSchema, ...connectObjectsLogicalShape })
  .strict()
  .superRefine(validateConnectionActivation)

const connectObjectsInputSchema = z
  .union([packetConnectObjectsInputSchema, flatConnectObjectsInputSchema])
  .describe('Prefer base with the complete board_build.connect_objects_base packet.')

const boardFixtureBaseShape = {
  ...exactTargetFields,
  context_token: z.string().trim().min(1)
}

export const boardFixtureInputSchema = z.discriminatedUnion('operation', [
  z.object({ ...boardFixtureBaseShape, operation: z.literal('capture') }).strict(),
  z
    .object({
      ...boardFixtureBaseShape,
      fixture_id: z.string().trim().min(1),
      operation: z.literal('assert')
    })
    .strict(),
  z
    .object({
      ...boardFixtureBaseShape,
      expected_revision: z.number().int().nonnegative(),
      fixture_id: z.string().trim().min(1),
      operation: z.literal('reset'),
      request_id: z.string().trim().min(1)
    })
    .strict()
])

function normalizedConnectionArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (!('base' in args)) return args
  const { base, ...logical } = args
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return args
  return { ...base, ...logical }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

type RpcEnvelope = {
  result: Record<string, unknown>
  target?: unknown
}

async function rpcEnvelope(
  sendRpc: RpcSender,
  command: string,
  args: Record<string, unknown>
): Promise<RpcEnvelope> {
  const response = (await sendRpc({ command, args })) as {
    error?: string
    ok?: boolean
    result?: unknown
    target?: unknown
  }
  if (response.ok === false) throw new Error(response.error || `${command} failed.`)
  if (!isRecord(response.result)) throw new Error(`${command} returned no result.`)
  return {
    result: response.result,
    ...(response.target ? { target: response.target } : {})
  }
}

async function invoke(sendRpc: RpcSender, command: string, args: Record<string, unknown>) {
  try {
    const response = await rpcEnvelope(sendRpc, command, args)
    return ok(
      {
        ...response.result,
        ...(response.target ? { target: response.target } : {})
      },
      command
    )
  } catch (error) {
    return fail(error)
  }
}

export function registerBoardTools(mcpServer: McpServer, sendRpc: RpcSender) {
  const register = mcpServer.registerTool.bind(mcpServer) as (
    name: string,
    options: { description: string; inputSchema: z.ZodType },
    handler: ToolHandler
  ) => void

  register(
    'board_context',
    {
      description:
        'Acquire the exact short-lived Board context before a read or build. Use target current_visible for the user-visible Board, or provide a stable workspace/document plus page; omit runtime only when one OpenPencil client is connected. Returns exact identity, selection, a bounded nearby page-owned summary, appearance, capabilities, revision, and a copy-ready board_build_base. Read-only.',
      inputSchema: z.union([
        currentVisibleContextSchema,
        requireDurableTarget(contextTargetFields, { strict: true })
      ])
    },
    (args) => invoke(sendRpc, 'board_context', args)
  )

  register(
    'board_read',
    {
      description:
        'Read bounded semantic Board state using exact identity and a context token. Reads selection by default, exact known objects with objects scope, an explicit page scope, or one deterministic filtered query across hierarchy, type, name/text, and spatial bounds. Query reads support compact projections, deterministic ordering, and a server-enforced 256–6000 token budget in addition to the 1–100 item limit. Returns exact matched count, index revision, completeness, and truncation reason. This command does not mutate the Board or query Trace.',
      inputSchema: requireDurableTarget({
        ...exactTargetFields,
        context_token: z.string().trim().min(1),
        scope: z.enum(['selection', 'page', 'objects', 'query']).optional(),
        object_ids: z.array(z.string().trim().min(1)).min(1).max(25).optional(),
        query: boardReadQuerySchema.optional(),
        projection: z.enum(['id_only', 'summary', 'geometry', 'detail']).optional(),
        sort: z.enum(['document', 'name', 'x', 'y']).optional(),
        token_budget: z.number().int().min(256).max(6_000).optional(),
        limit: z.number().int().min(1).max(100).optional()
      }).superRefine((value, context) => {
        if ((value.scope === 'objects') !== Boolean(value.object_ids)) {
          context.addIssue({
            code: 'custom',
            message: 'objects scope requires object_ids, and object_ids requires objects scope.'
          })
        }
        if (value.object_ids && new Set(value.object_ids).size !== value.object_ids.length) {
          context.addIssue({ code: 'custom', message: 'object_ids must be unique.' })
        }
        if ((value.scope === 'query') !== Boolean(value.query)) {
          context.addIssue({
            code: 'custom',
            message: 'query scope requires query, and query requires query scope.'
          })
        }
        if (value.scope !== 'query' && value.sort !== undefined) {
          context.addIssue({
            code: 'custom',
            message: 'sort requires query scope.'
          })
        }
      })
    },
    (args) => invoke(sendRpc, 'board_read', args)
  )

  register(
    'board_fixture',
    {
      description:
        'Evaluator control-plane tool for persisted local authority only. Capture issues an authority-owned bounded fixture token for the exact page subtree, Code Object metadata, and page-owned Object Graph records. Assert compares a receipt-insensitive semantic hash. Reset requires the same token, exact target, current context/revision, and stable request ID; it restores the captured semantic state durably while preserving agent-tool receipts. This is an external fixture reset, not normal editor Undo or pixel proof. Live runtimes fail explicitly.',
      inputSchema: boardFixtureInputSchema
    },
    (args) => invoke(sendRpc, 'board_fixture', args)
  )

  register(
    'board_change',
    {
      description:
        'Apply one guarded semantic Board change using exact context, runtime, target, revision, and stable request ID. Creation supports native editable text and bounded native cards. Existing top-level native objects can be updated, moved, resized, deleted, or duplicated when the execution surface advertises the matching capability; Code Objects retain their dedicated contract. Reusing a request ID replays its durable receipt instead of repeating the effect. Never use raw eval as a substitute.',
      inputSchema: requireDurableTarget({
        ...exactTargetFields,
        context_token: z.string().trim().min(1),
        expected_revision: z.number().int().nonnegative(),
        request_id: z.string().trim().min(1),
        operation: boardChangeOperationSchema,
        task_id: z.string().trim().min(1).optional(),
        trace_id: z.string().trim().min(1).optional(),
        visual: z
          .union([
            z.object({ profile: z.literal('local-legible-text-v1') }),
            z.object({ profile: z.literal('local-legible-card-v1') })
          ])
          .optional()
      })
    },
    (args) => invoke(sendRpc, 'board_change', args)
  )

  register(
    'board_present',
    {
      description:
        'Select and reveal exact native Board objects, then return a presentation-frame acknowledgment, viewport, selection, and viewport intersection. This changes attention only and does not mutate the Board graph.',
      inputSchema: requireDurableTarget({
        ...exactTargetFields,
        context_token: z.string().trim().min(1),
        object_ids: z.array(z.string().trim().min(1)).min(1).max(100)
      })
    },
    (args) => invoke(sendRpc, 'board_present', args)
  )

  register(
    'connect_objects',
    {
      description:
        'Create one meaningful page-owned Object Graph connection. Prefer the fresh connect_objects_base returned by board_build; reacquire context only when that base is absent or stale. Visual links cannot be automatic; data/action links require explicit automatic. Returns authoritative semantic, React Flow presentation, persistence, continuation, and timing proof with normal Undo and idempotent replay.',
      inputSchema: connectObjectsInputSchema
    },
    (args) => invoke(sendRpc, 'connect_objects', normalizedConnectionArgs(args))
  )

  register(
    'board_verify',
    {
      description:
        'Verify one stable Board request ID against persisted native-object receipts on the exact Board. Returns matched, ambiguous, or empty honestly and does not mutate the Board.',
      inputSchema: requireDurableTarget({
        ...exactTargetFields,
        context_token: z.string().trim().min(1),
        request_id: z.string().trim().min(1)
      })
    },
    (args) => invoke(sendRpc, 'board_verify', args)
  )
}
