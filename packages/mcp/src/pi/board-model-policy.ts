import type { AgentModelDefinition, AgentReasoningEffort } from '#mcp/agent-models/catalog'

const THINKING_EFFORTS: AgentReasoningEffort[] = ['low', 'medium', 'high', 'xhigh']

type ProviderFallbackModel = Omit<AgentModelDefinition, 'group' | 'id'> & {
  id: string
}

type ProviderModelPolicy = {
  fallbackModels: ProviderFallbackModel[]
  group: string
  matches: (modelId: string) => boolean
  provider: string
}

const PROVIDER_MODEL_POLICIES: ProviderModelPolicy[] = [
  {
    fallbackModels: [
      {
        defaultEffort: 'high',
        efforts: ['low', 'medium', 'high', 'xhigh'],
        id: 'grok-4.6',
        label: 'Grok 4.6'
      },
      {
        defaultEffort: 'medium',
        efforts: ['medium'],
        id: 'grok-composer-2.5-fast',
        label: 'Grok Composer 2.5 Fast'
      }
    ],
    group: 'xAI',
    matches: (modelId) => /grok-4\.6/.test(modelId) || /composer-2\.5/.test(modelId),
    provider: 'xai-auth'
  },
  {
    fallbackModels: [
      {
        defaultEffort: 'medium',
        efforts: ['medium'],
        id: 'composer-2.5-fast',
        label: 'Composer 2.5 Fast'
      },
      {
        defaultEffort: 'high',
        efforts: ['low', 'medium', 'high', 'xhigh'],
        id: 'cursor-grok-4.6-fast',
        label: 'Cursor Grok 4.6 Fast'
      }
    ],
    group: 'Cursor',
    matches: (modelId) => /(?:^|[-/])grok(?:-|$)/.test(modelId) || /composer-2\.5/.test(modelId),
    provider: 'cursor'
  },
  {
    fallbackModels: [
      {
        defaultEffort: 'high',
        efforts: ['low', 'medium', 'high'],
        id: 'gemini-3-7-flash',
        label: 'Gemini 3.7 Flash'
      },
      {
        defaultEffort: 'high',
        efforts: ['low', 'high'],
        id: 'gemini-3-1-pro',
        label: 'Gemini 3.1 Pro'
      }
    ],
    group: 'Antigravity',
    matches: () => true,
    provider: 'antigravity'
  },
  {
    fallbackModels: [
      {
        defaultEffort: 'high',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        id: 'gpt-5.6-luna',
        label: 'GPT-5.6 Luna'
      },
      {
        defaultEffort: 'high',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        id: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol'
      },
      {
        defaultEffort: 'high',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        id: 'gpt-5.6-terra',
        label: 'GPT-5.6 Terra'
      }
    ],
    group: 'OpenAI',
    matches: (modelId) => /(?:sol|luna|terra|spark)/.test(modelId),
    provider: 'openai-codex'
  }
]

const PROVIDER_MODEL_POLICY_BY_ID = new Map(
  PROVIDER_MODEL_POLICIES.map((policy) => [policy.provider, policy])
)

export const FALLBACK_PI_MODELS: AgentModelDefinition[] = PROVIDER_MODEL_POLICIES.flatMap(
  ({ fallbackModels, group, provider }) =>
    fallbackModels.map((model) => ({
      ...model,
      group,
      id: `${provider}/${model.id}`
    }))
)

function defaultPiModelId(models: readonly AgentModelDefinition[]): string {
  const model = models[0]
  if (!model) throw new TypeError('Board model policy must define at least one fallback model.')
  return model.id
}

export const DEFAULT_PI_MODEL_ID = defaultPiModelId(FALLBACK_PI_MODELS)

const FALLBACK_PI_MODEL_BY_ID = new Map(FALLBACK_PI_MODELS.map((model) => [model.id, model]))

export type BoardModelPolicy = {
  efforts: AgentReasoningEffort[]
  group: string
}

export function boardModelPolicy(
  provider: string,
  modelId: string,
  thinking: boolean
): BoardModelPolicy | null {
  const providerPolicy = PROVIDER_MODEL_POLICY_BY_ID.get(provider)
  if (!providerPolicy?.matches(modelId)) return null
  const id = `${provider}/${modelId}`
  return {
    efforts: [
      ...(FALLBACK_PI_MODEL_BY_ID.get(id)?.efforts ?? (thinking ? THINKING_EFFORTS : ['medium']))
    ],
    group: providerPolicy.group
  }
}
