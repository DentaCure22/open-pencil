import { z } from 'zod'

import {
  boardBuildTraceContext,
  materializeBoardBuildTrace,
  parseBoardBuildPlan
} from '@open-pencil/core/rpc'

type JsonRecord = Record<string, unknown>
type RpcSender = (body: Record<string, unknown>) => Promise<unknown>

export const boardBuildTraceSelectorSchema = z
  .object({
    gesture_id: z.string().trim().min(1).optional(),
    latest: z.boolean().optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.gesture_id) === (value.latest === true)) {
      context.addIssue({
        code: 'custom',
        message: 'Provide exactly one of trace.gesture_id or trace.latest true.'
      })
    }
  })

const traceExtensionSchema = z
  .object({
    contract: z.literal('board-builder-extension/v1'),
    output_digest: z.string().trim().min(1).optional(),
    profile_id: z.string().trim().min(1).optional(),
    skill_id: z.string().trim().min(1),
    skill_version: z.string().trim().min(1).optional()
  })
  .strict()

export const boardBuildTraceInputSchema = z
  .object({
    anchor_id: z.string().trim().min(1).optional(),
    extension: traceExtensionSchema.optional(),
    intent: z.string().trim().min(1).max(1_000),
    plan: z.record(z.string(), z.json()).optional(),
    recipe: z.record(z.string(), z.json()).optional(),
    request_id: z.string().trim().min(1),
    task_id: z.string().trim().min(1).optional(),
    trace: boardBuildTraceSelectorSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.plan) === Boolean(value.recipe)) {
      context.addIssue({
        code: 'custom',
        message: 'Trace build requires exactly one of plan or recipe.'
      })
    }
    if (value.plan && (value.anchor_id || value.extension)) {
      context.addIssue({
        code: 'custom',
        message: 'Trace build plans cannot use recipe-only anchor_id or extension.'
      })
    }
  })

const pageRegionSchema = z
  .object({
    height: z.number().finite().positive(),
    width: z.number().finite().positive(),
    x: z.number().finite(),
    y: z.number().finite()
  })
  .strict()

const matchedTraceGestureSchema = z.object({
  gesture: z.object({
    boardOrigin: z.object({
      contentDocumentId: z.string().trim().min(1),
      documentId: z.string().trim().min(1).optional(),
      pageId: z.string().trim().min(1),
      runtimeInstanceId: z.string().trim().min(1).optional(),
      workspaceId: z.string().trim().min(1).optional()
    }),
    candidates: z.object({
      items: z.array(z.object({ stableId: z.string().trim().min(1) })).max(64),
      primaryTargetId: z.string().trim().min(1).optional()
    }),
    geometry: z.object({ pageRegion: pageRegionSchema }),
    gestureId: z.string().trim().min(1)
  }),
  status: z.literal('matched')
})

export type BoardTracePreparation = {
  result: JsonRecord
  semanticRpcCalls: {
    board_build: 1
    board_prepare_edit: 1
    total: 3
    trace_get_gesture: 1
  }
  traceGesture: JsonRecord
}

export type BoardTraceBuildRequest = {
  args: JsonRecord
  handshake?: JsonRecord
}

