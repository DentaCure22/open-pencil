import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const workspace = resolve(import.meta.dirname, '..')
const figPath = resolve(workspace, 'artifacts/native-layout-kit/flow-review.fig')
const htmlPath = resolve(workspace, 'artifacts/native-layout-kit/flow-review.inline.html')
const cssPath = resolve(import.meta.dirname, 'tokens.css')

const server = createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Cache-Control', 'no-store')

  try {
    if (request.url === '/flow-review.fig') {
      response.setHeader('Content-Type', 'application/octet-stream')
      response.end(await readFile(figPath))
      return
    }

    if (request.url === '/flow-review') {
      const [html, css] = await Promise.all([
        readFile(htmlPath, 'utf8'),
        readFile(cssPath, 'utf8')
      ])
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`)
      return
    }

    if (request.url === '/health') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ ok: true }))
      return
    }

    response.statusCode = 404
    response.end('Not found')
  } catch (error) {
    response.statusCode = 500
    response.end(error instanceof Error ? error.message : String(error))
  }
})

server.listen(1431, '127.0.0.1', () => {
  console.log('Native layout artifacts: http://127.0.0.1:1431')
})

