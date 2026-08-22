import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { parseBoardBuildPlan } from '@open-pencil/core/rpc'

import { fail, ok } from '#mcp/result'
import { boardBuildTraceInputSchema, prepareBoardTraceBuildRequest } from '#mcp/tool/board-trace'

type RpcSender = (body: Record<string, unknown>) => Promise<unknown>
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

const MAX_CODE_OBJECT_SOURCE_LENGTH = 100_000
const CODE_OBJECT_TRUST_WARNING =
  'Code Object TSX executes as trusted in-process code, not a security sandbox. Never use external or untrusted source; route it to a sandboxed embed.'

const exactTargetSchema = {
  content_document_id: z
    .string()
    .trim()
    .min(1)
    .describe('Copy board_context.board_build_base.content_document_id exactly.'),
  document_id: z
    .string()
    .trim()
    .min(1)
    .describe('Copy board_context.board_build_base.document_id exactly.'),
  page_id: z
    .string()
    .trim()
    .min(1)
    .describe('Copy board_context.board_build_base.page_id exactly.'),
  runtime_instance_id: z
    .string()
    .trim()
    .min(1)
    .describe('Copy board_context.board_build_base.runtime_instance_id exactly.'),
  workspace_id: z
    .string()
    .trim()
    .min(1)
    .describe('Copy board_context.board_build_base.workspace_id exactly.')
}

const buildBaseSchema = z
  .object({
    ...exactTargetSchema,
    context_token: z.string().trim().min(1),
    contract: z.literal('board-build/v1'),
    expected_revision: z.number().int().nonnegative()
  })
  .strict()
  .describe('Copy board_context.board_build_base as one atomic packet.')

const extensionSchema = z
  .object({
    contract: z.literal('board-builder-extension/v1'),
    output_digest: z.string().trim().min(1).optional(),
    profile_id: z.string().trim().min(1).optional(),
    skill_id: z.string().trim().min(1),
    skill_version: z.string().trim().min(1).optional()
  })
  .strict()

const placementSchema = z
  .object({
    clearance: z.number().finite().min(0).max(512).optional(),
    preferred_directions: z
      .array(z.enum(['above', 'below', 'left', 'right']))
      .length(4)
      .optional()
  })
  .strict()

const placementTargetSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('auto') })
    .strict()
    .describe(
      'Preferred for an ordinary prompt with no exact requested location. The builder measures the card and searches one bounded deterministic context region; omission does not mean auto.'
    ),
  z
    .object({ kind: z.literal('point'), x: z.number().finite(), y: z.number().finite() })
    .strict()
    .describe(
      'One exact artifact-center coordinate. It does not search nearby positions; account for half the artifact size plus clearance.'
    ),
  z
    .object({ kind: z.literal('relative'), object_id: z.string().trim().min(1) })
    .strict()
    .describe(
      'Place collision-free beside one exact existing Board object. preferred_directions controls the side search order without requiring UI selection.'
    ),
  z
    .object({
      height: z.number().finite().positive(),
      kind: z.literal('region'),
      width: z.number().finite().positive(),
      x: z.number().finite(),
      y: z.number().finite()
    })
    .strict()
    .describe(
      'A bounded search region whose x/y are the top-left corner; the builder searches deterministic collision-free candidates inside it.'
    ),
  z
    .object({
      height: z.number().finite().positive(),
      kind: z.literal('near_region'),
      width: z.number().finite().positive(),
      x: z.number().finite(),
      y: z.number().finite()
    })
    .strict()
    .describe(
      'Search collision-free candidates around one bounded region; produced by Trace region materialization.'
    )
])

const cardPlacementSchema = placementSchema.extend({ target: placementTargetSchema.optional() })