export type BoardTraceBuildRequestOptions = {
  args: JsonRecord
  sendRpc: RpcSender
  validatePlan: (value: unknown) => JsonRecord
  validateRecipe: (value: unknown) => JsonRecord
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeBuildArgs(args: JsonRecord): JsonRecord {
  let normalized = args
  if ('base' in args) {
    const { base, ...logical } = args
    if (!isRecord(base)) return args
    normalized = { ...base, ...logical }
  }
  return 'plan' in normalized
    ? { ...normalized, plan: parseBoardBuildPlan(normalized.plan) }
    : normalized
}

async function rpcEnvelope(sendRpc: RpcSender, command: string, args: JsonRecord) {
  const response = (await sendRpc({ command, args })) as {
    error?: string
    ok?: boolean
    result?: unknown
  }
  if (response.ok === false) throw new Error(response.error || `${command} failed.`)
  if (!isRecord(response.result)) throw new Error(`${command} returned no result.`)
  return response.result
}

function boardPrepareEditArgs(trace: JsonRecord, intent: string): JsonRecord {
  const matched = matchedTraceGestureSchema.safeParse(trace)
  if (!matched.success) {
    const reason = typeof trace.reason === 'string' ? `: ${trace.reason}` : ''
    throw new Error(`Trace gesture could not be prepared${reason}.`)
  }
  const { gesture } = matched.data
  const { boardOrigin: origin, candidates, geometry } = gesture
  if (!origin.workspaceId && !origin.documentId) {
    throw new Error(
      'Trace gesture has no exact workspace or document tab; capture a fresh gesture.'
    )
  }
  return {
    candidate_object_ids: [
      ...new Set(candidates.items.map((candidate) => candidate.stableId))
    ].slice(0, 25),
    content_document_id: origin.contentDocumentId,
    ...(origin.documentId ? { document_id: origin.documentId } : {}),
    gesture_id: gesture.gestureId,
    intent,
    page_id: origin.pageId,
    ...(candidates.primaryTargetId ? { primary_target_id: candidates.primaryTargetId } : {}),
    region: geometry.pageRegion,
    ...(origin.runtimeInstanceId ? { runtime_instance_id: origin.runtimeInstanceId } : {}),
    ...(origin.workspaceId ? { workspace_id: origin.workspaceId } : {})
  }
}

export async function prepareBoardTraceBuild(
  sendRpc: RpcSender,
  selector: z.infer<typeof boardBuildTraceSelectorSchema>,
  intent: string
): Promise<BoardTracePreparation> {
  const trace = await rpcEnvelope(sendRpc, 'trace_get_gesture', {
    ...(selector.gesture_id ? { gesture_id: selector.gesture_id } : {}),
    include_image: false,
    latest: selector.latest === true
  })
  const prepared = await rpcEnvelope(
    sendRpc,
    'board_prepare_edit',
    boardPrepareEditArgs(trace, intent)
  )
  const traceGesture = isRecord(trace.gesture) ? trace.gesture : {}
  return {
    result: prepared,
    semanticRpcCalls: {
      board_build: 1,
      board_prepare_edit: 1,
      total: 3,
      trace_get_gesture: 1
    },
    traceGesture
  }
}

function traceBuildHandshake(
  preparation: BoardTracePreparation,
  context: ReturnType<typeof boardBuildTraceContext>,
  materialized: ReturnType<typeof materializeBoardBuildTrace>
): JsonRecord {
  return {
    contract: 'board-build-trace/v1',
    gesture_id: context.gestureId,
    resolved_placeholders: {
      connection_scopes: materialized.connectionScopeCount,
      object_references: materialized.objectReferenceCount,
      region_references: materialized.regionReferenceCount
    },
    traced_connections: context.connectionCount,
    ...(context.selectedObjectId ? { selected_object_id: context.selectedObjectId } : {}),
    semantic_rpc_calls: preparation.semanticRpcCalls
  }
}

export async function prepareBoardTraceBuildRequest({
  args,
  sendRpc,
  validatePlan,
  validateRecipe
}: BoardTraceBuildRequestOptions): Promise<BoardTraceBuildRequest> {
  if (!('trace' in args)) return { args: normalizeBuildArgs(args) }
  const parsed = boardBuildTraceInputSchema.parse(args)
  const preparation = await prepareBoardTraceBuild(sendRpc, parsed.trace, parsed.intent)
  const context = boardBuildTraceContext(preparation.result)
  const logicalInput = {
    ...(parsed.anchor_id ? { anchor_id: parsed.anchor_id } : {}),
    ...(parsed.extension ? { extension: parsed.extension } : {}),
    ...(parsed.plan ? { plan: parsed.plan } : { recipe: parsed.recipe })
  }
  const materialized = materializeBoardBuildTrace(logicalInput, context)
  if (!isRecord(materialized.value)) {
    throw new TypeError('Trace build payload did not materialize to an object.')
  }
  const packet = {
    base: context.base,
    intent: parsed.intent,
    ...materialized.value,
    request_id: parsed.request_id,
    ...(parsed.task_id ? { task_id: parsed.task_id } : {}),
    trace_id: context.gestureId
  }
  const validated = parsed.plan ? validatePlan(packet) : validateRecipe(packet)
  return {
    args: normalizeBuildArgs(validated),
    handshake: traceBuildHandshake(preparation, context, materialized)
  }
}
