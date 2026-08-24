import { describe, expect, test } from 'bun:test'
import type { AddressInfo } from 'node:net'

import { serve } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import WebSocket from 'ws'

import { ALL_TOOLS, FigmaAPI, SceneGraph, computeAllLayouts } from '@open-pencil/core'

import { startServer } from '#mcp/server'
import {
  ADVERTISED_BOARD_TOOL_NAMES,
  INVOKE_TOOL_NAME,
  SEARCH_TOOLS_NAME,
  searchOpenPencilTools
} from '#mcp/tool/search'

function waitForWsListening(wss: InstanceType<typeof WebSocket.Server>): Promise<number> {
  return new Promise((resolve) => {
    if (wss.address()) {
      resolve((wss.address() as AddressInfo).port)
      return
    }
    wss.on('listening', () => resolve((wss.address() as AddressInfo).port))
  })
}

function connectMockBrowser(port: number, graph: SceneGraph): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          active: true,
          runtime_instance_id: 'runtime:tool-search',
          token: 'test-token',
          type: 'register'
        })
      )
      ws.on('message', async (raw) => {
        const msg = JSON.parse(String(raw)) as {
          args?: { args?: Record<string, unknown>; name?: string }
          command: string
          id: string
          type: string
        }
        if (msg.type !== 'request') return
        try {
          if (msg.command === 'tool' && msg.args?.name) {
            const def = ALL_TOOLS.find((tool) => tool.name === msg.args?.name)
            if (!def) throw new Error(`Unknown tool: ${msg.args.name}`)
            const api = new FigmaAPI(graph)
            api.currentPage = api.wrapNode(graph.getPages()[0].id)
            const result = await def.execute(api, msg.args.args ?? {})
            if (def.mutates) computeAllLayouts(graph)
            ws.send(JSON.stringify({ id: msg.id, ok: true, result, type: 'response' }))
            return
          }
          ws.send(JSON.stringify({ id: msg.id, ok: true, result: {}, type: 'response' }))
        } catch (error) {
          ws.send(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              id: msg.id,
              ok: false,
              type: 'response'
            })
          )
        }
      })
      resolve(ws)
    })
    ws.on('error', reject)
  })
}

function parseResult(result: { content: Array<{ text?: string; type: string }> }): unknown {
  const text = result.content.find((part) => part.type === 'text')?.text
  return text ? JSON.parse(text) : null
}

describe('OpenPencil MCP tool search', () => {
  test('ranks catalog tools without dumping the full list', () => {
    const hits = searchOpenPencilTools('create a rectangle frame')
    expect(hits.some((hit) => hit.name === 'create_shape')).toBe(true)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThanOrEqual(8)
  })

  test('lists a small advertised set plus search and invoke', async () => {
    const graph = new SceneGraph()
    const { app, close, wss } = startServer({ httpPort: 0, toolSearch: true, wsPort: 0 })
    const httpServer = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const httpPort = (httpServer.address() as AddressInfo).port
    const wsPort = await waitForWsListening(wss)
    const browser = await connectMockBrowser(wsPort, graph)
    const client = new Client({ name: 'search-client', version: '0.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`))
    )

    try {
      const { tools } = await client.listTools()
      const names = tools.map((tool) => tool.name)
      expect(names).toContain(SEARCH_TOOLS_NAME)
      expect(names).toContain(INVOKE_TOOL_NAME)
      expect(names).toContain('get_node')
      expect(names).not.toContain('create_shape')
      expect(names).not.toContain('set_fill')
      for (const name of ADVERTISED_BOARD_TOOL_NAMES) expect(names).toContain(name)
      expect(tools.length).toBeLessThan(20)

      const search = parseResult(
        await client.callTool({
          arguments: { query: 'create a frame' },
          name: SEARCH_TOOLS_NAME
        })
      ) as { tools: Array<{ name: string }> }
      expect(search.tools.some((tool) => tool.name === 'create_shape')).toBe(true)

      const created = parseResult(
        await client.callTool({
          arguments: {
            arguments: {
              height: 80,
              name: 'Searched',
              type: 'FRAME',
              width: 120,
              x: 0,
              y: 0
            },
            content_document_id: graph.rootId,
            document_id: 'doc-1',
            expected_revision: 0,
            name: 'create_shape',
            page_id: graph.getPages()[0].id,
            request_id: 'request:search-create',
            runtime_instance_id: 'runtime:tool-search',
            workspace_id: 'workspace:tool-search'
          },
          name: INVOKE_TOOL_NAME
        })
      ) as { name?: string; type?: string }
      expect(created.name).toBe('Searched')
      expect(created.type).toBe('FRAME')
    } finally {
      await client.close()
      browser.close()
      close()
      httpServer.close()
    }
  })
})
