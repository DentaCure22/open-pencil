export const PERSISTED_AUTHORITY_UNAVAILABLE = 'persisted_authority_unavailable'
export const PERSISTED_COMMAND_UNSUPPORTED = 'persisted_command_unsupported'

export type RpcExecutionSurface = 'live_runtime' | 'persisted_authority'

type RpcArguments = Record<string, unknown>

const PERSISTED_ONLY_COMMANDS = new Set([
  'list_documents',
  'trace_get_gesture',
  'trace_query',
  'trace_resolve',
  'trace_search',
  'workspace_search'
])

const AUTHORITY_DEFAULT_COMMANDS = new Set([
  'board_context',
  'board_open',
  'board_read'
])

const LIVE_ONLY_COMMANDS = new Set([
  'analyze_clusters',
  'analyze_colors',
  'analyze_overlaps',
  'analyze_spacing',
  'analyze_typography',
  'board_present',
  'eval',
  'export',
  'export_jsx',
  'find',
  'info',
  'new_document',
  'node',
  'open_file',
  'pages',
  'query',
  'save_file',
  'selection',
  'set_theme',
  'tree',
  'variables'
])

const AUTHORITY_DEFAULT_TOOLS = new Set(['search_board_memory'])

function rpcArguments(value: unknown): RpcArguments {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RpcArguments) : {}
}

function stringArgument(args: RpcArguments, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function explicitRuntimeSurface(args: RpcArguments): RpcExecutionSurface | undefined {
  const runtimeInstanceId = stringArgument(args, 'runtime_instance_id')
  if (!runtimeInstanceId) return undefined
  return runtimeInstanceId.startsWith('local-authority:') ? 'persisted_authority' : 'live_runtime'
}

/**
 * Declares the execution surface before any transport is contacted.
 * Missing runtime identity keeps Board work on persisted authority; it never implies a live app.
 */
export function classifyRpcExecutionSurface(
  command: string,
  args: unknown = {}
): RpcExecutionSurface {
  const normalizedCommand = command.trim()
  const normalizedArgs = rpcArguments(args)

  if (
    normalizedCommand === 'board_context' &&
    stringArgument(normalizedArgs, 'target') === 'current_visible'
  ) {
    return 'live_runtime'
  }
  if (PERSISTED_ONLY_COMMANDS.has(normalizedCommand)) return 'persisted_authority'
  if (AUTHORITY_DEFAULT_COMMANDS.has(normalizedCommand)) return 'persisted_authority'
  if (normalizedCommand === 'tool') {
    const name = stringArgument(normalizedArgs, 'name')
    if (!name || !AUTHORITY_DEFAULT_TOOLS.has(name)) return 'live_runtime'
    return explicitRuntimeSurface(normalizedArgs) ?? 'persisted_authority'
  }
  if (LIVE_ONLY_COMMANDS.has(normalizedCommand)) return 'live_runtime'
  throw new Error(
    `rpc_execution_surface_unclassified: "${normalizedCommand || command}" has no declared execution surface.`
  )
}

export function persistedAuthorityUnavailableError(command: string): Error {
  return new Error(
    `${PERSISTED_AUTHORITY_UNAVAILABLE}: "${command}" requires a ready persisted Board authority. No live runtime fallback was attempted.`
  )
}

export function persistedCommandUnsupportedError(command: string): Error {
  return new Error(
    `${PERSISTED_COMMAND_UNSUPPORTED}: "${command}" is classified for persisted authority but is not implemented by that authority.`
  )
}

export function normalizePersistedExecutionError(command: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('no_live_runtime:')) return persistedCommandUnsupportedError(command)
  return error instanceof Error ? error : new Error(message)
}
