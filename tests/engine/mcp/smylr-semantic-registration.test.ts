import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { registerSmylrSemanticTools } from '#mcp/tool/smylr-semantic-registration'

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}>

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
  registerSmylrSemanticTools(server as Pick<McpServer, 'registerTool'>, sendRpc)
  return tools
}

function requireTool(tools: Map<string, RegisteredTool>, name: string) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Missing registered tool: ${name}`)
  return tool
}

describe('Smylr semantic MCP registration', () => {
  test('does not expose predefined experience-form tools', () => {
    const tools = setup(async () => ({}))

    expect(tools.size).toBe(12)
    expect(tools.has('get_openpencil_context')).toBe(true)
    expect(tools.has('get_document_persistence_readiness')).toBe(true)
    expect(tools.has('inspect_live_container')).toBe(true)
    expect(tools.has('edit_live_container')).toBe(true)

    for (const removed of [
      'activate_experience_projection',
      'create_experience',
      'get_experience_family',
      'get_experience_projections',
      'get_field_runs',
      'open_experience_projection',
      'plan_experience_projection',
      'prepare_field_run',
      'propose_experience'
    ]) {
      expect(tools.has(removed)).toBe(false)
    }
  })

  test('requires an exact target for persistence readiness and forwards no tool fields', async () => {
    const requests: Record<string, unknown>[] = []
    const tools = setup(async (body) => {
      requests.push(body)
      return { ok: true, result: {} }
    })
    const tool = requireTool(tools, 'get_document_persistence_readiness')
    const target = { document_id: 'doc-1', page_id: 'page-1' }

    expect(() => tool.inputSchema.parse(target)).not.toThrow()
    expect(() => tool.inputSchema.parse({ page_id: 'page-1' })).toThrow()
    expect(() => tool.inputSchema.parse({ ...target, unknown_field: true })).toThrow()

    await tool.handler(target)
    expect(requests).toEqual([
      {
        command: 'smylr_semantic_tool',
        args: {
          document_id: 'doc-1',
          page_id: 'page-1',
          name: 'get_document_persistence_readiness',
          args: {}
        }
      }
    ])
  })

  test('keeps generic context targeting optional', () => {
    const schema = requireTool(
      setup(async () => ({})),
      'get_openpencil_context'
    ).inputSchema

    expect(() => schema.parse({})).not.toThrow()
    expect(() => schema.parse({ document_id: 'doc-1', page_id: 'board-1' })).not.toThrow()
  })
})