const planDirectionSchema = z
  .enum([
    'above',
    'above-left',
    'above left',
    'above-right',
    'above right',
    'below',
    'below-left',
    'below left',
    'below-right',
    'below right',
    'bottom',
    'bottom-left',
    'bottom left',
    'bottom-right',
    'bottom right',
    'down',
    'down-left',
    'down left',
    'down-right',
    'down right',
    'left',
    'lower-left',
    'lower left',
    'lower-right',
    'lower right',
    'right',
    'top',
    'top-left',
    'top left',
    'top-right',
    'top right',
    'up',
    'up-left',
    'up left',
    'up-right',
    'up right',
    'upper-left',
    'upper left',
    'upper-right',
    'upper right'
  ])
  .describe(
    'Preferred cardinal or natural diagonal placement direction. Supply a non-empty unique subset in priority order; aliases normalize to above, below, left, and right before omitted directions append deterministically.'
  )

const planPlacementSchema = z
  .object({
    clearance: z.number().finite().min(0).max(1_024).optional(),
    preferred_directions: z.array(planDirectionSchema).min(1).max(4).optional()
  })
  .strict()

const planCardPlacementSchema = planPlacementSchema.extend({
  target: placementTargetSchema.optional()
})

const plainJsonObjectSchema = z.record(z.string(), z.json())
const codeObjectSourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CODE_OBJECT_SOURCE_LENGTH)
  .describe(
    `Complete authored TSX source, up to ${MAX_CODE_OBJECT_SOURCE_LENGTH} characters. Default-export one React component; import only react or react/jsx-runtime. The component receives interactionEnabled, props, state, and setState. Use setState for state that must survive Undo, duplication, save, and reopen. ${CODE_OBJECT_TRUST_WARNING}`
  )

const codeObjectCreateRecipeSchema = z
  .object({
    height: z.number().finite().min(160).max(1_200).optional(),
    initial_state: plainJsonObjectSchema.optional(),
    kind: z.literal('code_object'),
    name: z.string().trim().min(1).max(120),
    object_key: z.string().trim().min(1).max(160),
    operation: z.literal('create'),
    placement: cardPlacementSchema.optional(),
    props: plainJsonObjectSchema.optional(),
    source: codeObjectSourceSchema,
    source_format: z.literal('tsx'),
    width: z.number().finite().min(240).max(1_600).optional()
  })
  .strict()
  .describe(
    'Use code_object create for trusted interactive or stateful TSX content. Prefer placement.target {kind:"auto"} when no location was requested, or {kind:"relative",object_id:"..."} when the user names a nearby Board object. Do not use it for a plain note, titled explanation, or static process diagram.'
  )

const planCodeObjectCreateRecipeSchema = codeObjectCreateRecipeSchema.extend({
  placement: planCardPlacementSchema.optional()
})

const codeObjectRefineRecipeSchema = z
  .object({
    expected_source_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
    kind: z.literal('code_object'),
    name: z.string().trim().min(1).max(120).optional(),
    object_key: z.string().trim().min(1).max(160),
    operation: z.literal('refine'),
    owner_id: z.string().trim().min(1),
    props: plainJsonObjectSchema.optional(),
    source: codeObjectSourceSchema,
    source_format: z.literal('tsx')
  })
  .strict()
  .describe(
    'Use code_object refine only for exact-owner full-source replacement of the current Code Object source.'
  )

const recipeSchema = z
  .union([
    z
      .object({
        font_size: z.number().finite().min(8).max(256).optional(),
        kind: z.literal('native_text'),
        max_width: z.number().finite().min(48).max(2_000).optional(),
        name: z.string().trim().min(1).optional(),
        placement: cardPlacementSchema.optional(),
        text: z.string().trim().min(1).max(10_000)
      })
      .strict()
      .describe(
        'Use native_text for a short editable Board label, caption, or plain note. Prefer placement.target {kind:"auto"} when no location was requested.'
      ),
    z
      .object({
        body: z.string().trim().min(1).max(1_200),
        kind: z.literal('native_card'),
        name: z.string().trim().min(1).optional(),
        placement: cardPlacementSchema.optional(),
        title: z.string().trim().min(1).max(120),
        width: z.number().finite().min(240).max(640).optional()
      })
      .strict()
      .describe(
        'Use native_card for a titled editable explanation, decision, summary, or bounded idea. Prefer placement.target {kind:"auto"} unless the user requested a relative object, anchor, exact point, or bounded region.'
      ),
    z
      .object({
        allow_additional_owner: z.boolean().optional(),
        kind: z.literal('native_diagram'),
        owner_id: z.string().trim().min(1).optional(),
        source: z.string().trim().min(1).max(50_000),
        source_format: z.literal('mermaid'),
        zoom_to_selection: z.boolean().optional()
      })
      .strict()
      .describe(
        'Use native_diagram with Mermaid for a multi-node process, topology, journey, architecture, or state flow. Set owner_id to rewrite one exact existing diagram in place.'
      ),
    codeObjectCreateRecipeSchema,
    codeObjectRefineRecipeSchema
  ])
  .describe(
    'Choose the simplest medium that preserves the requested behavior: editable text, titled card, Mermaid diagram, or trusted interactive Code Object.'
  )

