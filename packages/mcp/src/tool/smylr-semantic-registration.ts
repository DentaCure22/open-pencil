import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { fail, ok } from '#mcp/result'

import { knowledgeWorkspaceOperationsSchema, workspaceQuerySchema } from './workspace-schema'

type RpcSender = (body: Record<string, unknown>) => Promise<unknown>

const automationTargetSchema = {
  document_id: z.string().describe('Optional OpenPencil document/tab ID to target').optional(),
  page_id: z.string().describe('Optional page ID to target within the document').optional(),
  workspace_id: z.string().describe('Stable OpenPencil workspace ID to target').optional()
}

const requiredAutomationTargetSchema = {
  document_id: z.string().trim().min(1).describe('Exact OpenPencil document/tab ID to target'),
  page_id: z.string().trim().min(1).describe('Exact page ID to target within the document'),
  workspace_id: z.string().trim().min(1).describe('Stable OpenPencil workspace ID').optional()
}

const mutationEnvelope = {
  expected_revision: z.coerce
    .number()
    .int()
    .describe('Expected OpenPencil scene revision for optimistic concurrency')
    .optional(),
  idempotency_key: z
    .string()
    .describe('Caller-supplied stable key that makes repeated mutations safe')
    .optional(),
  dry_run: z.boolean().describe('Describe the mutation without applying it').optional()
}

const legacyWorkspaceOperations = [
  'create_version',
  'create_flow_state',
  'add_to_flow',
  'connect_states',
  'start_branch',
  'send_review',
  'approve',
  'prefer',
  'archive',
  'rename'
] as const

const workspaceMutationSchema = z
  .object({
    operation: z.enum([...legacyWorkspaceOperations, 'apply_knowledge_mutations'] as const),
    operations: knowledgeWorkspaceOperationsSchema.optional(),
    item_id: z.string().optional(),
    target_item_id: z.string().optional(),
    flow_id: z.string().optional(),
    index: z.coerce.number().int().optional(),
    transition: z.string().optional(),
    kind: z.enum(['draft', 'variant']).optional(),
    name: z.string().optional(),
    note: z.string().optional(),
    route: z.string().optional(),
    ...mutationEnvelope,
    ...automationTargetSchema
  })
  .superRefine((args, context) => {
    if (args.operation !== 'apply_knowledge_mutations') return
    if (!args.operations) {
      context.addIssue({ code: 'custom', path: ['operations'], message: 'operations is required' })
    }
    if (args.expected_revision === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['expected_revision'],
        message: 'expected_revision is required for knowledge mutations'
      })
    }
    if (!args.idempotency_key?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['idempotency_key'],
        message: 'idempotency_key is required for knowledge mutations'
      })
    }
  })

function resultWithTarget(response: unknown, value: unknown) {
  if (!response || typeof response !== 'object' || !('target' in response)) return value
  const target = (response as { target?: unknown }).target
  if (value && typeof value === 'object' && !Array.isArray(value)) return { ...value, target }
  return { result: value, target }
}

function splitTarget(args: Record<string, unknown>) {
  const { document_id, page_id, workspace_id, ...toolArgs } = args
  return {
    target: {
      ...(typeof document_id === 'string' ? { document_id } : {}),
      ...(typeof page_id === 'string' ? { page_id } : {}),
      ...(typeof workspace_id === 'string' ? { workspace_id } : {})
    },
    toolArgs
  }
}

