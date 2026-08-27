import { z } from 'zod'

import {
  CODE_OBJECT_AGENT_PRESET_IDS,
  CODE_OBJECT_BOARD_PERMISSIONS,
  CODE_OBJECT_MODALITY_IDS
} from '@open-pencil/core/code-object'

const boardQueryFilterSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  parent_id: z.string().trim().min(1).max(240).optional(),
  region: z
    .object({
      height: z.number().positive(),
      width: z.number().positive(),
      x: z.number(),
      y: z.number()
    })
    .optional(),
  text: z.string().trim().min(1).max(240).optional(),
  types: z.array(z.string().trim().min(1)).min(1).max(16).optional()
})

export const boardQuerySchema = z
  .object({
    detail: z
      .enum(['summary', 'full', 'code_object', 'mermaid', 'geometry', 'id_only'])
      .describe(
        'Response shape. summary is the compact default; full, code_object, and mermaid require object_ids; geometry and id_only apply to discovery.'
      )
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
    object_ids: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(25)
      .describe('Optional exact Board object IDs to read together')
      .optional(),
    page_id: z.string().trim().min(1).describe('Exact Board page ID'),
    query: boardQueryFilterSchema.describe('Optional bounded current-page discovery').optional(),
    sort: z.enum(['document', 'name', 'x', 'y']).optional(),
    token_budget: z.number().int().min(256).max(6000).optional()
  })
  .strict()

export const traceQuerySchema = z
  .object({
    latest_spoken_turn: z.boolean().optional(),
    limit: z.number().int().min(1).max(5).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    session_tag: z.string().trim().min(1).max(80).optional(),
    since: z.string().trim().min(1).max(80).optional(),
    spoken_text: z.string().trim().min(1).max(500).optional(),
    spoken_turn_id: z.string().trim().min(1).max(240).optional(),
    task_cursor: z.string().trim().min(1).max(4_000).optional(),
    turn_context: z.boolean().optional(),
    until: z.string().trim().min(1).max(80).optional()
  })
  .strict()

const typedObjectBoundsSchema = z
  .object({
    height: z.number().positive(),
    width: z.number().positive(),
    x: z.number(),
    y: z.number()
  })
  .describe('Page-space bounds by default for typed creates; parent-local for typed updates')
  .strict()

const typedCreateCoordinateSpaceSchema = z
  .enum(['page', 'parent'])
  .describe(
    'Coordinate space for bounds. Defaults to page; use parent only when bounds are already parent-local.'
  )

const codeObjectSurfaceSchema = z
  .object({
    background: z.enum(['surface', 'transparent']),
    overflow: z.enum(['clip', 'scroll'])
  })
  .strict()

const codeObjectThemeTokensSchema = z
  .object({
    accent: z.string().trim().min(1).max(240).optional(),
    accentText: z.string().trim().min(1).max(240).optional(),
    background: z.string().trim().min(1).max(240).optional(),
    border: z.string().trim().min(1).max(240).optional(),
    danger: z.string().trim().min(1).max(240).optional(),
    focusRing: z.string().trim().min(1).max(240).optional(),
    radius: z.string().trim().min(1).max(240).optional(),
    shadow: z.string().trim().min(1).max(240).optional(),
    success: z.string().trim().min(1).max(240).optional(),
    surface: z.string().trim().min(1).max(240).optional(),
    surfaceElevated: z.string().trim().min(1).max(240).optional(),
    text: z.string().trim().min(1).max(240).optional(),
    textMuted: z.string().trim().min(1).max(240).optional(),
    warning: z.string().trim().min(1).max(240).optional()
  })
  .strict()

const codeObjectAppearanceSchema = z
  .object({
    preference: z.enum(['system', 'light', 'dark']),
    tokens: z
      .object({
        dark: codeObjectThemeTokensSchema.optional(),
        light: codeObjectThemeTokensSchema.optional()
      })
      .strict()
      .optional()
  })
  .strict()