const planReferenceSchema = z
  .union([
    z.object({ alias: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u) }).strict(),
    z.object({ object_id: z.string().trim().min(1).max(256) }).strict()
  ])
  .describe('Reference an earlier artifact alias or one exact existing object on this Board.')

const planCompositionAnchorSchema = z.union([
  planReferenceSchema,
  z
    .object({
      height: z.number().finite().positive().max(1_000_000),
      kind: z.enum(['near_region', 'region']),
      width: z.number().finite().positive().max(1_000_000),
      x: z.number().finite().min(-1_000_000).max(1_000_000),
      y: z.number().finite().min(-1_000_000).max(1_000_000)
    })
    .strict()
])

const planCompositionPreferencesSchema = z
  .object({
    density: z.enum(['compact', 'balanced', 'airy']).optional(),
    direction: z.enum(['horizontal', 'vertical']).optional(),
    emphasis: z.array(planReferenceSchema).min(1).max(32).optional(),
    groups: z.array(z.array(planReferenceSchema).min(1).max(32)).min(1).max(12).optional(),
    reading_order: z.array(planReferenceSchema).min(1).max(32).optional()
  })
  .strict()

const planCompositionSchema = z
  .object({
    anchor: planCompositionAnchorSchema.optional(),
    geography: z.enum(['preserve', 'recompose']).optional(),
    members: z.array(planReferenceSchema).min(2).max(32),
    placement: z.enum(['above', 'below', 'left', 'right']).optional(),
    preferences: planCompositionPreferencesSchema.optional()
  })
  .strict()
  .describe(
    'Semantic composition for only the listed members. Omit anchor for a group containing only new aliases and OpenPencil will place it automatically. An anchor is required for relative placement or existing object_id recomposition. State optional reading, grouping, density, direction, and emphasis intent; OpenPencil measures objects, chooses geometry, avoids unrelated Board content, and commits one atomic arrangement. Existing object_id members require geography recompose. Omit hints that do not serve the user intent.'
  )

const planArtifactSchema = z
  .object({
    alias: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u),
    anchor: planReferenceSchema.optional(),
    recipe: z.union([
      z
        .object({
          font_size: z.number().finite().min(8).max(256).optional(),
          height: z.number().finite().min(16).max(720).optional(),
          kind: z.literal('native_text'),
          max_width: z.number().finite().min(48).max(2_000).optional(),
          name: z.string().trim().min(1).max(120).optional(),
          placement: planCardPlacementSchema.optional(),
          text: z.string().trim().min(1).max(10_000),
          width: z.number().finite().min(48).max(2_000).optional()
        })
        .strict(),
      z
        .object({
          body: z.string().trim().min(1).max(1_200),
          height: z.number().finite().min(80).max(720).optional(),
          kind: z.literal('native_card'),
          name: z.string().trim().min(1).max(120).optional(),
          placement: planCardPlacementSchema.optional(),
          title: z.string().trim().min(1).max(120),
          width: z.number().finite().min(240).max(640).optional()
        })
        .strict(),
      z
        .object({
          kind: z.literal('native_diagram'),
          owner_id: z.string().trim().min(1).max(240).optional(),
          placement: planCardPlacementSchema.optional(),
          source: z.string().trim().min(1).max(50_000),
          source_format: z.literal('mermaid'),
          zoom_to_selection: z.boolean().optional()
        })
        .strict(),
      planCodeObjectCreateRecipeSchema
    ])
  })
  .strict()

