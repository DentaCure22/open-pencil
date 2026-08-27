import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { type AgentModelDefinition, type AgentReasoningEffort } from '#mcp/agent-models/catalog'

import { boardModelPolicy, DEFAULT_PI_MODEL_ID, FALLBACK_PI_MODELS } from './board-model-policy'
import { resolvePiExecutable } from './executable'

export { FALLBACK_PI_MODELS } from './board-model-policy'

const DEFAULT_PI_REASONING_EFFORT: AgentReasoningEffort = 'high'
const DEFAULT_PI_SETTINGS_PATH = path.join(homedir(), '.pi', 'agent', 'settings.json')
const DEFAULT_PI_AUTH_PATH = path.join(homedir(), '.pi', 'agent', 'auth.json')
const DEFAULT_PI_MODELS_STORE_PATH = path.join(homedir(), '.pi', 'agent', 'models-store.json')

const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
export type PiCatalogPaths = {
  authPath?: string
  executable?: string
  listedText?: string
  settingsPath?: string
  skipCli?: boolean
  storePath?: string
}

type EnabledModelPattern = {
  effort?: AgentReasoningEffort
  pattern: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isEffort(value: string): value is AgentReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value)
}

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  } catch {
    return null
  }
}

function parseEnabledModelPattern(value: string): EnabledModelPattern {
  const separator = value.lastIndexOf(':')
  if (separator === -1) return { pattern: value }
  const effort = value.slice(separator + 1)
  if (!isEffort(effort)) return { pattern: value }
  return {
    effort,
    pattern: value.slice(0, separator)
  }
}

function enabledModelPatterns(settings: Record<string, unknown> | null): EnabledModelPattern[] {
  if (!settings || !Array.isArray(settings.enabledModels)) return []
  return settings.enabledModels
    .filter((value): value is string => typeof value === 'string')
    .map(parseEnabledModelPattern)
}

function preferredModelId(settings: Record<string, unknown> | null): string {
  const provider =
    typeof settings?.defaultProvider === 'string' ? settings.defaultProvider.trim() : ''
  const model = typeof settings?.defaultModel === 'string' ? settings.defaultModel.trim() : ''
  if (provider && model) return `${provider}/${model}`
  return DEFAULT_PI_MODEL_ID
}

function preferredEffort(settings: Record<string, unknown> | null): AgentReasoningEffort {
  const requested =
    typeof settings?.defaultThinkingLevel === 'string' ? settings.defaultThinkingLevel : ''
  return isEffort(requested) ? requested : DEFAULT_PI_REASONING_EFFORT
}

function modelPatternMatches(pattern: string, provider: string, modelId: string): boolean {
  const full = `${provider}/${modelId}`
  if (pattern.endsWith('/*')) return provider === pattern.slice(0, -2)
  return pattern === full || pattern === modelId
}

function modelEnabled(
  provider: string,
  modelId: string,
  patterns: readonly EnabledModelPattern[]
): boolean {
  if (patterns.length === 0) return true
  return patterns.some(({ pattern }) => modelPatternMatches(pattern, provider, modelId))
}

function modelPreferredEffort(
  provider: string,
  modelId: string,
  patterns: readonly EnabledModelPattern[],
  fallback: AgentReasoningEffort
): AgentReasoningEffort {
  return (
    patterns.find(
      ({ effort, pattern }) => effort && modelPatternMatches(pattern, provider, modelId)
    )?.effort ?? fallback
  )
}

