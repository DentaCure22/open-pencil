import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import {
  composeDispatchWorkPrompt,
  registerDispatchWorkTool
} from '#mcp/tool/dispatch-registration'
import { registerLiveParentTools } from '#mcp/tool/live-parent-registration'

type RegisteredTool = {
  description?: string
  inputSchema?: z.ZodType
}

function setup() {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(name: string, options: { description?: string; inputSchema: z.ZodType }) {
      tools.set(name, { description: options.description, inputSchema: options.inputSchema })
    }
  }
  registerDispatchWorkTool(server as McpServer)
  registerLiveParentTools(server as McpServer)
  return tools
}

describe('live-parent MCP registration', () => {
  test('registers the compact OpenPencil remote', () => {
    const tools = setup()
    expect([...tools.keys()].sort()).toEqual([
      'board_go',
      'board_screenshot',
      'board_where',
      'dispatch_work',
      'set_theme'
    ])
    expect(tools.get('board_screenshot')?.description).toContain('Read-only')
    expect(tools.get('board_screenshot')?.description).toContain('available to workers')
    expect(tools.get('board_where')?.description).toContain('Read-only')
    expect(tools.get('board_where')?.description).toContain('Workers may call this once')
    expect(tools.get('board_go')?.description).toContain('Never dispatch navigation')
    expect(tools.get('set_theme')?.description).toContain('light, dark, or auto')
    expect(tools.has('board_context')).toBe(false)
    expect(tools.has('board_build')).toBe(false)
    expect(tools.has('open_file')).toBe(false)
  })

  test('requires exact Board IDs for screenshots', () => {
    const schema = toolsSchema(setup(), 'board_screenshot')
    expect(Object.keys(schema.shape).sort()).toEqual(['object_ids', 'page_id', 'scale'])
    expect(schema.safeParse({ object_ids: ['0:42'], page_id: '0:2', scale: 1 }).success).toBe(true)
    expect(schema.safeParse({ object_ids: [], page_id: '0:2' }).success).toBe(false)
  })

  test('dispatch_work carries the exact words and their spoken window', () => {
    const tools = setup()
    expect(tools.get('dispatch_work')?.description).toContain('what the user said')
    const schema = tools.get('dispatch_work')?.inputSchema
    expect(schema).toBeDefined()
    expect(Object.keys((schema as z.ZodObject<Record<string, z.ZodType>>).shape).sort()).toEqual([
      'continue_thread_id',
      'done',
      'exact_words',
      'turn_ended_at',
      'turn_started_at'
    ])
  })

  test('invokes the OpenPencil skill with Pi command syntax', () => {
    const prompt = composeDispatchWorkPrompt({
      done: 'The requested Board change is complete.',
      exact_words: 'Move the card to the left.',
      turn_ended_at: '2026-08-21T15:00:03.000Z',
      turn_started_at: '2026-08-21T15:00:00.000Z'
    })

    expect(prompt).toStartWith('/skill:openpencil Move the card to the left.')
    expect(prompt).toContain('Spoken turn: 2026-08-21T15:00:00.000Z to 2026-08-21T15:00:03.000Z')
    expect(prompt).not.toContain('$openpencil')
  })
})

function toolsSchema(tools: Map<string, RegisteredTool>, name: string) {
  const schema = tools.get(name)?.inputSchema
  if (!schema || !('shape' in schema)) throw new Error(`Expected ${name} object schema`)
  return schema as z.ZodObject<Record<string, z.ZodType>>
}
