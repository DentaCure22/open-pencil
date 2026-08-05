import { classifyRpcExecutionSurface } from '@open-pencil/core/rpc'

import type { AppRpcEnvelope, AppRpcTarget } from '#cli/app-rpc-types'
import { localAuthorityRpcEnvelope } from '#cli/local-authority-client'

export type { AppRpcEnvelope, AppRpcTarget } from '#cli/app-rpc-types'

// Keep retries limited to durable named targets so semantic mistakes still fail immediately.
const NAMED_TARGET_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000, 5000, 8000] as const

type RpcArgs = { [key: string]: unknown }

type RawAppRpcResponse<T> = {
  error?: string
  ok?: boolean
  result?: T
  target?: AppRpcTarget
  [key: string]: unknown
}

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
  throw liveRuntimeDisabledError()
}

export function directOrNestedRpcResult<T>(body: RawAppRpcResponse<T>): T {
  if (body.result !== undefined) return body.result
  const { error: _error, ok: _ok, result: _result, target: _target, ...direct } = body
  return direct as T
}

function liveRuntimeDisabledError(): Error {
  return new Error(
    'live_runtime_disabled: live-app RPC is disabled. Use a persisted Board target or a file path.'
  )
}

async function rpcOnce<T>(command: string, args: unknown): Promise<T> {
  if (classifyRpcExecutionSurface(command, args) === 'persisted_authority') {
    return (await localAuthorityRpcEnvelope<T>(command, args)).result
  }
  throw liveRuntimeDisabledError()
}

async function directRpcOnce<T>(command: string, args: unknown): Promise<T> {
  if (classifyRpcExecutionSurface(command, args) === 'persisted_authority') {
    return (await localAuthorityRpcEnvelope<T>(command, args)).result
  }
  throw liveRuntimeDisabledError()
}

async function rpcEnvelopeOnce<T>(command: string, args: unknown): Promise<AppRpcEnvelope<T>> {
  if (classifyRpcExecutionSurface(command, args) === 'persisted_authority') {
    return localAuthorityRpcEnvelope<T>(command, args)
  }
  throw liveRuntimeDisabledError()
}

async function withDurableTargetRetry<T>(args: unknown, request: () => Promise<T>): Promise<T> {
  const durableTarget = durableAppTarget(args)
  async function attempt(retryIndex: number): Promise<T> {
    try {
      return await request()
    } catch (error) {
      if (
        !durableTarget ||
        retryIndex >= NAMED_TARGET_RETRY_DELAYS_MS.length ||
        !isRetryableDurableTargetError(error, durableTarget)
      ) {
        throw error
      }
      await retryDelay(NAMED_TARGET_RETRY_DELAYS_MS[retryIndex])
      return attempt(retryIndex + 1)
    }
  }
  return attempt(0)
}

export async function rpc<T = unknown>(command: string, args: unknown = {}): Promise<T> {
  if (classifyRpcExecutionSurface(command, args) === 'persisted_authority') {
    return rpcOnce<T>(command, args)
  }
  return withDurableTargetRetry(args, () => rpcOnce<T>(command, args))
}

export async function rpcDirect<T = unknown>(command: string, args: unknown = {}): Promise<T> {
  if (classifyRpcExecutionSurface(command, args) === 'persisted_authority') {
    return directRpcOnce<T>(command, args)
  }
  return withDurableTargetRetry(args, () => directRpcOnce<T>(command, args))
}

export async function rpcEnvelope<T = unknown>(
  command: string,
  args: unknown = {}
): Promise<AppRpcEnvelope<T>> {
  if (classifyRpcExecutionSurface(command, args) === 'persisted_authority') {
    return rpcEnvelopeOnce<T>(command, args)
  }
  return withDurableTargetRetry(args, () => rpcEnvelopeOnce<T>(command, args))
}

export async function rpcEnvelopeExact<T = unknown>(
  command: string,
  args: unknown = {}
): Promise<AppRpcEnvelope<T>> {
  return rpcEnvelopeOnce<T>(command, args)
}

export async function rpcEnvelopeLiveExact<T = unknown>(
  _command: string,
  _args: unknown = {}
): Promise<AppRpcEnvelope<T>> {
  throw liveRuntimeDisabledError()
}

export function isAppMode(file?: string): boolean {
  return !file
}

export function requireFile(file?: string): string {
  if (!file) throw new Error('File path is required for headless mode')
  return file
}
