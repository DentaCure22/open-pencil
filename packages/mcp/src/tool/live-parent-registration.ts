import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import { fail, ok } from '#mcp/result'
import { authorityJson } from '#mcp/tool/authority-client'

import {
  boardApplySchema,
  boardQuerySchema,
  traceQuerySchema,
  type BoardApplyArgs,
  type BoardIndexArgs,
  type BoardQueryArgs,
  type TraceQueryArgs
} from './live-parent-schemas'

type RegionArgs = Rect
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024
type AuthorityClient = typeof authorityJson

const ALL_LIVE_TOOL_NAMES = [
  'board_apply',
  'board_go',
  'board_query',
  'board_screenshot',
  'board_where',
  'set_theme',
  'trace_query'
] as const

export const PARENT_LIVE_TOOL_NAMES = [
  'board_go',
  'board_where',
  'set_theme',
  'trace_query'
] as const
type LiveToolName = (typeof ALL_LIVE_TOOL_NAMES)[number]

type BoardReadArgs = {
  detail?: 'code_object' | 'full' | 'mermaid' | 'summary'
  object_ids: string[]
  page_id: string
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function authorityError(payload: Record<string, unknown> | null, status: number, action: string) {
  const message =
    typeof payload?.error === 'string' ? payload.error : `${action} failed (${String(status)}).`
  return fail(new Error(message))
}

function payloadResult(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  return isRecord(payload?.result) ? payload.result : null
}

function contextFailure(payload: Record<string, unknown> | null): boolean {
  const message = typeof payload?.error === 'string' ? payload.error : ''
  return /context is (?:missing|stale)|context is missing or expired|reacquire context|stale_(?:revision|content_hash)|expected (?:revision|content hash).+current/i.test(
    message
  )
}

async function contextBoundBoardRead(authority: AuthorityClient, args: BoardReadArgs) {
  let response: Awaited<ReturnType<AuthorityClient>> | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const context = await authority('/local-workspace/v1/rpc', {
      body: JSON.stringify({ args: { page_id: args.page_id }, command: 'board_context' }),
      method: 'POST'
    })
    if (!context.ok) return context
    const contextToken = payloadResult(context.payload)?.context_token
    if (typeof contextToken !== 'string' || !contextToken) {
      throw new Error('board_context returned no context token.')
    }
    response = await authority('/local-workspace/v1/rpc', {
      body: JSON.stringify({
        args: {
          ...args,
          context_token: contextToken,
          scope: 'objects'
        },
        command: 'board_read'
      }),
      method: 'POST'
    })
    if (response.ok || !contextFailure(response.payload)) return response
  }
  if (!response) throw new Error('board_read returned no response.')
  return response
}

async function contextBoundBoardIndex(authority: AuthorityClient, args: BoardIndexArgs) {
  let response: Awaited<ReturnType<AuthorityClient>> | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const context = await authority('/local-workspace/v1/rpc', {
      body: JSON.stringify({ args: { page_id: args.page_id }, command: 'board_context' }),
      method: 'POST'
    })
    if (!context.ok) return context
    const contextToken = payloadResult(context.payload)?.context_token
    if (typeof contextToken !== 'string' || !contextToken) {
      throw new Error('board_context returned no context token.')
    }
    response = await authority('/local-workspace/v1/rpc', {
      body: JSON.stringify({
        args: {
          ...args,
          context_token: contextToken,
          limit: args.limit ?? 100,
          projection: args.projection ?? 'summary',
          query:
            args.query && Object.keys(args.query).length > 0
              ? args.query
              : { parent_id: args.page_id },
          scope: 'query',
          token_budget: args.token_budget ?? 3_000
        },
        command: 'board_read'
      }),
      method: 'POST'
    })
    if (response.ok || !contextFailure(response.payload)) return response
  }
  if (!response) throw new Error('board_query returned no response.')
  return response
}

