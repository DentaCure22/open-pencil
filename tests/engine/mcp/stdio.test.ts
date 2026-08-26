import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { AddressInfo } from 'node:net'

import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { WebSocketServer, type WebSocket } from 'ws'

import {
  ALL_TOOLS,
  FigmaAPI,
  SceneGraph,
  computeAllLayouts,
  executeRpcCommand
} from '@open-pencil/core'

import { expectDefined, getNodeOrThrow } from '#tests/helpers/assert'

function createMockApp() {
  const graph = new SceneGraph()
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  let clientWs: WebSocket | null = null
  const requests: Array<{
    command: string
    args?: {
      name?: string
      document_id?: string
      page_id?: string
      args?: Record<string, unknown>
      mutation?: {
        expectedRevision?: number
        requestId?: string
        taskId?: string
        traceId?: string
      }
    }
  }> = []

  wss.on('connection', (ws) => {
    clientWs = ws
    ws.send(
      JSON.stringify({
        type: 'register',
        token: 'mock-token',
        runtime_instance_id: 'runtime:stdio-test'
      })
    )

    ws.on('message', async (raw) => {
      const msg = JSON.parse(String(raw)) as {
        type: string
        id: string
        command: string
        args?: { name?: string; args?: Record<string, unknown> }
      }
      if (msg.type !== 'request') return
      requests.push({ command: msg.command, args: msg.args })

      try {
        let result: unknown
        if (msg.command === 'tool' && msg.args?.name) {
          const toolName = msg.args.name
          const def = ALL_TOOLS.find((t) => t.name === toolName)
          if (!def) throw new Error(`Unknown tool: ${toolName}`)
          const api = new FigmaAPI(graph)
          api.currentPage = api.wrapNode(graph.getPages()[0].id)
          result = await def.execute(api, msg.args.args ?? {})
          if (def.mutates) computeAllLayouts(graph)
        } else if (msg.command === 'save_file') {
          result = { ok: true }
        } else if (msg.command === 'set_theme') {
          result = { theme: msg.args?.mode }
        } else if (msg.command === 'list_documents') {
          result = {
            documents: [
              {
                id: 'doc-1',
                name: 'Mock document',
                active: true,
                current_page_id: graph.getPages()[0].id,
                current_page_name: graph.getPages()[0].name,
                pages: graph.getPages().map((page) => ({ id: page.id, name: page.name }))
              }
            ]
          }
        } else {
          result = executeRpcCommand(graph, msg.command, msg.args ?? {})
        }

        ws.send(JSON.stringify({ type: 'response', id: msg.id, ok: true, result }))
      } catch (e) {
        ws.send(
          JSON.stringify({
            type: 'response',
            id: msg.id,
            ok: false,
            error: e instanceof Error ? e.message : String(e)
          })
        )
      }
    })
  })

  const port = new Promise<number>((resolve) => {
    wss.on('listening', () => resolve((wss.address() as AddressInfo).port))
  })

  return {
    graph,
    requests,
    wss,
    port,
    close: () => {
      clientWs?.close()
      wss.close()
    }
  }
}

async function createStdioClient(wsPort: number) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['packages/mcp/src/stdio.ts'],
    env: {
      ...process.env,
      OPENPENCIL_MCP_TOOL_SEARCH: '0',
      PATH: process.env.PATH ?? '',
      WS_PORT: String(wsPort)
    },
    stderr: 'pipe'
  })

  const client = new Client({ name: 'test-stdio-client', version: '0.0.0' })

  await new Promise<void>((resolve) => {
    const stderr = transport.stderr
    if (stderr && 'on' in stderr) {
      ;(stderr as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('Connected to OpenPencil app')) {
          resolve()
        }
      })
    }
    void client.connect(transport).then(() => {
      setTimeout(resolve, 1000)
      return undefined
    })
  })

  return { client, transport }
}

function textContent(content: unknown): string {
  const items = content as { type: string; text: string }[]
  return expectDefined(
    items.find((c) => c.type === 'text'),
    'text content'
  ).text
}

function guardedMutationArgs(graph: SceneGraph, requestId: string) {
  return {
    content_document_id: graph.rootId,
    document_id: 'doc-1',
    expected_revision: 0,
    page_id: graph.getPages()[0].id,
    request_id: requestId,
    runtime_instance_id: 'runtime:stdio-test',
    workspace_id: 'workspace:stdio-test'
  }
}

