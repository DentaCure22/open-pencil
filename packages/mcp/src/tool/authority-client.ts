import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

type AuthorityJsonPayload = Record<string, unknown>

function isAuthorityJsonPayload(value: unknown): value is AuthorityJsonPayload {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function authorityRoot(): string {
  return (
    process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
    path.join(homedir(), '.openpencil', 'local-workspace-authority-v1')
  )
}

export async function agentAuth(): Promise<{ port: number; token: string }> {
  const authPath = path.join(authorityRoot(), 'agent-auth.json')
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(authPath, 'utf8'))
  } catch {
    throw new Error(
      'The local workspace authority has not published agent-auth.json. Start the OpenPencil dev server, then retry.'
    )
  }
  const record = parsed as { port?: unknown; token?: unknown }
  if (typeof record.token !== 'string' || record.token.length === 0) {
    throw new Error('agent-auth.json exists but has no token; restart the OpenPencil dev server.')
  }
  return { port: typeof record.port === 'number' ? record.port : 7602, token: record.token }
}

export function authorityConnectionFailure(error: unknown, port: number, action: string): Error {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new Error(`The local workspace authority did not answer while ${action}.`)
  }
  const cause =
    error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
  return new Error(
    `Could not reach the OpenPencil local authority at 127.0.0.1:${String(port)}${cause}. ` +
      'The OpenPencil dev server is not running and agent-auth.json is stale. Start the dev server, then retry.'
  )
}

export async function authorityJson(
  pathname: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; payload: Record<string, unknown> | null; status: number }> {
  const auth = await agentAuth()
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${auth.token}`)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${String(auth.port)}${pathname}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000)
    })
  } catch (error) {
    throw authorityConnectionFailure(error, auth.port, pathname)
  }
  const value: unknown = await response.json().catch(() => null)
  const payload = isAuthorityJsonPayload(value) ? value : null
  return { ok: response.ok, payload, status: response.status }
}