async function contextBoundBoardQuery(authority: AuthorityClient, args: BoardQueryArgs) {
  if (args.object_ids) {
    if (args.query) throw new Error('board_query accepts object_ids or query, not both.')
    if (args.detail === 'geometry' || args.detail === 'id_only') {
      throw new Error('board_query geometry and id_only detail apply only to discovery.')
    }
    return contextBoundBoardRead(authority, {
      detail: args.detail,
      object_ids: args.object_ids,
      page_id: args.page_id
    })
  }
  if (args.detail === 'full' || args.detail === 'code_object' || args.detail === 'mermaid') {
    throw new Error('board_query full, code_object, and mermaid detail require object_ids.')
  }
  return contextBoundBoardIndex(authority, {
    limit: args.limit,
    page_id: args.page_id,
    projection: args.detail,
    query: args.query,
    sort: args.sort,
    token_budget: args.token_budget
  })
}

async function contextBoundBoardApply(authority: AuthorityClient, args: BoardApplyArgs) {
  const requestId = args.request_id ?? `board-apply:${randomUUID()}`
  let response: Awaited<ReturnType<AuthorityClient>> | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const context = await authority('/local-workspace/v1/rpc', {
      body: JSON.stringify({ args: { page_id: args.page_id }, command: 'board_context' }),
      method: 'POST'
    })
    if (!context.ok) return context
    const contextToken = payloadResult(context.payload)?.context_token
    if (typeof contextToken !== 'string' || !contextToken) {
      throw new Error('board_context returned no context token.')
    }
    response = await authority('/local-workspace/v1/rpc', {
      body: JSON.stringify({
        args: { ...args, context_token: contextToken, request_id: requestId },
        command: 'board_apply'
      }),
      method: 'POST'
    })
    if (response.ok || !contextFailure(response.payload)) return response
  }
  if (!response) throw new Error('board_apply returned no response.')
  return response
}

function selectedIdsFromPresence(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.selectedIds)) return []
  return value.selectedIds.filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
  )
}

async function classifyPresenceSelection(
  authority: AuthorityClient,
  presence: Record<string, unknown>,
  pageId: string
) {
  const selectedIds = selectedIdsFromPresence(presence)
  if (selectedIds.length === 0) return presence
  const response = await contextBoundBoardRead(authority, {
    object_ids: selectedIds,
    page_id: pageId
  })
  if (!response.ok) {
    return {
      ...presence,
      selectedIds: [],
      unclassifiedSelectedIds: selectedIds
    }
  }
  const result = payloadResult(response.payload)
  const nodes = Array.isArray(result?.nodes)
    ? result.nodes.filter((node): node is Record<string, unknown> => isRecord(node))
    : []
  const selected = new Set(selectedIds)
  const agentCardIds = nodes
    .filter(
      (node) =>
        selected.has(typeof node.id === 'string' ? node.id : '') &&
        node.code_object_component === 'agent-conversation-terminal'
    )
    .map((node) => node.id as string)
  const classified = new Set(
    nodes
      .filter((node) => selected.has(typeof node.id === 'string' ? node.id : ''))
      .map((node) => node.id as string)
  )
  return {
    ...presence,
    ...(agentCardIds.length > 0 ? { agentCardIds } : {}),
    selectedIds: selectedIds.filter((id) => !agentCardIds.includes(id) && classified.has(id)),
    ...(classified.size < selectedIds.length
      ? { unclassifiedSelectedIds: selectedIds.filter((id) => !classified.has(id)) }
      : {})
  }
}

