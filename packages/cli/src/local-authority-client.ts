import { homedir } from 'node:os'
import path from 'node:path'

import {
  classifyRpcExecutionSurface,
  normalizePersistedExecutionError,
  persistedAuthorityUnavailableError
} from '@open-pencil/core/rpc'
import {
  LocalWorkspaceAuthorityStore,
  LocalWorkspaceBoardRuntime
} from '@open-pencil/mcp/local-workspace-authority'

import type { AppRpcEnvelope, AppRpcTarget } from '#cli/app-rpc-types'

type RpcArgs = Record<string, unknown>

type LocalAuthorityRpcClientOptions = {
  preferredWorkspaceId?: string | null
  root: string
}

type LocalAuthorityRpcResponse = {
  error?: unknown
  ok?: unknown
  result?: unknown
  target?: unknown
}

function isRecord(value: unknown): value is RpcArgs {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function isLocalAuthorityRpc(command: string, args: unknown): boolean {
  return classifyRpcExecutionSurface(command, args) === 'persisted_authority'
}

function responseEnvelope<T>(value: unknown): AppRpcEnvelope<T> {
  if (!isRecord(value)) throw new Error('Local Board authority returned an invalid response.')
  const response = value as LocalAuthorityRpcResponse
  if (response.ok === false) {
    throw new Error(typeof response.error === 'string' ? response.error : 'Local Board RPC failed.')
  }
  if (!Object.hasOwn(response, 'result')) {
    throw new Error('Local Board authority response is missing its result.')
  }
  return {
    result: response.result as T,
    ...(isRecord(response.target) ? { target: response.target as AppRpcTarget } : {})
  }
}

export function createLocalAuthorityRpcClient(options: LocalAuthorityRpcClientOptions) {
  const root = path.resolve(options.root)
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: options.preferredWorkspaceId ?? null,
    root
  })
  const runtime = new LocalWorkspaceBoardRuntime(store)

  return {
    isReady: () => store.hasSavedHead(),
    send: async <T>(command: string, args: unknown = {}): Promise<AppRpcEnvelope<T>> =>
      responseEnvelope<T>(await runtime.sendRpc({ command, args }))
  }
}

type LocalAuthorityRpcClient = ReturnType<typeof createLocalAuthorityRpcClient>

export async function sendLocalAuthorityRpcEnvelope<T>(
  client: LocalAuthorityRpcClient,
  command: string,
  args: unknown = {}
): Promise<AppRpcEnvelope<T>> {
  if (!client.isReady()) throw persistedAuthorityUnavailableError(command)
  try {
    return await client.send<T>(command, args)
  } catch (error) {
    throw normalizePersistedExecutionError(command, error)
  }
}

let defaultClient: ReturnType<typeof createLocalAuthorityRpcClient> | null = null

function localAuthorityClient() {
  defaultClient ??= createLocalAuthorityRpcClient({
    preferredWorkspaceId: process.env.OPENPENCIL_LOCAL_WORKSPACE_ID?.trim() || null,
    root:
      process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
      path.join(homedir(), '.openpencil', 'local-workspace-authority-v1')
  })
  return defaultClient
}

export async function localAuthorityRpcEnvelope<T>(
  command: string,
  args: unknown = {}
): Promise<AppRpcEnvelope<T>> {
  return sendLocalAuthorityRpcEnvelope<T>(localAuthorityClient(), command, args)
}
