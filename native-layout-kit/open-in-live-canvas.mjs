const appURL = 'http://127.0.0.1:1420'
const bridgeURL = 'http://127.0.0.1:7600'
const browserFileURL = 'http://127.0.0.1:1431/flow-review.fig'

const healthResponse = await fetch(`${bridgeURL}/health`)
if (!healthResponse.ok) throw new Error(`Bridge health failed: HTTP ${healthResponse.status}`)
const health = await healthResponse.json()
if (health.status !== 'ok' || !health.token) throw new Error('No attached OpenPencil document')
console.log('bridge attached')

async function rpc(command, args = {}) {
  const response = await fetch(`${bridgeURL}/rpc`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${health.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ command, args }),
    signal: AbortSignal.timeout(15000)
  })
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }))
  if (!response.ok || payload.ok === false) {
    throw new Error(`${command}: ${payload.error ?? `HTTP ${response.status}`}`)
  }
  return payload.result ?? payload
}

const before = await rpc('list_documents')
console.log(JSON.stringify({ before }, null, 2))
const opened = await rpc('open_file', { path: browserFileURL })
console.log(JSON.stringify({ opened }, null, 2))
await new Promise((resolve) => setTimeout(resolve, 1200))
const documents = await rpc('list_documents')

console.log(JSON.stringify({ opened, browserFileURL, documents }, null, 2))
