import { useLocalStorage } from '@vueuse/core'
import { reactive } from 'vue'

import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

export type AgentReasoningEffort = 'high' | 'low' | 'max' | 'medium' | 'ultra' | 'xhigh'

type AgentModelDefinition = {
  defaultEffort: AgentReasoningEffort
  efforts: AgentReasoningEffort[]
  group: string
  id: string
  label: string
}

export type AgentProviderUsage = {
  provider: string
  queriedAt: string
  remainingPercent: number
  resetAt?: string
  subscription?: string
  usedPercent: number
}

export type AgentModelSelection = {
  effort: AgentReasoningEffort
  model: string
}

export type AgentPromptAnnotation = {
  comment: string
  endOffset: number
  id: string
  quote: string
  sourceMessageId: string
  startOffset: number
}

const REASONING_EFFORTS = new Set<AgentReasoningEffort>([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
])

const DEFAULT_AGENT_MODEL: AgentModelDefinition = {
  defaultEffort: 'high',
  efforts: ['low', 'medium', 'high', 'xhigh'],
  group: 'xAI',
  id: 'xai-auth/grok-4.6',
  label: 'Grok 4.6'
}

export const AGENT_MODELS = reactive<AgentModelDefinition[]>([{ ...DEFAULT_AGENT_MODEL }])
export const AGENT_PROVIDER_USAGE = reactive<Record<string, AgentProviderUsage | null | undefined>>(
  {}
)

export const GLOBAL_MODEL_SCOPE = 'global'
export const CONTEXT_COMMENT_MODEL_SCOPE = 'context-comment'

const conversationModels = useLocalStorage<Record<string, AgentModelSelection>>(
  'open-pencil:conversation-models-v1',
  {}
)

export function agentConversationScope(input: {
  threadId?: string
  workerConversationId?: string
}): string {
  return `task:${input.workerConversationId || input.threadId || 'new'}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isEffort(value: unknown): value is AgentReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.has(value as AgentReasoningEffort)
}

function modelDefinition(value: unknown): AgentModelDefinition | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.group !== 'string' ||
    !Array.isArray(value.efforts)
  ) {
    return null
  }
  const efforts = value.efforts.filter(isEffort)
  if (!efforts.length || !isEffort(value.defaultEffort)) return null
  return {
    defaultEffort: efforts.includes(value.defaultEffort) ? value.defaultEffort : efforts[0],
    efforts,
    group: value.group,
    id: value.id,
    label: value.label
  }
}

let catalogRequest: Promise<void> | null = null
const providerUsageRequests = new Map<string, Promise<void>>()

export function refreshAgentModels(): Promise<void> {
  if (catalogRequest) return catalogRequest
  catalogRequest = localWorkspaceAuthorityFetch('/agent-router/v1/pi/models')
    .then(async (response) => {
      if (!response.ok) throw new Error('Pi model catalog unavailable')
      const payload: unknown = await response.json()
      const models =
        isRecord(payload) && Array.isArray(payload.models)
          ? payload.models.map(modelDefinition).filter((model) => model !== null)
          : []
      if (!models.length) throw new Error('Pi model catalog is empty')
      AGENT_MODELS.splice(0, AGENT_MODELS.length, ...models)
      sanitizeConversationModels(models)
      return undefined
    })
    .catch(() => undefined)
    .finally(() => {
      catalogRequest = null
    })
  return catalogRequest
}

function providerUsage(value: unknown): AgentProviderUsage | null {
  if (!isRecord(value)) return null
  if (
    typeof value.provider !== 'string' ||
    typeof value.queriedAt !== 'string' ||
    typeof value.remainingPercent !== 'number' ||
    !Number.isFinite(value.remainingPercent) ||
    value.remainingPercent < 0 ||
    value.remainingPercent > 100 ||
    typeof value.usedPercent !== 'number' ||
    !Number.isFinite(value.usedPercent) ||
    value.usedPercent < 0 ||
    value.usedPercent > 100
  ) {
    return null
  }
  return {
    provider: value.provider,
    queriedAt: value.queriedAt,
    remainingPercent: value.remainingPercent,
    ...(typeof value.resetAt === 'string' ? { resetAt: value.resetAt } : {}),
    ...(typeof value.subscription === 'string' ? { subscription: value.subscription } : {}),
    usedPercent: value.usedPercent
  }
}

export function refreshAgentProviderUsage(group: string): Promise<void> {
  const key = group.trim()
  if (!key) return Promise.resolve()
  const existing = providerUsageRequests.get(key)
  if (existing) return existing
  const request = localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/provider-usage/${encodeURIComponent(key)}`
  )
    .then(async (response) => {
      if (!response.ok) {
        AGENT_PROVIDER_USAGE[key] = null
        return undefined
      }
      const payload: unknown = await response.json()
      AGENT_PROVIDER_USAGE[key] = isRecord(payload) ? providerUsage(payload.usage) : null
      return undefined
    })
    .catch(() => {
      AGENT_PROVIDER_USAGE[key] = null
      return undefined
    })
    .finally(() => providerUsageRequests.delete(key))
  providerUsageRequests.set(key, request)
  return request
}

