import { AUTOMATION_HTTP_PORT } from '@open-pencil/core/constants'

const HEALTH_URL = `http://127.0.0.1:${AUTOMATION_HTTP_PORT}/health`
const RPC_URL = `http://127.0.0.1:${AUTOMATION_HTTP_PORT}/rpc`

let cachedToken: string | null = null
// A dev-server restart can take longer than the browser bridge's own reconnect cycle.
// Keep retries limited to durable named targets so semantic mistakes still fail immediately.
const NAMED_TARGET_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000, 5000, 8000] as const

type RpcArgs = { [key: string]: unknown }

type DurableAppTarget = { kind: 'document'; value: string } | { kind: 'workspace'; value: string }

function isRpcArgs(value: unknown): value is RpcArgs {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function durableAppTarget(args: unknown): DurableAppTarget | undefined {
  if (!isRpcArgs(args)) return undefined
  if (typeof args.workspace_id === 'string' && args.workspace_id.trim()) {
    return { kind: 'workspace', value: args.workspace_id.trim() }
  }
  if (typeof args.document_name === 'string' && args.document_name.trim()) {
    return { kind: 'document', value: args.document_name.trim() }
  }
  return undefined
}

function isRetryableDurableTargetError(error: unknown, target: DurableAppTarget): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const missingTarget =
    target.kind === 'workspace'
      ? `Workspace "${target.value}" not found`
      : `Document named "${target.value}" not found`
  return [
    'Active OpenPencil client changed',
    'Browser disconnected',
    'Could not connect to OpenPencil app',
    missingTarget,
    'OpenPencil app is not connected',
    'OpenPencil app is running but no document is open'
  ].some((fragment) => message.includes(fragment))
}

export function isRetryableNamedTargetError(error: unknown, documentName: string): boolean {
  return isRetryableDurableTargetError(error, { kind: 'document', value: documentName })
}

export function isRetryableWorkspaceTargetError(error: unknown, workspaceId: string): boolean {
  return isRetryableDurableTargetError(error, { kind: 'workspace', value: workspaceId })
}

function retryDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

export async function getAppToken(): Promise<string> {
  if (cachedToken) return cachedToken
  const res = await fetch(HEALTH_URL).catch(() => null)
  if (!res || !res.ok) {
    throw new Error(
      `Could not connect to OpenPencil app on localhost:${AUTOMATION_HTTP_PORT}.\n` +
        'Is the app running? Start it with: bun run tauri dev'
    )
  }
  const data = (await res.json()) as { status: string; token?: string }
  if (data.status !== 'ok' || !data.token) {
    throw new Error(
      'OpenPencil app is running but no document is open.\n' +
        'Open a document in the app, or provide a .fig file path.'
    )
  }
  cachedToken = data.token
  return cachedToken
}

async function doRpc<T>(token: string, command: string, args: unknown): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ command, args })
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string
      ok?: boolean
    }
    throw new Error(body.error ?? `RPC failed: HTTP ${res.status}`)
  }

  const body = (await res.json()) as { ok?: boolean; result?: T; error?: string }
  if (body.ok === false) throw new Error(body.error ?? 'RPC failed')
  return body.result as T
}

async function rpcOnce<T>(command: string, args: unknown): Promise<T> {
  let token = await getAppToken()
  try {
    return await doRpc<T>(token, command, args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('Unauthorized')) throw error
    cachedToken = null
    token = await getAppToken()
    return doRpc<T>(token, command, args)
  }
}

export async function rpc<T = unknown>(command: string, args: unknown = {}): Promise<T> {
  const durableTarget = durableAppTarget(args)
  let retryIndex = 0
  while (true) {
    try {
      return await rpcOnce<T>(command, args)
    } catch (error) {
      if (
        !durableTarget ||
        retryIndex >= NAMED_TARGET_RETRY_DELAYS_MS.length ||
        !isRetryableDurableTargetError(error, durableTarget)
      ) {
        throw error
      }
      cachedToken = null
      await retryDelay(NAMED_TARGET_RETRY_DELAYS_MS[retryIndex])
      retryIndex += 1
    }
  }
}

export function isAppMode(file?: string): boolean {
  return !file
}

export function requireFile(file?: string): string {
  if (!file) throw new Error('File path is required for headless mode')
  return file
}
