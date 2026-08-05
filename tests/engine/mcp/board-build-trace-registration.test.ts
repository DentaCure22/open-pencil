import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { registerTools } from '#mcp/tool/registration'

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

type RegisteredTool = {
  handler: ToolHandler
  inputSchema: z.ZodType
}

function setup(sendRpc: (body: Record<string, unknown>) => Promise<unknown>) {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(name: string, options: { inputSchema: z.ZodType }, handler: ToolHandler) {
      tools.set(name, { handler, inputSchema: options.inputSchema })
    }
  }
  registerTools(server as McpServer, { enableEval: false, sendRpc })
  const build = tools.get('board_build')
  if (!build) throw new Error('board_build was not registered')
  return { build, tools }
}

function textResult(result: unknown) {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    throw new TypeError('Expected MCP content result')
  }
  const content = result.content
  if (!Array.isArray(content) || content[0]?.type !== 'text') {
    throw new TypeError('Expected MCP text result')
  }
  return JSON.parse(content[0].text) as unknown
}

function traceBuildPlan() {
  return {
    artifacts: [
      {
        alias: 'note',
        recipe: {
          body: 'Placed where the user marked.',
          kind: 'native_card',
          placement: { target: { kind: 'trace_region' } },
          title: 'Trace note'
        }
      }
    ],
    connections: [],
    contract: 'board-build-plan/v1',
    operations: [
      { kind: 'object.update', object_id: '$trace', patch: { opacity: 0.8 } },
      { kind: 'connection.delete_traced', orientation: 'vertical' }
    ]
  }
}

describe('Trace-targeted Board build MCP registration', () => {
  test('resolves Trace and mutates through one model-facing board_build call', async () => {
    const calls: Record<string, unknown>[] = []
    const { build, tools } = setup(async (body) => {
      calls.push(body)
      if (body.command === 'trace_get_gesture') {
        return {
          ok: true,
          result: {
            gesture: {
              boardOrigin: {
                contentDocumentId: 'content:1',
                documentId: 'tab:1',
                pageId: 'page:1',
                runtimeInstanceId: 'runtime:1',
                workspaceId: 'workspace:1'
              },
              candidates: {
                items: [{ stableId: 'frame:card' }],
                primaryTargetId: 'frame:card'
              },
              geometry: { pageRegion: { height: 80, width: 160, x: 70, y: 50 } },
              gestureId: 'gesture:1'
            },
            status: 'matched'
          }
        }
      }
      if (body.command === 'board_prepare_edit') {
        return {
          ok: true,
          result: {
            board_build_base: {
              content_document_id: 'content:1',
              context_token: 'context:1',
              contract: 'board-build/v1',
              document_id: 'tab:1',
              expected_revision: 14,
              page_id: 'page:1',
              runtime_instance_id: 'runtime:1',
              workspace_id: 'workspace:1'
            },
            contract: 'board-edit-context/v1',
            gesture_id: 'gesture:1',
            resolution: {
              candidate_object_ids: ['frame:card', 'frame:peer'],
              selected_object_id: 'frame:card',
              status: 'resolved'
            },
            trace_connections: { count: 2, items: [], truncated: false },
            trace_region: { height: 80, width: 160, x: 70, y: 50 }
          }
        }
      }
      return { ok: true, result: { status: { command: 'completed', mutation: 'applied' } } }
    })

    expect(tools.has('board_prepare_edit')).toBe(false)
    const parsed = build.inputSchema.parse({
      intent: 'Update the traced card and add a note',
      plan: traceBuildPlan(),
      request_id: 'request:trace-build',
      trace: { latest: true }
    })
    const result = textResult(await build.handler(parsed))

    expect(calls.map((call) => call.command)).toEqual([
      'trace_get_gesture',
      'board_prepare_edit',
      'board_build'
    ])
    expect(calls[2]).toMatchObject({
      args: {
        context_token: 'context:1',
        expected_revision: 14,
        plan: {
          artifacts: [
            {
              recipe: {
                placement: { target: { height: 80, kind: 'region', width: 160, x: 70, y: 50 } }
              }
            }
          ],
          operations: [
            { object_id: 'frame:card' },
            {
              kind: 'connection.delete_traced',
              object_ids: ['frame:card', 'frame:peer'],
              orientation: 'vertical',
              region: { height: 80, width: 160, x: 70, y: 50 }
            }
          ]
        },
        trace_id: 'gesture:1'
      },
      command: 'board_build'
    })
    expect(result).toMatchObject({
      trace_build_handshake: {
        contract: 'board-build-trace/v1',
        gesture_id: 'gesture:1',
        resolved_placeholders: {
          connection_scopes: 1,
          object_references: 1,
          region_references: 1
        },
        semantic_rpc_calls: {
          board_build: 1,
          board_prepare_edit: 1,
          total: 3,
          trace_get_gesture: 1
        },
        traced_connections: 2
      }
    })
  })

  test('fails before mutation when $trace has no selected object', async () => {
    const calls: Record<string, unknown>[] = []
    const { build } = setup(async (body) => {
      calls.push(body)
      if (body.command === 'trace_get_gesture') {
        return {
          ok: true,
          result: {
            gesture: {
              boardOrigin: {
                contentDocumentId: 'content:1',
                documentId: 'tab:1',
                pageId: 'page:1'
              },
              candidates: { items: [] },
              geometry: { pageRegion: { height: 20, width: 20, x: 0, y: 0 } },
              gestureId: 'gesture:none'
            },
            status: 'matched'
          }
        }
      }
      return {
        ok: true,
        result: {
          board_build_base: {},
          contract: 'board-edit-context/v1',
          gesture_id: 'gesture:none',
          resolution: { status: 'none' },
          trace_region: { height: 20, width: 20, x: 0, y: 0 }
        }
      }
    })

    const result = await build.handler(
      build.inputSchema.parse({
        intent: 'Update it',
        plan: traceBuildPlan(),
        request_id: 'request:no-target',
        trace: { latest: true }
      })
    )
    expect(result).toMatchObject({ isError: true })
    expect(calls.some((call) => call.command === 'board_build')).toBe(false)
  })
})
