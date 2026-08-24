import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ToolHealth = 'broken' | 'degraded' | 'healthy'

export type ToolHealthScore = {
  health: ToolHealth
  reason?: string
}

export type ToolHealthScoreboard = {
  models: Record<string, ToolHealthScore>
  updatedAt?: string
}

export const DEFAULT_TOOL_HEALTH_SCOREBOARD_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'tool-health.scoreboard.json'
)

function isToolHealth(value: unknown): value is ToolHealth {
  return value === 'broken' || value === 'degraded' || value === 'healthy'
}

export function inferredToolHealth(modelId: string): ToolHealth {
  if (modelId.startsWith('cursor/claude')) return 'broken'
  if (modelId.startsWith('cursor/')) return 'degraded'
  return 'healthy'
}

export function loadToolHealthScoreboard(
  scoreboardPath = process.env.OPENPENCIL_TOOL_HEALTH_SCOREBOARD?.trim() ||
    DEFAULT_TOOL_HEALTH_SCOREBOARD_PATH
): ToolHealthScoreboard {
  try {
    const value = JSON.parse(readFileSync(scoreboardPath, 'utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { models: {} }
    const record = value as { models?: unknown; updatedAt?: unknown }
    if (!record.models || typeof record.models !== 'object' || Array.isArray(record.models)) {
      return { models: {} }
    }
    const models: Record<string, ToolHealthScore> = {}
    for (const [id, entry] of Object.entries(record.models)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const health = (entry as { health?: unknown }).health
      if (!isToolHealth(health)) continue
      const reason = (entry as { reason?: unknown }).reason
      models[id] = {
        health,
        ...(typeof reason === 'string' && reason.trim() ? { reason: reason.trim() } : {})
      }
    }
    return {
      models,
      ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {})
    }
  } catch {
    return { models: {} }
  }
}

export function catalogToolHealth(
  modelId: string,
  scoreboard = loadToolHealthScoreboard()
): ToolHealth {
  return scoreboard.models[modelId]?.health ?? inferredToolHealth(modelId)
}
