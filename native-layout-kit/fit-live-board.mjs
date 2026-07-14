const bridgeURL = 'http://127.0.0.1:7600'
const health = await fetch(`${bridgeURL}/health`).then((response) => response.json())

async function request(body) {
  const response = await fetch(`${bridgeURL}/rpc`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${health.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  })
  const payload = await response.json()
  if (!response.ok || payload.ok === false) throw new Error(payload.error ?? `HTTP ${response.status}`)
  return payload.result ?? payload
}

const documents = await request({ command: 'list_documents', args: {} })
const active = documents.documents.find((document) => document.active)
if (!active) throw new Error('No active OpenPencil document')

const target = { document_id: active.id, page_id: active.current_page_id }
const tree = await request({
  command: 'tool',
  args: { ...target, name: 'get_page_tree', args: { depth: 2 } }
})

const root = tree.tree?.children?.[0]
if (!root?.id) throw new Error(`No root frame found: ${JSON.stringify(tree)}`)

await request({
  command: 'tool',
  args: { ...target, name: 'select_nodes', args: { ids: [root.id] } }
})
await request({
  command: 'tool',
  args: { ...target, name: 'viewport_zoom_to_fit', args: { ids: [root.id] } }
})

console.log(JSON.stringify({ document: active.name, page: active.current_page_name, root }, null, 2))

