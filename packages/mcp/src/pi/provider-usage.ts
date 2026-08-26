import type { AgentModelDefinition } from '#mcp/agent-models/catalog'
import type { AgentProviderUsage } from '#mcp/agent-router/contracts'

import { DEFAULT_PROVIDER_USAGE_PROBES } from './providers/usage'

export type ProbePiProviderUsageOptions = {
  executable: string
  model: string
  workspaceRoot: string
}

export type PiProviderUsageProbe = {
  key: string
  matchesModel(model: AgentModelDefinition): boolean
  probe(options: ProbePiProviderUsageOptions): Promise<AgentProviderUsage | null>
}

type PiProviderUsageServiceOptions = {
  executable: string
  models(): AgentModelDefinition[]
  probes?: readonly PiProviderUsageProbe[]
  workspaceRoot: string
}

export class PiProviderUsageService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: AgentProviderUsage | null }
  >()
  private readonly probes: readonly PiProviderUsageProbe[]
  private readonly requests = new Map<string, Promise<AgentProviderUsage | null>>()

  constructor(private readonly options: PiProviderUsageServiceOptions) {
    this.probes = options.probes ?? DEFAULT_PROVIDER_USAGE_PROBES
  }

  async get(provider: string): Promise<AgentProviderUsage | null> {
    const key = provider.trim().toLowerCase()
    const probe = this.probes.find((candidate) => candidate.key === key)
    if (!probe) return null
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.value)
    const pending = this.requests.get(key)
    if (pending) return structuredClone(await pending)

    const model = this.options.models().find((candidate) => probe.matchesModel(candidate))
    if (!model) return null
    const request = probe
      .probe({
        executable: this.options.executable,
        model: model.id,
        workspaceRoot: this.options.workspaceRoot
      })
      .then((value) => {
        this.cache.set(key, {
          expiresAt: Date.now() + (value ? 60_000 : 15_000),
          value
        })
        return value
      })
      .finally(() => this.requests.delete(key))
    this.requests.set(key, request)
    return structuredClone(await request)
  }
}
