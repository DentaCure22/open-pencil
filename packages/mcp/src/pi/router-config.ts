import type { AgentModelDefinition } from '#mcp/agent-models/catalog'

import type { AntigravityTokenUsage, AntigravityUsageCursor } from './antigravity-usage'

export type PiRouterConfig = {
  captureAntigravityUsageCursor?: (
    sessionIds: readonly string[]
  ) => Promise<AntigravityUsageCursor | null>
  executable: string
  historyPath?: string
  mcpConfigPath?: string
  models?: AgentModelDefinition[]
  readAntigravityTurnUsage?: (
    sessionIds: readonly string[],
    cursor: AntigravityUsageCursor
  ) => Promise<AntigravityTokenUsage | null>
  sessionDir?: string
  stallTimeoutMs?: number
  watchdogProbeMs?: number
  warmPoolSize?: number
  workspaceRoot: string
}
