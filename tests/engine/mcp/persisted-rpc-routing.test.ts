import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { SceneGraph } from '@open-pencil/core'

import { withPersistedAuthorityRouting } from '#mcp/persisted-rpc'
import { MCP_VERSION, registerTools } from '#mcp/server'

type DocumentsPayload = { documents?: unknown[] }

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function connectedClient(root: string) {
  const liveSender = () => {
    throw new Error('OpenPencil app is not connected')
  }
  const mcpServer = new McpServer({ name: 'open-pencil', version: MCP_VERSION })
  registerTools(mcpServer, {
    enableEval: false,
    mcpRoot: root,
    sendRpc: withPersistedAuthorityRouting(liveSender, { root })
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await mcpServer.connect(serverTransport)
  const client = new Client({ name: 'persisted-routing-test', version: '0.0.0' })
  await client.connect(clientTransport)
  return client
}

function textContent(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string; type?: string }> }).content
  const first = content?.find((part) => part.type === 'text')
  if (!first?.text) throw new Error('Expected a text content part')
  return first.text
}

describe('stdio persisted-authority routing', () => {
  test('list_documents executes against the persisted authority without a live app', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-persisted-routing-'))
    roots.push(root)
    const graph = new SceneGraph()
    await writeFile(
      path.join(root, 'workspace.json'),
      JSON.stringify({
        activeMode: [...graph.activeMode],
        documentColorSpace: graph.documentColorSpace,
        figKiwiVersion: graph.figKiwiVersion,
        figSchemaDeflated: graph.figSchemaDeflated,
        images: [...graph.images],
        instanceIndex: [...graph.instanceIndex].map(([id, nodeIds]) => [id, [...nodeIds]]),
        nodes: [...graph.nodes],
        rootId: graph.rootId,
        variableCollections: [...graph.variableCollections],
        variables: [...graph.variables],
        version: 2
      })
    )

    const client = await connectedClient(root)
    const result = await client.callTool({
      arguments: {},
      name: 'list_documents'
    })
    expect(result.isError ?? false).toBe(false)
    const payload = JSON.parse(textContent(result)) as DocumentsPayload
    expect(Array.isArray(payload.documents)).toBe(true)
    expect(textContent(result)).not.toContain('OpenPencil app is not connected')
  })

  test('reports the persisted authority as unavailable when no head was ever saved', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-persisted-routing-empty-'))
    roots.push(root)

    const client = await connectedClient(root)
    const result = await client.callTool({
      arguments: {},
      name: 'list_documents'
    })
    expect(result.isError).toBe(true)
    expect(textContent(result)).toContain('persisted_authority_unavailable')
    expect(textContent(result)).not.toContain('OpenPencil app is not connected')
  })
})