export function registerSmylrSemanticTools(
  mcpServer: Pick<McpServer, 'registerTool'>,
  sendRpc: RpcSender
) {
  const register = mcpServer.registerTool.bind(mcpServer) as (...args: unknown[]) => void
  const definitions = [
    {
      name: 'get_openpencil_context',
      description:
        'Read the current OpenPencil document, project board, route, live selection, tokens, preview health, runtime model, and scene revision.',
      schema: z.object({ ...automationTargetSchema })
    },
    {
      name: 'get_document_persistence_readiness',
      description:
        'Read whether the exact OpenPencil document has a durable save target for guarded agent mutations. Returns the target kind and an explicit preparation action without opening a picker or changing the document.',
      schema: z.object({ ...requiredAutomationTargetSchema }).strict()
    },
    {
      name: 'inspect_live_container',
      description:
        'Inspect the selected real Smylr container, including owner/source evidence, tokens, computed styles, bounds, and current isolated live changes.',
      schema: z.object({ ...automationTargetSchema })
    },
    {
      name: 'edit_live_container',
      description:
        'Immediately preview token and CSS changes on the selected real Smylr container. Changes stay isolated from source and participate in the live draft history.',
      schema: z.object({
        styles: z.record(z.string(), z.string()).optional(),
        add: z.array(z.string()).optional(),
        remove: z.array(z.string()).optional(),
        note: z.string().optional(),
        ...mutationEnvelope,
        ...automationTargetSchema
      })
    },
    {
      name: 'upsert_board_guide',
      description:
        'Create the native guide-first board scaffold showing that flow goes across, versions branch down, and production stays protected.',
      schema: z.object({
        title: z.string().optional(),
        ...mutationEnvelope,
        ...automationTargetSchema
      })
    },
    {
      name: 'mutate_workspace_graph',
      description:
        'Create or organize legacy edit versions and flow states, or atomically apply typed knowledge-workspace object, relation, projection, view, and runtime-owner operations.',
      schema: workspaceMutationSchema
    },
    {
      name: 'query_workspace_items',
      description:
        'Search typed OpenPencil workspace items with scoped full-text, metadata, relation, backlink, and revision filters. Returns paginated stable references and concise excerpts.',
      schema: z.object({ ...workspaceQuerySchema, ...automationTargetSchema })
    },
    {
      name: 'activate_workspace_item',
      description:
        'Place the shared live runtime on a saved draft, alternate, flow, review, or change-set frame and replay its isolated patches.',
      schema: z.object({
        item_id: z.string(),
        mode: z.enum(['select', 'interact']).optional(),
        ...automationTargetSchema
      })
    },
    {
      name: 'compare_workspace_items',
      description:
        'Compare two saved OpenPencil workspace items by status, live node, token additions/removals, styles, and source evidence.',
      schema: z.object({
        left_item_id: z.string(),
        right_item_id: z.string(),
        ...automationTargetSchema
      })
    },
    {
      name: 'create_change_set',
      description:
        'Package approved or preferred OpenPencil versions and flow states into an explicit change set without changing application source.',
      schema: z.object({
        item_ids: z.array(z.string()).min(1),
        name: z.string().optional(),
        note: z.string().optional(),
        acceptance_criteria: z.array(z.string()).optional(),
        ...mutationEnvelope,
        ...automationTargetSchema
      })
    },
    {
      name: 'propose_source_patch',
      description:
        'Return a source-targeted patch proposal from saved OpenPencil work. This never writes source and fails when owner/source evidence is unresolved.',
      schema: z.object({
        change_set_id: z.string().optional(),
        item_ids: z.array(z.string()).optional(),
        ...automationTargetSchema
      })
    },
    {
      name: 'verify_change_set',
      description:
        'Run workspace-level safety checks on a change set and record that source application, tests, and real-app verification are still required.',
      schema: z.object({
        change_set_id: z.string(),
        ...mutationEnvelope,
        ...automationTargetSchema
      })
    }
  ] as const

  for (const definition of definitions) {
    register(
      definition.name,
      { description: definition.description, inputSchema: definition.schema },
      async (args: Record<string, unknown>) => {
        try {
          const { target, toolArgs } = splitTarget(args)
          const response = await sendRpc({
            command: 'smylr_semantic_tool',
            args: { ...target, name: definition.name, args: toolArgs }
          })
          const envelope = response as { ok?: boolean; result?: unknown; error?: string }
          if (envelope.ok === false) return fail(new Error(envelope.error))
          return ok(resultWithTarget(response, envelope.result ?? response), definition.name)
        } catch (error) {
          return fail(error)
        }
      }
    )
  }
}
