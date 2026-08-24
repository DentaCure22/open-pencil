import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

export type EditorPresence = {
  pageId: string
  pageName: string
  updatedAt: string
  viewport?: { panX: number; panY: number; zoom: number }
  workspaceId: string
}

function localWorkspaceRoot(): string {
  return (
    process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
    path.join(homedir(), '.openpencil', 'local-workspace-authority-v1')
  )
}

export async function readEditorPresence(): Promise<EditorPresence | null> {
  const response = await localAuthorityRequest('/local-workspace/v1/presence')
  if (!response.ok) {
    throw new Error(`Presence request failed (${String(response.status)}).`)
  }
  const payload = (await response.json()) as { presence?: EditorPresence | null }
  return payload.presence ?? null
}

async function localAuthorityRequest(
  pathName: string,
  init: RequestInit = {}
): Promise<Response> {
  const root = localWorkspaceRoot()
  let auth: { port?: unknown; token?: unknown }
  try {
    auth = JSON.parse(await readFile(path.join(root, 'agent-auth.json'), 'utf8')) as {
      port?: unknown
      token?: unknown
    }
  } catch {
    throw new Error(
      'The local workspace authority has not published agent-auth.json; start the OpenPencil dev server first.'
    )
  }
  if (typeof auth.token !== 'string' || !auth.token) {
    throw new Error('agent-auth.json has no token; restart the OpenPencil dev server.')
  }
  const port = typeof auth.port === 'number' ? auth.port : 7602
  try {
    return await fetch(`http://127.0.0.1:${String(port)}${pathName}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(init.headers ?? {})
      },
      signal: init.signal ?? AbortSignal.timeout(5000)
    })
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
    throw new Error(
      `Could not reach the OpenPencil local authority at 127.0.0.1:${String(port)}${cause}. ` +
        'The dev server is not running and agent-auth.json is stale; start OpenPencil dev first.'
    )
  }
}

export async function setEditorTheme(
  theme: 'auto' | 'dark' | 'light'
): Promise<{ theme: 'auto' | 'dark' | 'light' | null }> {
  const response = await localAuthorityRequest('/local-workspace/v1/theme', {
    body: JSON.stringify({ theme }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST'
  })
  if (!response.ok) {
    throw new Error(`Theme request failed (${String(response.status)}).`)
  }
  const payload = (await response.json()) as { theme?: 'auto' | 'dark' | 'light' | null }
  return { theme: payload.theme ?? theme }
}