const planObjectPatchSchema = z
  .object({
    cornerRadius: z.number().finite().min(0).max(100_000).optional(),
    fill: z.string().trim().min(1).max(120).optional(),
    locked: z.boolean().optional(),
    name: z.string().trim().min(1).max(240).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    text: z.string().trim().min(1).max(10_000).optional(),
    visible: z.boolean().optional()
  })
  .strict()

const planOperationSchema = z.union([
  z
    .object({
      kind: z.literal('canonical_object.fork'),
      object_id: z.string().trim().min(1).max(240)
    })
    .strict(),
  z
    .object({
      kind: z.literal('transaction.revert'),
      transaction_id: z.string().trim().min(1).max(240)
    })
    .strict(),
  z.object({ kind: z.literal('object.delete'), object_id: z.string().trim().min(1) }).strict(),
  z
    .object({
      kind: z.literal('object.duplicate'),
      object_id: z.string().trim().min(1),
      offset_x: z.number().finite().min(-10_000).max(10_000).optional(),
      offset_y: z.number().finite().min(-10_000).max(10_000).optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('object.move'),
      object_id: z.string().trim().min(1),
      x: z.number().finite().min(-1_000_000).max(1_000_000),
      y: z.number().finite().min(-1_000_000).max(1_000_000)
    })
    .strict(),
  z
    .object({
      kind: z.literal('object.move'),
      object_id: z.string().trim().min(1),
      relative_to: z
        .object({
          align: z.enum(['start', 'center', 'end']).optional(),
          gap: z.number().finite().min(0).max(10_000).optional(),
          object_id: z.string().trim().min(1),
          side: z.enum(['above', 'below', 'left', 'right'])
        })
        .strict()
    })
    .strict(),
  z
    .object({
      height: z.number().finite().min(1).max(100_000),
      kind: z.literal('object.resize'),
      object_id: z.string().trim().min(1),
      width: z.number().finite().min(1).max(100_000)
    })
    .strict(),
  z
    .object({
      kind: z.literal('object.update'),
      object_id: z.string().trim().min(1),
      patch: planObjectPatchSchema
    })
    .strict()
])

const planSchema = z
  .object({
    artifacts: z.array(planArtifactSchema).max(32),
    composition: planCompositionSchema.optional(),
    contract: z.literal('board-build-plan/v1'),
    operations: z.array(planOperationSchema).max(64).optional()
  })
  .strict()
  .superRefine((value, context) => {
    try {
      parseBoardBuildPlan(value)
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
  .describe(
    'Universal atomic Board plan. It can create native text/cards, trusted Code Objects, native Mermaid diagrams, and edit exact top-level objects. Use composition to express desired layout without inventing columns, ranks, coordinates, or gaps. Only listed composition members may move; unrelated Board content remains untouched.'
  )

const commonLogicalInputShape = {
  intent: z.string().trim().min(1).max(1_000),
  request_id: z.string().trim().min(1),
  task_id: z.string().trim().min(1).optional(),
  trace_id: z.string().trim().min(1).optional()
}

const recipeLogicalInputShape = {
  anchor_id: z.string().trim().min(1).optional(),
  extension: extensionSchema.optional(),
  ...commonLogicalInputShape,
  recipe: recipeSchema
}

const planLogicalInputShape = {
  ...commonLogicalInputShape,
  plan: planSchema
}

function validateRecipeAnchor(
  value: { anchor_id?: string; recipe: z.infer<typeof recipeSchema> },
  context: z.RefinementCtx
) {
  if (
    value.recipe.kind === 'native_text' &&
    Boolean(value.anchor_id) === Boolean(value.recipe.placement?.target)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'native_text requires exactly one of anchor_id or placement.target.'
    })
  }
  if (
    value.recipe.kind === 'native_card' &&
    Boolean(value.anchor_id) === Boolean(value.recipe.placement?.target)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'native_card requires exactly one of anchor_id or placement.target.'
    })
  }
  if (value.recipe.kind === 'code_object' && value.recipe.operation === 'create') {
    if (Boolean(value.anchor_id) === Boolean(value.recipe.placement?.target)) {
      context.addIssue({
        code: 'custom',
        message: 'code_object create requires exactly one of anchor_id or placement.target.'
      })
    }
  }
  if (value.recipe.kind === 'native_diagram' && value.recipe.owner_id && value.anchor_id) {
    context.addIssue({
      code: 'custom',
      message: 'Diagram refinement cannot combine owner_id with anchor_id.'
    })
  }
  if (
    value.recipe.kind === 'code_object' &&
    value.recipe.operation === 'refine' &&
    value.anchor_id
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Code Object refinement uses recipe.owner_id, not anchor_id.'
    })
  }
}