const boardApplyOperationSchema = z.discriminatedUnion('op', [
  z
    .object({
      appearance: z.enum(['auto', 'light', 'dark']).optional(),
      bounds: typedObjectBoundsSchema,
      index: z.number().int().min(0).optional(),
      name: z.string().trim().min(1).max(240).optional(),
      object_id: z.string().trim().min(1),
      op: z
        .literal('create_mermaid')
        .describe('Create one source-backed Mermaid diagram as a selectable Board frame'),
      parent_id: z
        .string()
        .trim()
        .min(1)
        .describe('Exact page_id; Mermaid diagrams are page-owned'),
      source: z
        .string()
        .max(100_000)
        .refine((source) => source.trim().length > 0, 'Mermaid source must not be blank')
    })
    .strict(),
  z
    .object({
      appearance: z.enum(['auto', 'light', 'dark']).optional(),
      bounds: typedObjectBoundsSchema.partial().optional(),
      name: z.string().trim().min(1).max(240).optional(),
      object_id: z.string().trim().min(1),
      op: z
        .literal('update_mermaid')
        .describe('Replace stored Mermaid source while preserving diagram identity and geometry'),
      source: z
        .string()
        .max(100_000)
        .refine((source) => source.trim().length > 0, 'Mermaid source must not be blank')
    })
    .strict(),
  z
    .object({
      bounds: typedObjectBoundsSchema,
      coordinate_space: typedCreateCoordinateSpaceSchema.optional(),
      image_scale_mode: z.enum(['FILL', 'FIT', 'CROP', 'TILE']).optional(),
      index: z.number().int().min(0).optional(),
      name: z.string().trim().min(1).max(240),
      object_id: z.string().trim().min(1),
      op: z
        .literal('create_image')
        .describe('Import one completed local raster image as a native Board image'),
      parent_id: z.string().trim().min(1),
      source_path: z.string().trim().min(1).max(4_096)
    })
    .strict(),
  z
    .object({
      appearance: codeObjectAppearanceSchema.optional(),
      board_permissions: z.array(z.enum(CODE_OBJECT_BOARD_PERMISSIONS)).max(64).optional(),
      bounds: typedObjectBoundsSchema,
      coordinate_space: typedCreateCoordinateSpaceSchema.optional(),
      definition_id: z.string().trim().min(1).max(240).optional(),
      index: z.number().int().min(0).optional(),
      modality: z
        .enum(CODE_OBJECT_MODALITY_IDS)
        .describe('Classification for custom source; omit when preset_id is provided')
        .optional(),
      name: z
        .string()
        .trim()
        .min(1)
        .max(240)
        .describe('Required for custom source; optional override for a preset')
        .optional(),
      object_id: z.string().trim().min(1),
      op: z
        .literal('create_code_object')
        .describe(
          'Operation inside board_apply.operations. Use preset_id without source for a built-in modality, or name plus source for custom behavior.'
        ),
      parent_id: z.string().trim().min(1),
      preset_id: z
        .enum(CODE_OBJECT_AGENT_PRESET_IDS)
        .describe('Built-in modality renderer; when set, omit source, definition_id, and modality')
        .optional(),
      props: z.record(z.string(), z.unknown()).optional(),
      source: z
        .string()
        .min(1)
        .max(100_000)
        .describe('Authored TSX; required only when preset_id is omitted')
        .optional(),
      state: z.record(z.string(), z.unknown()).optional(),
      surface: codeObjectSurfaceSchema.optional()
    })
    .strict(),
  z
    .object({
      appearance: codeObjectAppearanceSchema.optional(),
      board_permissions: z.array(z.enum(CODE_OBJECT_BOARD_PERMISSIONS)).max(64).optional(),
      bounds: typedObjectBoundsSchema.partial().optional(),
      name: z.string().trim().min(1).max(240).optional(),
      object_id: z.string().trim().min(1),
      op: z
        .literal('update_code_object')
        .describe('Operation inside board_apply.operations; not a standalone tool'),
      props: z.record(z.string(), z.unknown()).optional(),
      source: z.string().min(1).max(100_000).optional(),
      state: z.record(z.string(), z.unknown()).optional(),
      surface: codeObjectSurfaceSchema.optional()
    })
    .strict(),
  z
    .object({
      index: z.number().int().min(0).optional(),
      node: z.record(z.string(), z.unknown()),
      op: z.literal('create'),
      parent_id: z.string().trim().min(1)
    })
    .strict(),
  z
    .object({
      changes: z.record(z.string(), z.unknown()),
      object_id: z.string().trim().min(1),
      op: z.literal('update'),
      unset: z.array(z.string().trim().min(1)).max(64).optional()
    })
    .strict(),
  z
    .object({
      index: z.number().int().min(0).optional(),
      object_id: z.string().trim().min(1),
      op: z.literal('reparent'),
      parent_id: z.string().trim().min(1)
    })
    .strict(),
  z
    .object({
      object_id: z.string().trim().min(1),
      op: z.literal('delete'),
      recursive: z.boolean().optional()
    })
    .strict()
])

export const boardApplySchema = z
  .object({
    operations: z.array(boardApplyOperationSchema).min(1).max(100),
    page_id: z.string().trim().min(1).describe('Exact Board page ID'),
    request_id: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .describe('Optional stable idempotency key for an intentional retry')
      .optional()
  })
  .strict()

export type BoardQueryArgs = z.infer<typeof boardQuerySchema>
export type BoardIndexArgs = Omit<BoardQueryArgs, 'detail' | 'object_ids'> & {
  projection?: 'geometry' | 'id_only' | 'summary'
}
export type BoardApplyArgs = z.infer<typeof boardApplySchema>
export type TraceQueryArgs = z.infer<typeof traceQuerySchema>