function catalogLabel(modelId: string): string {
  return modelId
    .split(/[-/]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function definition(
  provider: string,
  modelId: string,
  thinking: boolean,
  preferredEffort: AgentReasoningEffort,
  label?: string
): AgentModelDefinition | null {
  const policy = boardModelPolicy(provider, modelId, thinking)
  if (!policy) return null
  const efforts = policy.efforts
  const defaultEffort = efforts.includes(preferredEffort)
    ? preferredEffort
    : (efforts[0] ?? DEFAULT_PI_REASONING_EFFORT)
  return {
    defaultEffort,
    efforts,
    group: policy.group,
    id: `${provider}/${modelId}`,
    label: label?.trim() || catalogLabel(modelId)
  }
}

export function parsePiListModels(
  text: string,
  settings: Record<string, unknown> | null = null
): AgentModelDefinition[] {
  const patterns = enabledModelPatterns(settings)
  const fallbackEffort = preferredEffort(settings)
  const models: AgentModelDefinition[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('provider')) continue
    const fields = line.split(/\s+/)
    if (fields.length < 6) continue
    const thinkingFlag = fields.at(-2)
    const provider = fields[0]
    const modelId = fields.slice(1, -4).join(' ')
    if (!provider || !modelId) continue
    if (thinkingFlag !== 'yes' && thinkingFlag !== 'no') continue
    if (!modelEnabled(provider, modelId, patterns)) continue
    const model = definition(
      provider,
      modelId,
      thinkingFlag === 'yes',
      modelPreferredEffort(provider, modelId, patterns, fallbackEffort)
    )
    if (model) models.push(model)
  }
  return models
}

function storeModels(
  storePath: string,
  settings: Record<string, unknown> | null,
  authPath: string
): AgentModelDefinition[] {
  const data = readJson(storePath)
  if (!isRecord(data)) return []
  const auth = readJson(authPath)
  const authed = isRecord(auth)
    ? new Set(Object.keys(auth).filter((key) => isRecord(auth[key])))
    : new Set<string>()
  const patterns = enabledModelPatterns(settings)
  const fallbackEffort = preferredEffort(settings)
  const models: AgentModelDefinition[] = []
  for (const [provider, entry] of Object.entries(data)) {
    if (!isRecord(entry) || !Array.isArray(entry.models)) continue
    if (authed.size > 0 && !authed.has(provider)) continue
    for (const model of entry.models) {
      if (!isRecord(model) || typeof model.id !== 'string' || !model.id.trim()) continue
      const id = model.id.trim()
      if (!modelEnabled(provider, id, patterns)) continue
      const map = isRecord(model.thinkingLevelMap) ? model.thinkingLevelMap : null
      const thinking = !map || Object.values(map).some((value) => value !== null)
      const name = typeof model.name === 'string' ? model.name : undefined
      const definitionForModel = definition(
        provider,
        id,
        thinking,
        modelPreferredEffort(provider, id, patterns, fallbackEffort),
        name
      )
      if (definitionForModel) models.push(definitionForModel)
    }
  }
  return models
}

function readListedText(executable: string): string {
  try {
    const result = spawnSync(executable, ['--list-models'], {
      encoding: 'utf8',
      timeout: 15_000
    })
    return result.stdout.trim()
  } catch {
    return ''
  }
}

function withoutXaiApiSlot(models: AgentModelDefinition[]): AgentModelDefinition[] {
  return models.filter((model) => !model.id.startsWith('xai/'))
}

function sortModels(models: AgentModelDefinition[], preferredId: string): AgentModelDefinition[] {
  return [...models].sort((left, right) => {
    if (left.id === preferredId) return -1
    if (right.id === preferredId) return 1
    if (left.group !== right.group) return left.group.localeCompare(right.group)
    return left.id.localeCompare(right.id)
  })
}

export function loadPiAgentModels(options: PiCatalogPaths = {}): AgentModelDefinition[] {
  const settingsPath = options.settingsPath ?? DEFAULT_PI_SETTINGS_PATH
  const settings = readJson(settingsPath)
  const settingsRecord = isRecord(settings) ? settings : null
  const preferred = preferredModelId(settingsRecord)
  const listed =
    options.listedText ??
    (options.skipCli ? '' : readListedText(options.executable ?? resolvePiExecutable()))
  const fromCli = listed ? parsePiListModels(listed, settingsRecord) : []
  const fromStore = storeModels(
    options.storePath ?? DEFAULT_PI_MODELS_STORE_PATH,
    settingsRecord,
    options.authPath ?? DEFAULT_PI_AUTH_PATH
  )
  const models = withoutXaiApiSlot(fromCli.length > 0 ? fromCli : fromStore)
  if (models.length === 0) return FALLBACK_PI_MODELS
  return sortModels(models, preferred)
}
