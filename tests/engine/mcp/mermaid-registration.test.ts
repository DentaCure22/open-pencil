import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { registerTools } from '#mcp/tool/registration'

type RegisteredTool = {
  description?: string
  inputSchema: z.ZodType
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

function setup() {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(
      name: string,
      options: { description?: string; inputSchema: z.ZodType },
      _handler: ToolHandler
    ) {
      tools.set(name, { description: options.description, inputSchema: options.inputSchema })
    }
  }
  registerTools(server as McpServer, {
    enableEval: false,
    sendRpc: async () => ({ ok: true, result: {} })
  })
  return tools
}

function requireTool(tools: Map<string, RegisteredTool>, name: string): RegisteredTool {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Missing registered tool: ${name}`)
  return tool
}

describe('Mermaid MCP registration', () => {
  test('documents the safe owner lifecycle and validates explicit additional-owner opt-in', () => {
    const tools = setup()
    const insert = requireTool(tools, 'insert_mermaid_diagram')
    const source = 'flowchart LR\n A --> B'

    expect(insert.description).toContain('ordinary OpenPencil Board')
    expect(insert.description).toContain('retain the returned owner_id')
    expect(insert.description).toContain('get_mermaid_source')
    expect(insert.description).toContain('allow_additional_owner')
    expect(insert.inputSchema.parse({ source, allow_additional_owner: true })).toMatchObject({
      allow_additional_owner: true
    })
    expect(insert.inputSchema.parse({ source, workspace_id: 'workspace-stable' })).toMatchObject({
      workspace_id: 'workspace-stable'
    })
    expect(() => insert.inputSchema.parse({ source, allow_additional_owner: 'true' })).toThrow()

    const sourceReader = requireTool(tools, 'get_mermaid_source')
    expect(sourceReader.description).toContain('require reconciliation status "current"')
  })
})
