import { homedir } from 'node:os'
import path from 'node:path'

import {
  classifyRpcExecutionSurface,
  normalizePersistedExecutionError,
  persistedAuthorityUnavailableError
} from '@open-pencil/core/rpc'

import { LocalWorkspaceBoardRuntime } from './local-workspace-authority/board-runtime'
import { LocalWorkspaceAuthorityStore } from './local-workspace-authority/store'
import type { RpcSender } from './tool/registration'

type PersistedClient = {
  runtime: LocalWorkspaceBoardRuntime
  store: LocalWorkspaceAuthorityStore
}

export type PersistedRoutingOptions = {
  preferredWorkspaceId?: string | null
  root?: string
}

function createPersistedClient(options: PersistedRoutingOptions): PersistedClient {
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId:
      options.preferredWorkspaceId ?? (process.env.OPENPENCIL_LOCAL_WORKSPACE_ID?.trim() || null),
    root:
      options.root ??
      (process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
        path.join(homedir(), '.openpencil', 'local-workspace-authority-v1'))
  })
  return { runtime: new LocalWorkspaceBoardRuntime(store), store }
}

function commandOf(body: Record<string, unknown>): string {
  return typeof body.command === 'string' ? body.command : ''
}

/**
 * Routes each RPC to its declared execution surface before any transport is contacted.
 * Persisted-surface commands (Trace queries, Board reads, workspace search) run against
 * the on-disk authority in-process — exactly like the CLI — so they never require the live app.
 * Only live-surface commands fall through to the WebSocket bridge.
 */
export function withPersistedAuthorityRouting(
  liveSender: RpcSender,
  options: PersistedRoutingOptions = {}
): RpcSender {
  let client: PersistedClient | null = null
  return async (body) => {
    const command = commandOf(body)
    let surface: ReturnType<typeof classifyRpcExecutionSurface>
    try {
      surface = classifyRpcExecutionSurface(command, body.args)
    } catch {
      return liveSender(body)
    }
    if (surface !== 'persisted_authority') return liveSender(body)
    client ??= createPersistedClient(options)
    if (!client.store.hasSavedHead()) throw persistedAuthorityUnavailableError(command)
    try {
      return await client.runtime.sendRpc({ args: body.args, command })
    } catch (error) {
      throw normalizePersistedExecutionError(command, error)
    }
  }
}