export function registerLiveParentTools(
  mcpServer: McpServer,
  authority: AuthorityClient = authorityJson,
  includeTools: readonly LiveToolName[] = ALL_LIVE_TOOL_NAMES
): void {
  const included = new Set<LiveToolName>(includeTools)
  const registerTool = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void
  const register = (name: LiveToolName, ...args: unknown[]) => {
    if (included.has(name)) registerTool(name, ...args)
  }

  register(
    'board_where',
    {
      description:
        "Read the live OpenPencil window: current page, selection, separately classified agent-card IDs, workspace identity, viewport, and pending appearance change. Read-only. Use only when the user's current location or selection matters; use board_query to discover saved content.",
      inputSchema: z.object({})
    },
    async () => {
      try {
        const [presence, theme, status] = await Promise.all([
          authority('/local-workspace/v1/presence'),
          authority('/local-workspace/v1/theme'),
          authority('/local-workspace/v1/status')
        ])
        if (!presence.ok) return authorityError(presence.payload, presence.status, 'board_where')
        if (!theme.ok) return authorityError(theme.payload, theme.status, 'board_where')
        if (!status.ok) return authorityError(status.payload, status.status, 'board_where')
        const identity = status.payload?.identity
        const rawPresence = isRecord(presence.payload?.presence) ? presence.payload.presence : null
        const classifiedPresence =
          rawPresence && typeof rawPresence.pageId === 'string'
            ? await classifyPresenceSelection(authority, rawPresence, rawPresence.pageId)
            : rawPresence
        return ok(
          {
            presence: classifiedPresence,
            theme: theme.payload?.theme ?? null,
            workspace:
              identity && typeof identity === 'object'
                ? {
                    documentId:
                      'documentId' in identity && typeof identity.documentId === 'string'
                        ? identity.documentId
                        : '',
                    documentName:
                      'documentName' in identity && typeof identity.documentName === 'string'
                        ? identity.documentName
                        : '',
                    workspaceId:
                      'workspaceId' in identity && typeof identity.workspaceId === 'string'
                        ? identity.workspaceId
                        : ''
                  }
                : null
          },
          'board_where'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'board_query',
    {
      description:
        'Discover and read saved content on one exact Board page. With only page_id, return the compact top-level map. Add query to filter by name, text, type, parent, or region. Add 1-25 object_ids to read exact objects together. detail defaults to summary; request full, code_object, or mermaid only for exact IDs that need those fields. Read-only.',
      inputSchema: boardQuerySchema
    },
    async (args: BoardQueryArgs) => {
      try {
        const response = await contextBoundBoardQuery(authority, args)
        if (!response.ok) return authorityError(response.payload, response.status, 'board_query')
        return ok(
          {
            result: response.payload?.result ?? null,
            target: response.payload?.target ?? null
          },
          'board_query'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'trace_query',
    {
      description:
        'Search and read bounded persisted Trace context. Use when the user names a Trace session tag (for example “check patient-flow session”), asks about earlier activity, names a spoken turn, or an important referent remains unresolved after attached evidence. Provide exactly one of session_tag, query, task_cursor, latest_spoken_turn, spoken_turn_id, or spoken_text. Session tags are exact, voice-friendly handles. Results include compact matching events and targets; Trace is read-only context, not current Board state.',
      inputSchema: traceQuerySchema
    },
    async (args: TraceQueryArgs) => {
      try {
        const response = await authority('/local-workspace/v1/rpc', {
          body: JSON.stringify({ args, command: 'trace_query' }),
          method: 'POST'
        })
        if (!response.ok) return authorityError(response.payload, response.status, 'trace_query')
        return ok(
          {
            result: response.payload?.result ?? null
          },
          'trace_query'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'board_apply',
    {
      description:
        'Apply 1-100 ordered operations to one exact Board page in a single guarded atomic save. create_mermaid stores validated Mermaid source in one selectable SVG-rendered Board frame; update_mermaid preserves its identity and geometry. create_image imports a completed local PNG, JPEG, WebP, or GIF directly as source-backed native Board media; never base64-encode it or wrap it in a Code Object. Bounds for create_image and create_code_object default to page coordinates and are converted when parent_id is nested; pass coordinate_space: "parent" only for already parent-local bounds. For a Code Object, prefer a built-in preset_id with JSON props/state; omit source because the preset owns its renderer. Supply name plus source only for genuinely custom behavior. Code Object appearance can follow system or request light/dark and can carry semantic token overrides. Typed create and update names are op values inside operations, not standalone tools. Generic create, update, reparent, and delete remain available for native Board nodes. The authority converts typed fields into persisted records, validates Mermaid and TSX before saving, rejects concurrent races, and returns a compact receipt whose nodes[].bounds are absolute page bounds.',
      inputSchema: boardApplySchema
    },
    async (args: BoardApplyArgs) => {
      try {
        const response = await contextBoundBoardApply(authority, args)
        if (!response.ok) return authorityError(response.payload, response.status, 'board_apply')
        return ok(
          {
            result: response.payload?.result ?? null,
            target: response.payload?.target ?? null
          },
          'board_apply'
        )
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'board_screenshot',
    {
      description:
        'Capture exact Board object IDs as a bounded PNG only when the user explicitly requests a screenshot or visual inspection. When those objects are visible in the editor, this captures the composed live Board and authored Code Object UI without moving the camera. Otherwise it returns a clearly marked persisted-render fallback; cross-origin iframe pixels may still be unavailable. Read-only.',
      inputSchema: z.object({
        object_ids: z
          .array(z.string().trim().min(1))
          .min(1)
          .max(8)
          .describe('Exact Board object IDs to render together'),
        page_id: z.string().trim().min(1).describe('Exact Board page ID'),
        scale: z
          .number()
          .min(0.1)
          .max(2)
          .describe('Maximum render scale; large areas are fitted automatically')
          .optional()
      })
    },
    async (args: { object_ids: string[]; page_id: string; scale?: number }) => {
      try {
        const response = await authority('/local-workspace/v1/rpc', {
          body: JSON.stringify({
            args: {
              object_ids: args.object_ids,
              page_id: args.page_id,
              ...(args.scale === undefined ? {} : { scale: args.scale })
            },
            command: 'board_screenshot'
          }),
          method: 'POST'
        })
        if (!response.ok) {
          return authorityError(response.payload, response.status, 'board_screenshot')
        }
        const result = response.payload?.result
        if (!isRecord(result) || typeof result.base64 !== 'string') {
          return fail(new Error('board_screenshot returned no PNG image.'))
        }
        if (result.mimeType !== 'image/png') {
          return fail(new Error('board_screenshot returned an unsupported image type.'))
        }
        const bytes = Buffer.byteLength(result.base64, 'base64')
        if (bytes > MAX_SCREENSHOT_BYTES) {
          return fail(new Error('board_screenshot image is too large; select fewer objects.'))
        }
        const { base64, ...metadata } = result
        return {
          content: [
            { text: JSON.stringify(metadata), type: 'text' as const },
            { data: base64, mimeType: 'image/png', type: 'image' as const }
          ]
        }
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'board_go',
    {
      description:
        'Move the live OpenPencil camera only for an explicit user navigation request in the Board conversation that received it. Never dispatch navigation to another chat. With no name, focuses the live embed on the current Board. A query or page_name is a proper name only.',
      inputSchema: z.object({
        object_ids: z
          .array(z.string().trim().min(1))
          .min(1)
          .max(24)
          .describe('Exact Board object IDs to select and reveal')
          .optional(),
        page_id: z.string().trim().min(1).describe('Exact Board page ID').optional(),
        page_name: z
          .string()
          .trim()
          .min(1)
          .describe('Board page name; unique match required')
          .optional(),
        query: z.string().trim().min(1).describe('Proper name of a Board or object').optional(),
        region: z
          .object({
            height: z.number().positive(),
            width: z.number().positive(),
            x: z.number(),
            y: z.number()
          })
          .describe('Page-space rectangle to frame')
          .optional()
      })
    },
    async (args: {
      object_ids?: string[]
      page_id?: string
      page_name?: string
      query?: string
      region?: RegionArgs
    }) => {
      try {
        const response = await authority('/local-workspace/v1/navigation', {
          body: JSON.stringify({
            ...(args.object_ids ? { objectIds: args.object_ids } : {}),
            ...(args.page_id ? { pageId: args.page_id } : {}),
            ...(args.page_name ? { pageName: args.page_name } : {}),
            ...(args.query ? { query: args.query } : {}),
            ...(args.region ? { region: args.region } : {})
          }),
          method: 'POST'
        })
        if (!response.ok) return authorityError(response.payload, response.status, 'board_go')
        return ok({ intent: response.payload?.intent ?? null }, 'board_go')
      } catch (error) {
        return fail(error)
      }
    }
  )

  register(
    'set_theme',
    {
      description:
        'Set the live OpenPencil window to light, dark, or auto. Call it directly in the Board conversation that received the appearance request; never dispatch theme-only work.',
      inputSchema: z.object({
        theme: z
          .enum(['light', 'dark', 'auto'])
          .describe('Appearance for the live OpenPencil window')
      })
    },
    async (args: { theme: 'auto' | 'dark' | 'light' }) => {
      try {
        const response = await authority('/local-workspace/v1/theme', {
          body: JSON.stringify({ theme: args.theme }),
          method: 'POST'
        })
        if (!response.ok) return authorityError(response.payload, response.status, 'set_theme')
        return ok({ theme: response.payload?.theme ?? null }, 'set_theme')
      } catch (error) {
        return fail(error)
      }
    }
  )
}