describe('MCP stdio transport', () => {
  let app: ReturnType<typeof createMockApp>
  let client: Client
  let transport: StdioClientTransport

  beforeEach(async () => {
    app = createMockApp()
    const wsPort = await app.port
    const ctx = await createStdioClient(wsPort)
    client = ctx.client
    transport = ctx.transport
  })

  afterEach(async () => {
    await client.close()
    app.close()
  })

  test('lists tools over stdio', async () => {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('create_shape')
    expect(names).toContain('get_page_tree')
    expect(names).toContain('list_documents')
    expect(names).toContain('list_agent_chats')
    expect(names).toContain('get_agent_chat_context')
    expect(names).toContain('dispatch_work')
    expect(names).toContain('workmap_query')
    expect(names).toContain('workmap_apply')
    expect(names).toContain('set_theme')
    expect(names).not.toContain('save_file')
    expect(names).not.toContain('get_codegen_prompt')
    expect(names).not.toContain('query_trace_history')
    expect(names).not.toContain('board_read')
    expect(names).not.toContain('board_change')
    const createShape = expectDefined(
      tools.find((tool) => tool.name === 'create_shape'),
      'create_shape tool'
    )
    expect(JSON.stringify(createShape.inputSchema)).toContain('document_id')
    expect(JSON.stringify(createShape.inputSchema)).toContain('page_id')
    expect(JSON.stringify(createShape.inputSchema)).toContain('trace_id')
    expect(tools.length).toBeGreaterThan(30)
  })

  test('create_shape via stdio creates a node', async () => {
    const result = await client.callTool({
      name: 'create_shape',
      arguments: {
        ...guardedMutationArgs(app.graph, 'request:stdio-frame'),
        type: 'FRAME',
        x: 10,
        y: 20,
        width: 200,
        height: 100,
        name: 'StdioFrame'
      }
    })
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(textContent(result.content)) as {
      id: string
      name: string
      type: string
    }
    expect(data.type).toBe('FRAME')
    expect(data.name).toBe('StdioFrame')

    expect(getNodeOrThrow(app.graph, data.id).width).toBe(200)
  })

  test('tool target fields are sent in the app RPC envelope', async () => {
    const result = await client.callTool({
      name: 'create_shape',
      arguments: {
        content_document_id: 'content-document-1',
        document_id: 'doc-1',
        expected_revision: 42,
        page_id: 'page-1',
        request_id: 'request-1',
        runtime_instance_id: 'runtime:stdio-test',
        task_id: 'worker-1',
        trace_id: 'trace-1',
        workspace_id: 'workspace-1',
        type: 'FRAME',
        x: 10,
        y: 20,
        width: 200,
        height: 100,
        name: 'TargetedFrame'
      }
    })
    expect(result.isError).not.toBe(true)
    const request = expectDefined(
      app.requests.find((item) => item.command === 'tool' && item.args?.name === 'create_shape'),
      'tool request'
    )
    expect(request.args?.document_id).toBe('doc-1')
    expect(request.args?.content_document_id).toBe('content-document-1')
    expect(request.args?.page_id).toBe('page-1')
    expect(request.args?.workspace_id).toBe('workspace-1')
    expect(request.args?.args?.document_id).toBeUndefined()
    expect(request.args?.args?.content_document_id).toBeUndefined()
    expect(request.args?.args?.page_id).toBeUndefined()
    expect(request.args?.args?.workspace_id).toBeUndefined()
    expect(request.args?.mutation).toEqual({
      expectedRevision: 42,
      requestId: 'request-1',
      taskId: 'worker-1',
      traceId: 'trace-1'
    })
    expect(request.args?.args?.trace_id).toBeUndefined()
  })

  test('list_documents via stdio returns documents', async () => {
    const result = await client.callTool({ name: 'list_documents', arguments: {} })
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(textContent(result.content)) as {
      documents: Array<{ id: string; current_page_id?: string }>
    }
    expect(data.documents.length).toBeGreaterThan(0)
    expect(typeof data.documents[0].id).toBe('string')
  })

  test('set_theme via stdio applies a theme', async () => {
    const result = await client.callTool({ name: 'set_theme', arguments: { mode: 'dark' } })
    expect(result.isError).not.toBe(true)
    const data = JSON.parse(textContent(result.content)) as { theme?: string }
    expect(JSON.stringify(data)).toContain('theme')
  })

  test('delete_node via stdio removes a node', async () => {
    const create = await client.callTool({
      name: 'create_shape',
      arguments: {
        ...guardedMutationArgs(app.graph, 'request:stdio-delete-fixture'),
        type: 'RECTANGLE',
        x: 0,
        y: 0,
        width: 50,
        height: 50
      }
    })
    const { id } = JSON.parse(textContent(create.content)) as { id: string }

    expect(app.graph.getNode(id)).toBeDefined()

    await client.callTool({
      name: 'delete_node',
      arguments: {
        ...guardedMutationArgs(app.graph, 'request:stdio-delete'),
        id
      }
    })

    expect(app.graph.getNode(id)).toBeUndefined()
  })

  test('stderr does not contain JSON-RPC', async () => {
    const stderrChunks: string[] = []
    const stderr = transport.stderr
    if (stderr && 'on' in stderr) {
      ;(stderr as NodeJS.ReadableStream).on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString())
      })
    }

    await client.callTool({
      name: 'create_shape',
      arguments: {
        ...guardedMutationArgs(app.graph, 'request:stdio-stderr'),
        type: 'FRAME',
        x: 0,
        y: 0,
        width: 100,
        height: 100
      }
    })

    const allStderr = stderrChunks.join('')
    expect(allStderr).not.toContain('"jsonrpc"')
    expect(allStderr).not.toContain('"method"')
  })
})
