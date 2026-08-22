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

export function localWorkspaceRoot(): string {
  return (
    process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
    path.join(homedir(), '.openpencil', 'local-workspace-authority-v1')
  )
}

export function defaultWorkspacePath(): string {
  return path.join(localWorkspaceRoot(), 'workspace.json')
}

export function resolveWorkspacePath(explicit?: string): string {
  if (!explicit) return defaultWorkspacePath()
  const resolved = path.resolve(explicit)
  return resolved.endsWith('.json') ? resolved : path.join(resolved, 'workspace.json')
}

export async function readEditorPresence(): Promise<EditorPresence | null> {
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
  let response: Response
  try {
    response = await fetch(`http://127.0.0.1:${String(port)}/local-workspace/v1/presence`, {
      headers: { Authorization: `Bearer ${auth.token}` },
      signal: AbortSignal.timeout(5000)
    })
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
    throw new Error(
      `Could not reach the OpenPencil local authority at 127.0.0.1:${String(port)}${cause}. ` +
        'The dev server is not running and agent-auth.json is stale; start OpenPencil dev first.'
    )
  }
  if (!response.ok) {
    throw new Error(`Presence request failed (${String(response.status)}).`)
  }
  const payload = (await response.json()) as { presence?: EditorPresence | null }
  return payload.presence ?? null
}