const flatInputSchema = z
  .object({
    ...exactTargetSchema,
    context_token: z
      .string()
      .trim()
      .min(1)
      .describe('Copy board_context.board_build_base.context_token exactly.'),
    contract: z
      .literal('board-build/v1')
      .describe('Copy board_context.board_build_base.contract exactly.'),
    expected_revision: z
      .number()
      .int()
      .nonnegative()
      .describe('Copy board_context.board_build_base.expected_revision exactly.'),
    ...recipeLogicalInputShape
  })
  .strict()
  .superRefine(validateRecipeAnchor)

const packetInputSchema = z
  .object({ base: buildBaseSchema, ...recipeLogicalInputShape })
  .strict()
  .superRefine(validateRecipeAnchor)

const flatPlanInputSchema = z
  .object({
    ...exactTargetSchema,
    context_token: z.string().trim().min(1),
    contract: z.literal('board-build/v1'),
    expected_revision: z.number().int().nonnegative(),
    ...planLogicalInputShape
  })
  .strict()

const packetPlanInputSchema = z.object({ base: buildBaseSchema, ...planLogicalInputShape }).strict()

const inputSchema = z
  .union([
    boardBuildTraceInputSchema,
    packetInputSchema,
    flatInputSchema,
    packetPlanInputSchema,
    flatPlanInputSchema
  ])
  .describe(
    'Use trace for one-command active-gesture builds; otherwise prefer base with the complete board_context.board_build_base packet.'
  )

export function registerBoardBuildTool(mcpServer: McpServer, sendRpc: RpcSender) {
  const register = mcpServer.registerTool.bind(mcpServer) as (
    name: string,
    options: { description: string; inputSchema: z.ZodType },
    handler: ToolHandler
  ) => void

  register(
    'board_build',
    {
      description: `Universal guarded Board builder. For an active Trace gesture, pass trace with latest true or one gesture_id in this same tool call; use the reserved string $trace wherever an exact selected object ID is required and {"kind":"trace_region"} wherever a placement target should use the marked region. The builder resolves Trace, prepares current Board context, validates the materialized recipe or plan, and mutates atomically. Otherwise pass board_context.board_build_base as base. Use native_text for a short note, native_card for a titled idea, native_diagram for Mermaid structure, or code_object for trusted interactive/stateful TSX; plans atomically create, update, move, resize, duplicate, delete, and lay out. ${CODE_OBJECT_TRUST_WARNING} Specialists are optional advice and never authority. Successful responses include receipt, readback, persistence, continuation, and timing proof; reuse next_build_target without another context call, use the same request_id for recovery, and stop unless the outcome is unknown or visibly diverged.`,
      inputSchema
    },
    async (args) => {
      try {
        const request = await prepareBoardTraceBuildRequest({
          args,
          sendRpc,
          validatePlan: (value) => packetPlanInputSchema.parse(value),
          validateRecipe: (value) => packetInputSchema.parse(value)
        })
        const response = (await sendRpc({
          command: 'board_build',
          args: request.args
        })) as {
          error?: string
          ok?: boolean
          result?: Record<string, unknown>
          target?: unknown
        }
        if (response.ok === false) return fail(new Error(response.error))
        return ok(
          {
            ...response.result,
            ...(request.handshake ? { trace_build_handshake: request.handshake } : {}),
            ...(response.target ? { target: response.target } : {})
          },
          'board_build'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )
}

export { inputSchema as boardBuildInputSchema }
