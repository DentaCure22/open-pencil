import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const bridgeURL = 'http://127.0.0.1:7600'
const fileURL = 'http://127.0.0.1:1431/flow-review.fig'
const outputPath = resolve(import.meta.dirname, '../artifacts/native-layout-kit/flow-review-live.png')
const reopen = process.argv.includes('--reopen')

const health = await fetch(`${bridgeURL}/health`).then((response) => response.json())
if (health.status !== 'ok' || !health.token) throw new Error('No attached OpenPencil renderer')

async function request(body) {
  const response = await fetch(`${bridgeURL}/rpc`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${health.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  })
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok || payload.ok === false) throw new Error(payload.error ?? `HTTP ${response.status}`)
  return payload.result ?? payload
}

let documents = await request({ command: 'list_documents', args: {} })
let active = documents.documents.find((document) => document.active)

if (reopen || active?.path !== fileURL) {
  await request({ command: 'open_file', args: { path: fileURL } })
  documents = await request({ command: 'list_documents', args: {} })
  active = documents.documents.find((document) => document.active)
}

if (!active || active.path !== fileURL) {
  throw new Error(`Native board is not active: ${JSON.stringify(documents)}`)
}

const target = { document_id: active.id, page_id: active.current_page_id }
const tree = await request({
  command: 'tool',
  args: { ...target, name: 'get_page_tree', args: { depth: 2 } }
})
const root = tree.tree?.children?.[0] ?? tree.children?.[0]
if (!root?.id) throw new Error(`No root board found: ${JSON.stringify(tree)}`)

await new Promise((resolveDelay) => setTimeout(resolveDelay, 1200))
const exported = await request({
  command: 'tool',
  args: { ...target, name: 'export_image', args: { ids: [root.id], format: 'PNG', scale: 1 } }
})
if (!exported.base64) throw new Error(`Renderer returned no image: ${JSON.stringify(exported)}`)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, Buffer.from(exported.base64, 'base64'))

console.log(JSON.stringify({ outputPath, document: active.name, page: active.current_page_name, root }, null, 2))
