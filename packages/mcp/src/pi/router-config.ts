import type { AgentModelDefinition } from '#mcp/agent-models/catalog'

import type { PiProviderRuntime } from './providers'
import type { ConversationTitleGenerator } from './title-generator'

export type PiRouterConfig = {
  boardWarmEffort?: string
  boardWarmModel?: string
  boardWarmPoolSize?: number
  boardWorkerWorkspaceRoot?: string
  executable: string
  historyPath?: string
  mcpConfigPath?: string
  models?: AgentModelDefinition[]
  providers?: PiProviderRuntime
  sessionDir?: string
  stallTimeoutMs?: number
  titleGenerator?: ConversationTitleGenerator
  watchdogProbeMs?: number
  warmPoolSize?: number
  workspaceRoot: string
}
