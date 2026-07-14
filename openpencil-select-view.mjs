import { Client } from '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/.bun/@modelcontextprotocol+sdk@1.28.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js'
import { StreamableHTTPClientTransport } from '/Users/omar/Documents/Documents - Omar’s MacBook Pro/Codex/Smylr-Elite/archive/agent-tooling/open-pencil-base/node_modules/.bun/@modelcontextprotocol+sdk@1.28.0/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js'

const requestedName = process.argv.slice(2).join(' ')
if (!requestedName) throw new Error('Pass the exact view name to select')

const client = new Client({ name: 'openpencil-select-view', version: '1.0.0' })
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:7600/mcp'), {
  requestInit: { headers: { Authorization: 'Bearer codex-canvas-demo' } }
})
await client.connect(transport)

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args })
  if (result.isError) throw new Error(result.content?.[0]?.text ?? `${name} failed`)
  const value = result.content?.find((item) => item.type === 'text')?.text
  return value ? JSON.parse(value) : result
}

await call('switch_page', { page: 'Page 1' })
const found = await call('find_nodes', { name: requestedName, type: 'FRAME' })
const exact = found.nodes.filter((node) => node.name === requestedName)
if (exact.length !== 1) throw new Error(`Expected one exact view, found ${exact.length}`)
const selected = await call('select_nodes', { ids: [exact[0].id] })
console.log(JSON.stringify({ view: exact[0], selected }, null, 2))
await client.close()
