import { describe, expect, test } from 'bun:test'

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { z } from 'zod'

import { registerTools } from '#mcp/tool/registration'

type RegisteredTool = {
  description?: string
  handler: ToolHandler
  inputSchema: z.ZodType
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>

function setup(
  sendRpc: (body: Record<string, unknown>) => Promise<unknown> = async () => ({
    ok: true,
    result: {}
  })
) {
  const tools = new Map<string, RegisteredTool>()
  const server = {
    registerTool(
      name: string,
      options: { description?: string; inputSchema: z.ZodType },
      handler: ToolHandler
    ) {
      tools.set(name, {
        description: options.description,
        handler,
        inputSchema: options.inputSchema
      })
    }
  }
  registerTools(server as McpServer, {
    enableEval: false,
    sendRpc
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
    expect(
      insert.inputSchema.parse({
        anchor_id: 'anchor-native',
        expected_revision: 12,
        request_id: 'request-12',
        source,
        task_id: 'task-12',
        trace_id: 'trace-12'
      })
    ).toMatchObject({
      anchor_id: 'anchor-native',
      expected_revision: 12,
      request_id: 'request-12',
      task_id: 'task-12',
      trace_id: 'trace-12'
    })
    expect(() => insert.inputSchema.parse({ source, allow_additional_owner: 'true' })).toThrow()

    const sourceReader = requireTool(tools, 'get_mermaid_source')
    expect(sourceReader.description).toContain('require reconciliation status "current"')
  })

  test('forwards exact target and standard mutation attribution to the Mermaid bridge', async () => {
    const calls: Record<string, unknown>[] = []
    const tools = setup(async (body) => {
      calls.push(body)
      return {
        ok: true,
        result: { applied: true, owner_id: 'mermaid-owner' },
        target: { boardRevision: 13, documentId: 'document-1', pageId: 'page-1' }
      }
    })
    const insert = requireTool(tools, 'insert_mermaid_diagram')

    await insert.handler({
      anchor_id: 'anchor-native',
      document_id: 'document-1',
      expected_revision: 12,
      page_id: 'page-1',
      request_id: 'request-12',
      source: 'flowchart LR\n A --> B',
      task_id: 'task-12',
      trace_id: 'trace-12',
      workspace_id: 'workspace-1'
    })

    expect(calls).toEqual([
      {
        command: 'insert_mermaid_diagram',
        args: {
          anchor_id: 'anchor-native',
          document_id: 'document-1',
          mutation: {
            expectedRevision: 12,
            requestId: 'request-12',
            taskId: 'task-12',
            traceId: 'trace-12'
          },
          page_id: 'page-1',
          source: 'flowchart LR\n A --> B',
          workspace_id: 'workspace-1'
        }
      }
    ])
  })
})
