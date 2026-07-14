const bridgeURL = 'http://127.0.0.1:7600'
const health = await fetch(`${bridgeURL}/health`).then((response) => response.json())

const response = await fetch(`${bridgeURL}/rpc`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${health.token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ command: 'list_documents', args: {} }),
  signal: AbortSignal.timeout(5000)
})

console.log(await response.text())

