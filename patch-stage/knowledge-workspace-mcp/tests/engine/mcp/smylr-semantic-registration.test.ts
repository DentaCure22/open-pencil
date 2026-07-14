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
  registerSmylrSemanticTools(server as unknown as McpServer, sendRpc)
  return tools
}

function requireTool(tools: Map<string, RegisteredTool>, name: string) {
  const tool = tools.get(name)
  if (!tool) throw new Error(`Missing registered tool: ${name}`)
  return tool
}

describe('Smylr semantic MCP registration', () => {
  test('registers the knowledge query beside the existing semantic tools', () => {
    const tools = setup(async () => ({}))
    expect(tools.size).toBe(11)
    expect(tools.has('get_openpencil_context')).toBe(true)
    expect(tools.has('mutate_workspace_graph')).toBe(true)
    expect(tools.has('query_workspace_items')).toBe(true)
  })

  test('preserves every legacy workspace mutation input', () => {
    const tools = setup(async () => ({}))
    const schema = requireTool(tools, 'mutate_workspace_graph').inputSchema
    expect(() => schema.parse({ operation: 'create_version', kind: 'draft' })).not.toThrow()
    expect(() =>
      schema.parse({ operation: 'connect_states', item_id: 'a', target_item_id: 'b' })
    ).not.toThrow()
    expect(() => schema.parse({ operation: 'approve', item_id: 'a' })).not.toThrow()
  })

  test('requires the full envelope for typed knowledge batches', () => {
    const tools = setup(async () => ({}))
    const schema = requireTool(tools, 'mutate_workspace_graph').inputSchema
    const valid = {
      operation: 'apply_knowledge_mutations',
      expected_revision: 4,
      idempotency_key: 'knowledge-test-1',
      operations: [{ type: 'archive-object', objectId: 'note-1', expectedObjectRevision: 2 }]
    }
    expect(() => schema.parse(valid)).not.toThrow()
    expect(() => schema.parse({ ...valid, expected_revision: undefined })).toThrow()
    expect(() => schema.parse({ ...valid, idempotency_key: undefined })).toThrow()
    expect(() => schema.parse({ ...valid, operations: [] })).toThrow()
    expect(() => schema.parse({ ...valid, operations: [{ type: 'unknown-operation' }] })).toThrow()
  })

  test('bounds query pagination and relation traversal', () => {
    const tools = setup(async () => ({}))
    const schema = requireTool(tools, 'query_workspace_items').inputSchema
    expect(() =>
      schema.parse({
        text: 'dental chart',
        object_types: ['document-block', 'live-app-block'],
        relation: { object_id: 'state-1', direction: 'either' },
        limit: 50
      })
    ).not.toThrow()
    expect(() => schema.parse({ limit: 101 })).toThrow()
    expect(() => schema.parse({ relation: { object_id: 'state-1', direction: 'both' } })).toThrow()
  })

  test('forwards document/page targets and preserves the resolved target in results', async () => {
    const requests: Record<string, unknown>[] = []
    const tools = setup(async (body) => {
      requests.push(body)
      return {
        ok: true,
        result: { items: [], scope: 'workspace-metadata' },
        target: { documentId: 'doc-1', pageId: 'page-1' }
      }
    })
    const response = await requireTool(tools, 'query_workspace_items').handler({
      document_id: 'doc-1',
      page_id: 'page-1',
      text: 'note'
    })

    expect(requests).toEqual([
      {
        command: 'smylr_semantic_tool',
        args: {
          document_id: 'doc-1',
          page_id: 'page-1',
          name: 'query_workspace_items',
          args: { text: 'note' }
        }
      }
    ])
    const text = response.content.find((item) => item.type === 'text')?.text
    expect(text).toBeTruthy()
    const payload = JSON.parse(text ?? '{}') as { target?: { documentId?: string } }
    expect(payload.target?.documentId).toBe('doc-1')
  })
})
