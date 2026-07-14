import { z } from 'zod'

const stableId = z.string().trim().min(1)
const revision = z.coerce.number().int().nonnegative()
const unknownRecord = z.record(z.string(), z.unknown())

export const knowledgeWorkspaceOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create-object'), object: unknownRecord }),
  z.object({
    type: z.literal('update-object'),
    objectId: stableId,
    objectType: stableId,
    expectedObjectRevision: revision,
    patch: unknownRecord
  }),
  z.object({
    type: z.literal('archive-object'),
    objectId: stableId,
    expectedObjectRevision: revision
  }),
  z.object({
    type: z.literal('restore-object'),
    objectId: stableId,
    expectedObjectRevision: revision
  }),
  z.object({
    type: z.literal('set-projection'),
    objectId: stableId,
    viewId: stableId,
    expectedObjectRevision: revision,
    projection: unknownRecord
  }),
  z.object({
    type: z.literal('remove-projection'),
    objectId: stableId,
    viewId: stableId,
    expectedObjectRevision: revision
  }),
  z.object({ type: z.literal('create-view'), view: unknownRecord }),
  z.object({
    type: z.literal('update-view'),
    viewId: stableId,
    expectedViewRevision: revision,
    patch: z.object({
      name: z.string().optional(),
      primary: z.boolean().optional(),
      settings: unknownRecord.optional()
    })
  }),
  z.object({
    type: z.literal('archive-view'),
    viewId: stableId,
    expectedViewRevision: revision
  }),
  z.object({ type: z.literal('connect-relation'), relation: unknownRecord }),
  z.object({
    type: z.literal('disconnect-relation'),
    relationId: stableId,
    expectedRelationRevision: revision
  }),
  z.object({
    type: z.literal('set-runtime-owner'),
    blockId: stableId.nullable(),
    handshakeAt: z.string().datetime().optional()
  })
])

export const knowledgeWorkspaceOperationsSchema = z
  .array(knowledgeWorkspaceOperationSchema)
  .min(1)
  .max(200)

const workspaceObjectTypes = [
  'document-block',
  'collection',
  'collection-record',
  'saved-view',
  'canvas-object',
  'graph-node',
  'graph-edge',
  'design-artifact',
  'live-app-block',
  'review-object'
] as const

export const workspaceQuerySchema = {
  text: z.string().trim().max(500).optional(),
  object_types: z.array(z.enum(workspaceObjectTypes)).max(workspaceObjectTypes.length).optional(),
  collection_id: stableId.optional(),
  tags: z.array(z.string().trim().min(1)).max(32).optional(),
  route: z.string().trim().min(1).optional(),
  source_target: z.string().trim().min(1).optional(),
  statuses: z.array(z.string().trim().min(1)).max(32).optional(),
  changed_since_revision: revision.optional(),
  relation: z
    .object({
      object_id: stableId,
      direction: z.enum(['incoming', 'outgoing', 'either']),
      relation_types: z.array(z.string().trim().min(1)).max(32).optional()
    })
    .optional(),
  document_id_filter: stableId.optional(),
  page_id_filter: stableId.optional(),
  view_id: stableId.optional(),
  include_archived: z.boolean().optional(),
  include_backlinks: z.boolean().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}