function healthyDefault(
  models: readonly AgentModelDefinition[] = AGENT_MODELS
): AgentModelDefinition {
  return (
    models.find((model) => model.id === DEFAULT_AGENT_MODEL.id) ??
    models.at(0) ??
    DEFAULT_AGENT_MODEL
  )
}

function resolveModel(
  modelId: string | undefined,
  models: readonly AgentModelDefinition[] = AGENT_MODELS
): AgentModelDefinition {
  const match = models.find((model) => model.id === modelId)
  if (match) return match
  return healthyDefault(models)
}

function storedState(scope: string): AgentModelSelection | undefined {
  return conversationModels.value[scope]
}

export function conversationModel(scope: string): AgentModelDefinition {
  return resolveModel(storedState(scope)?.model ?? DEFAULT_AGENT_MODEL.id)
}

export function conversationEffort(scope: string): AgentReasoningEffort {
  const model = conversationModel(scope)
  const stored = storedState(scope)?.effort
  return stored && model.efforts.includes(stored) ? stored : model.defaultEffort
}

export function conversationSelection(scope: string): AgentModelSelection {
  const model = conversationModel(scope)
  return {
    effort: conversationEffort(scope),
    model: model.id
  }
}

export function selectConversationModel(scope: string, modelId: string) {
  const model = resolveModel(modelId)
  const current = storedState(scope)
  const effort =
    current && model.efforts.includes(current.effort) ? current.effort : model.defaultEffort
  conversationModels.value = {
    ...conversationModels.value,
    [scope]: { effort, model: model.id }
  }
}

export function selectConversationEffort(scope: string, effort: AgentReasoningEffort) {
  const model = conversationModel(scope)
  if (!model.efforts.includes(effort)) return
  conversationModels.value = {
    ...conversationModels.value,
    [scope]: { effort, model: model.id }
  }
}

export function seedConversationModel(scope: string, modelId?: string, effort?: string) {
  if (storedState(scope) || !modelId) return
  selectConversationModel(scope, modelId)
  if (isEffort(effort)) selectConversationEffort(scope, effort)
}

function sanitizeConversationModels(models: readonly AgentModelDefinition[]) {
  const next = { ...conversationModels.value }
  let changed = false
  for (const [scope, state] of Object.entries(next)) {
    const resolved = resolveModel(state.model, models)
    const effort = resolved.efforts.includes(state.effort) ? state.effort : resolved.defaultEffort
    if (resolved.id === state.model && effort === state.effort) continue
    next[scope] = { effort, model: resolved.id }
    changed = true
  }
  if (changed) conversationModels.value = next
}

export type AgentPromptSubmission = AgentModelSelection & {
  annotations: AgentPromptAnnotation[]
  attachments: File[]
}

export function effortLabel(effort: AgentReasoningEffort) {
  if (effort === 'xhigh') return 'Extra high'
  return `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
}
