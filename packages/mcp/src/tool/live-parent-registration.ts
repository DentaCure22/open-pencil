import { Buffer } from 'node:buffer'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import { fail, ok } from '#mcp/result'
import { authorityJson } from '#mcp/tool/authority-client'

type RegionArgs = Rect
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function authorityError(payload: Record<string, unknown> | null, status: number, action: string) {
  const message =
    typeof payload?.error === 'string' ? payload.error : `${action} failed (${String(status)}).`
  return fail(new Error(message))
}

export function registerLiveParentTools(mcpServer: McpServer): void {
  const register = mcpServer.registerTool.bind(mcpServer) as (...a: unknown[]) => void

  register(
    'board_where',
    {
      description:
        'Read the live OpenPencil window: current Board page, selected object IDs, workspace identity, viewport, and pending appearance change. Read-only. Workers may call this once to ground Board work; it does not navigate or mutate.',
      inputSchema: z.object({})
    },
    async () => {
      try {
        const [presence, theme, status] = await Promise.all([
          authorityJson('/local-workspace/v1/presence'),
          authorityJson('/local-workspace/v1/theme'),
          authorityJson('/local-workspace/v1/status')
        ])
        if (!presence.ok) return authorityError(presence.payload, presence.status, 'board_where')
        if (!theme.ok) return authorityError(theme.payload, theme.status, 'board_where')
        if (!status.ok) return authorityError(status.payload, status.status, 'board_where')
        const identity = status.payload?.identity
        return ok(
          {
            presence: presence.payload?.presence ?? null,
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
    'board_screenshot',
    {
      description:
        'Render exact saved Board object IDs as a bounded PNG for visual inspection. Read-only and available to workers. It does not move the camera or capture live iframe pixels.',
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
        const response = await authorityJson('/local-workspace/v1/rpc', {
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
        'Move the live OpenPencil camera. Live-parent only. Never dispatch navigation to a worker. With no name, focuses the live embed on the current Board. A query or page_name is a proper name only.',
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
        const response = await authorityJson('/local-workspace/v1/navigation', {
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
        'Set the live OpenPencil window to light, dark, or auto. Live-parent only. Never dispatch appearance changes to a worker.',
      inputSchema: z.object({
        theme: z
          .enum(['light', 'dark', 'auto'])
          .describe('Appearance for the live OpenPencil window')
      })
    },
    async (args: { theme: 'auto' | 'dark' | 'light' }) => {
      try {
        const response = await authorityJson('/local-workspace/v1/theme', {
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
