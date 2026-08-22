import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Context, Hono, Next } from 'hono'

import { bearerToken, isAuthorized } from '#mcp/auth'

const ROUTE = '/agent-router/v1/attachments'
const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

function safeFileName(name: string) {
  const cleaned = path.basename(name).replaceAll(/[^a-zA-Z0-9._-]/g, '-')
  return cleaned || 'attachment'
}

export function registerAgentAttachmentRoutes(
  app: Hono,
  options: { authorityRoot: string; getAuthToken(): string | null }
): void {
  app.use(`${ROUTE}/*`, async (c: Context, next: Next) => {
    const expected = options.getAuthToken()
    if (!expected) return c.json({ error: 'Router unavailable' }, 503)
    if (!isAuthorized(bearerToken(c.req.header('authorization')), expected)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return next()
  })

  app.post(ROUTE, async (c) => {
    const body = await c.req.parseBody({ all: true })
    const values = body.files
    const files = (Array.isArray(values) ? values : [values]).filter(
      (value): value is File => value instanceof File
    )
    if (!files.length || files.length > MAX_ATTACHMENTS) {
      return c.json({ error: 'Attach between one and five files.' }, 422)
    }
    if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
      return c.json({ error: 'Each attachment must be 20 MB or smaller.' }, 422)
    }
    const directory = path.join(options.authorityRoot, 'agent-attachments')
    await mkdir(directory, { recursive: true })
    const attachments = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(directory, `${randomUUID()}-${safeFileName(file.name)}`)
        await writeFile(filePath, new Uint8Array(await file.arrayBuffer()))
        return {
          name: file.name,
          path: filePath,
          size: file.size,
          type: file.type
        }
      })
    )
    return c.json({ attachments }, 201)
  })
}
