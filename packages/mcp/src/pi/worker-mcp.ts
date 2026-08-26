import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

import { agentWorkerEnv } from '#mcp/agent-router/worker-env'

import { applyProviderWorkerEnv } from './providers/worker-env'

export const BOARD_WORKER_THREAD_ENV = 'OPENPENCIL_BOARD_WORKER_THREAD_ID'
export const BOARD_WORKER_THREAD_BINDING_ENV = 'OPENPENCIL_BOARD_WORKER_THREAD_BINDING'

export const WORKER_BOARD_TOOL_NAMES = [
  'board_apply',
  'board_go',
  'board_query',
  'board_screenshot',
  'board_where',
  'get_agent_chat_context',
  'list_agent_chats',
  'set_theme',
  'trace_query',
  'workmap_apply',
  'workmap_create_todo_chat',
  'workmap_query'
] as const

export const WORKER_MEDIA_SERVER_NAME = 'ima2-media'
export const WORKER_MEDIA_REQUEST_TIMEOUT_MS = 1_200_000
export const WORKER_MEDIA_DIRECT_TOOL_NAMES = [
  'edit_image',
  'generate_image',
  'get_media_job'
] as const
export const WORKER_MEDIA_EAGER_TOOL_NAMES = WORKER_MEDIA_DIRECT_TOOL_NAMES.map(
  (name) => `${WORKER_MEDIA_SERVER_NAME}_${name}`
)

export const WORKER_PROVIDER_EAGER_TOOL_NAMES = [
  ...WORKER_BOARD_TOOL_NAMES.map((name) => `openpencil_${name}`),
  ...WORKER_MEDIA_EAGER_TOOL_NAMES,
  'pi_edit',
  'mcp'
]

export type BoardWorkerMcpServer = {
  command?: string
  directTools: string[]
  lifecycle: 'lazy'
  includeTools: string[]
  toolPrefix: 'server'
  [key: string]: unknown
}

