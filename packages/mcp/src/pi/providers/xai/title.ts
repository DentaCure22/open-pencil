import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import type { PiConversationTitleGeneratorOptions } from '#mcp/pi/title-generator'

export const XAI_CONVERSATION_TITLE_MODEL = 'xai-auth/grok-composer-2.5-fast'
export const XAI_CONVERSATION_TITLE_EFFORT = 'medium'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function piAgentDirectory(env: NodeJS.ProcessEnv): string {
  return env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), '.pi', 'agent')
}

function installedXaiPackageCandidate(agentDir: string, entry: string): string | null {
  const value = entry.trim()
  if (!value || !value.toLowerCase().includes('pi-xai-oauth')) return null
  if (value.startsWith('npm:')) {
    return path.join(agentDir, 'npm', 'node_modules', value.slice('npm:'.length))
  }
  if (value.startsWith('git:')) {
    return path.join(agentDir, 'git', value.slice('git:'.length))
  }
  return path.resolve(agentDir, value)
}

function configuredPiPackages(agentDir: string): string[] {
  try {
    const settings = JSON.parse(
      readFileSync(path.join(agentDir, 'settings.json'), 'utf8')
    ) as unknown
    if (!isRecord(settings) || !Array.isArray(settings.packages)) return []
    return settings.packages.filter((entry): entry is string => typeof entry === 'string')
  } catch {
    return []
  }
}

export function resolvePiXaiExtensionPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.OPENPENCIL_PI_XAI_EXTENSION?.trim()
  if (explicit && existsSync(explicit)) return explicit

  const agentDir = piAgentDirectory(env)
  const candidates = [
    path.join(homedir(), 'plugins', 'pi-xai-oauth'),
    path.join(agentDir, 'npm', 'node_modules', 'pi-xai-oauth')
  ]
  for (const entry of configuredPiPackages(agentDir)) {
    const candidate = installedXaiPackageCandidate(agentDir, entry)
    if (candidate) candidates.unshift(candidate)
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function xaiConversationTitleOptions(
  env: NodeJS.ProcessEnv = process.env
): Pick<PiConversationTitleGeneratorOptions, 'effort' | 'extensionPaths' | 'model'> {
  const extensionPath = resolvePiXaiExtensionPath(env)
  return {
    effort: XAI_CONVERSATION_TITLE_EFFORT,
    extensionPaths: extensionPath ? [extensionPath] : [],
    model: XAI_CONVERSATION_TITLE_MODEL
  }
}
