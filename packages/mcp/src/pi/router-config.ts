import type { AgentModelDefinition } from '#mcp/agent-models/catalog'

export type PiRouterConfig = {
  executable: string
  historyPath?: string
  models?: AgentModelDefinition[]
  sessionDir?: string
  stallTimeoutMs?: number
  watchdogProbeMs?: number
  workspaceRoot: string
}
