import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

export const WORKER_BOARD_TOOL_NAMES = [
  'board_screenshot',
  'board_where',
  'get_agent_chat_context',
  'list_agent_chats',
  'set_theme'
] as const

export type BoardWorkerMcpServer = {
  command?: string
  directTools: false
  lifecycle: 'lazy'
  includeTools: string[]
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
  return `/skill:openpencil ${value}`
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
  const mcpServers = Object.fromEntries(
    Object.entries(sourceServers).filter(([name]) => name !== 'openpencil')
  )
  const server = sourceServers.openpencil
  if (
    isRecord(server) &&
    server.disabled !== true &&
    (typeof server.command === 'string' || typeof server.url === 'string')
  ) {
    const next: BoardWorkerMcpServer = {
      ...server,
      directTools: false,
      includeTools: [...WORKER_BOARD_TOOL_NAMES],
      lifecycle: 'lazy'
    }
    delete next.searchKeywords
    mcpServers.openpencil = next
  }

  const sourceSettings = isRecord(userConfig.settings) ? userConfig.settings : null
  if (!sourceSettings) return { mcpServers }
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
