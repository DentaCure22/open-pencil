import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { registerTools } from '#mcp/tool/registration'

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

type RegisteredTool = {
  handler: ToolHandler
  inputSchema: z.ZodType
}

function setup(name = 'query_trace_history') {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(name: string, options: { inputSchema: z.ZodType }, handler: ToolHandler) {
      tools.set(name, { handler, inputSchema: options.inputSchema })
    }
  }
  registerTools(server as McpServer, {
    enableEval: false,
    sendRpc: async () => ({ ok: true, result: {} })
  })
  const trace = tools.get(name)
  if (!trace) throw new Error(`${name} was not registered`)
  return trace
}

describe('Trace MCP registration', () => {
  test('registers deterministic gesture lookup independently of ranked history', () => {
    const gesture = setup('get_trace_gesture')
    expect(gesture.inputSchema.parse({ latest: true })).toEqual({ latest: true })
    expect(gesture.inputSchema.parse({ gesture_id: 'gesture:1', include_image: false })).toEqual({
      gesture_id: 'gesture:1',
      include_image: false
    })
    expect(() => gesture.inputSchema.parse({})).toThrow('exactly one')
    expect(() => gesture.inputSchema.parse({ gesture_id: 'gesture:1', latest: true })).toThrow(
      'exactly one'
    )
  })

  test('accepts a Trace selector without runtime or Board identity', () => {
    const trace = setup()
    expect(trace.inputSchema.parse({ query: 'selected rectangle' })).toEqual({
      query: 'selected rectangle'
    })
  })

  test('requires one retrieval selector and keeps spoken turns on their recorded window', () => {
    const trace = setup()
    expect(() => trace.inputSchema.parse({})).toThrow('exactly one')
    expect(() =>
      trace.inputSchema.parse({
        query: 'selected rectangle',
        task_cursor: 'trace-cursor:1'
      })
    ).toThrow('exactly one')
    expect(() =>
      trace.inputSchema.parse({
        latest_spoken_turn: true,
        since: '2026-07-27T00:00:00.000Z'
      })
    ).toThrow('cannot be combined')
  })
})