export type BoardWorkerMcpConfig = {
  mcpServers: Record<string, Record<string, unknown>>
  settings?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function boardWorkerPrompt(prompt: string): string {
  const value = prompt.trim()
  if (!value || /^\/skill:openpencil(?:\s|$)/.test(value)) return value
  return (
    `/skill:openpencil ${value}\n\n` +
    'The OpenPencil skill body injected above is already loaded. Do not read SKILL.md again; read only a linked reference when the task needs it. The active Board task is this chat: bare continuations such as “continue”, “go on”, or “figure it out” use this chat history and never another chat. Other chats remain discoverable only as explicit external reference. On the first turn, call board_where and workmap_query. If this chat is unplaced, call the real workmap_apply tool with expected_revision from workmap_query and an operations array to place it in the best matching existing project or one-level subproject; create a project only when the user or Board context clearly establishes one, otherwise leave it in Misc. Never emit XML or a pseudo tool call, never claim a Work Map save without a successful tool receipt, and never override manual placement. Chat placement is project, subproject, or Misc; Todo, In motion, and Finished are todo states, not chat locations. Use workmap_create_todo_chat when the user asks to save distinct future work: prepare its brief and references, but do not start another agent. Move the current linked todo to In motion while working. Keep hammering until the requested result is verified, then mark it Finished. If a concrete human choice or external dependency blocks progress, leave the todo In motion and explain the blocker in chat.'
  )
}

function mergedDirectTools(current: unknown, required: readonly string[]): true | string[] {
  if (current === true) return true
  const names = Array.isArray(current)
    ? current.filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
    : []
  return [...new Set([...names, ...required])]
}

export function boardWorkerEnv(
  env: NodeJS.ProcessEnv = process.env,
  executable?: string,
  threadId?: string
): NodeJS.ProcessEnv {
  const base = agentWorkerEnv(env, executable)
  const next = applyProviderWorkerEnv(base, WORKER_PROVIDER_EAGER_TOOL_NAMES)
  const activeThreadId = threadId?.trim()
  if (activeThreadId) {
    next.OPENPENCIL_BOARD_WORKER_THREAD_ID = activeThreadId
    delete next.OPENPENCIL_BOARD_WORKER_THREAD_BINDING
  } else {
    delete next.OPENPENCIL_BOARD_WORKER_THREAD_ID
  }
  return next
}

export function boardWorkerBindingPath(sessionDir: string, poolSessionId: string): string {
  return resolve(sessionDir, 'board-worker-bindings', `${poolSessionId}.thread`)
}

export function boardWorkerPoolEnv(
  bindingPath: string,
  env: NodeJS.ProcessEnv = process.env,
  executable?: string
): NodeJS.ProcessEnv {
  const next = boardWorkerEnv(env, executable)
  next.OPENPENCIL_BOARD_WORKER_THREAD_BINDING = resolve(bindingPath)
  return next
}

export function bindBoardWorkerThread(bindingPath: string, threadId: string): void {
  const activeThreadId = threadId.trim()
  if (!activeThreadId) throw new TypeError('A Board worker binding needs a thread ID.')
  mkdirSync(dirname(bindingPath), { recursive: true })
  writeFileSync(bindingPath, `${activeThreadId}\n`, { mode: 0o600 })
}

/** Resolve at tool-call time. Warm Pi workers start before a chat exists, then
 *  the router atomically binds their private file when a new chat claims one. */
export function boardWorkerThreadId(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = env[BOARD_WORKER_THREAD_ENV]?.trim()
  if (direct) return direct
  const bindingPath = env[BOARD_WORKER_THREAD_BINDING_ENV]?.trim()
  if (!bindingPath) return undefined
  try {
    return readFileSync(bindingPath, 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

export function piUserMcpConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENPENCIL_PI_USER_MCP_CONFIG?.trim()
  if (override) return resolve(override)
  const agentDir = env.PI_CODING_AGENT_DIR?.trim()
  return resolve(agentDir || `${homedir()}/.pi/agent`, 'mcp.json')
}

export function readPiUserMcpConfig(
  env: NodeJS.ProcessEnv = process.env
): Record<string, unknown> | null {
  const path = piUserMcpConfigPath(env)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function readMcpConfig(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

export function boardWorkerMcpConfig(userConfig: unknown): BoardWorkerMcpConfig {
  if (!isRecord(userConfig)) return { mcpServers: {} }
  const sourceServers = isRecord(userConfig.mcpServers) ? userConfig.mcpServers : {}
  const mcpServers: Record<string, Record<string, unknown>> = Object.fromEntries(
    Object.entries(sourceServers).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        entry[0] !== 'openpencil' && isRecord(entry[1])
    )
  )
  const server = sourceServers.openpencil
  if (
    isRecord(server) &&
    server.disabled !== true &&
    (typeof server.command === 'string' || typeof server.url === 'string')
  ) {
    const next: BoardWorkerMcpServer = {
      ...server,
      directTools: [...WORKER_BOARD_TOOL_NAMES],
      includeTools: [...WORKER_BOARD_TOOL_NAMES],
      lifecycle: 'lazy',
      toolPrefix: 'server'
    }
    delete next.searchKeywords
    mcpServers.openpencil = next
  }

  const mediaServer = sourceServers[WORKER_MEDIA_SERVER_NAME]
  if (
    isRecord(mediaServer) &&
    mediaServer.disabled !== true &&
    (typeof mediaServer.command === 'string' || typeof mediaServer.url === 'string')
  ) {
    mcpServers[WORKER_MEDIA_SERVER_NAME] = {
      ...mediaServer,
      directTools: mergedDirectTools(mediaServer.directTools, WORKER_MEDIA_DIRECT_TOOL_NAMES),
      requestTimeoutMs: Math.max(
        typeof mediaServer.requestTimeoutMs === 'number' ? mediaServer.requestTimeoutMs : 0,
        WORKER_MEDIA_REQUEST_TIMEOUT_MS
      ),
      toolPrefix: 'server'
    }
  }

  const sourceSettings = isRecord(userConfig.settings) ? userConfig.settings : {}
  const pluginPaths = Array.isArray(sourceSettings.agentPluginPaths)
    ? sourceSettings.agentPluginPaths.filter(
        (path): path is string =>
          typeof path === 'string' && basename(resolve(path)).toLowerCase() !== 'openpencil'
      )
    : undefined
  return {
    mcpServers,
    settings: {
      ...sourceSettings,
      freezeDirectTools: true,
      ...(pluginPaths ? { agentPluginPaths: pluginPaths } : {})
    }
  }
}

export function resolvePiSessionMcpConfigPath(
  options: {
    env?: NodeJS.ProcessEnv
    mcpConfigPath?: string
  } = {}
): string | undefined {
  const env = options.env ?? process.env
  const explicit = options.mcpConfigPath?.trim() || env.OPENPENCIL_PI_MCP_CONFIG?.trim()
  return explicit ? resolve(explicit) : undefined
}

export function resolveBoardWorkerMcpConfigPath(options: {
  env?: NodeJS.ProcessEnv
  mcpConfigPath?: string
  sessionDir?: string
  userConfig?: unknown
}): string | undefined {
  if (!options.sessionDir) return undefined
  const path = resolve(options.sessionDir, 'board-worker.mcp.json')
  mkdirSync(dirname(path), { recursive: true })
  const explicit = resolvePiSessionMcpConfigPath(options)
  const userConfig =
    options.userConfig ?? (explicit ? readMcpConfig(explicit) : readPiUserMcpConfig(options.env))
  const config = boardWorkerMcpConfig(userConfig)
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
  return path
}
