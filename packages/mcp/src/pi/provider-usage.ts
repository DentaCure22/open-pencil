import { randomUUID } from 'node:crypto'

import type { AgentModelDefinition } from '#mcp/agent-models/catalog'
import type { AgentProviderUsage } from '#mcp/agent-router/contracts'
import { agentWorkerEnv } from '#mcp/agent-router/worker-env'

import { parsePiModelId } from './arguments'
import { PiRpcProcess } from './rpc-process'

const PROVIDER_USAGE_TIMEOUT_MS = 20_000
const USED_PERCENT_PATTERN = /^Included usage:\s*([0-9]+(?:\.[0-9]+)?)%$/im
const RESET_PATTERN = /^Reset:\s*(\S+)$/im
const SUBSCRIPTION_PATTERN = /^Subscription:\s*(.+)$/im

type ProbePiProviderUsageOptions = {
  executable: string
  model: string
  workspaceRoot: string
}

type PiProviderUsageServiceOptions = {
  executable: string
  models(): AgentModelDefinition[]
  workspaceRoot: string
}

function boundedLabel(value: string | undefined): string | undefined {
  const label = value?.trim()
  if (!label || label.length > 80) return undefined
  if (
    [...label].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  ) {
    return undefined
  }
  return label
}

export function parsePiProviderUsageNotification(
  provider: string,
  message: string,
  queriedAt = new Date().toISOString()
): AgentProviderUsage | null {
  const percentMatch = message.match(USED_PERCENT_PATTERN)
  if (!percentMatch) return null
  const usedPercent = Number(percentMatch[1])
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return null
  const resetAt = boundedLabel(message.match(RESET_PATTERN)?.[1])
  const subscription = boundedLabel(message.match(SUBSCRIPTION_PATTERN)?.[1])
  return {
    provider,
    queriedAt,
    remainingPercent: Math.max(0, 100 - usedPercent),
    ...(resetAt ? { resetAt } : {}),
    ...(subscription ? { subscription } : {}),
    usedPercent
  }
}

export async function probePiProviderUsage(
  options: ProbePiProviderUsageOptions
): Promise<AgentProviderUsage | null> {
  const { model, provider } = parsePiModelId(options.model)
  if (provider !== 'xai' && provider !== 'xai-auth') return null

  let finish: (usage: AgentProviderUsage | null) => void = () => undefined
  let settled = false
  const result = new Promise<AgentProviderUsage | null>((resolve) => {
    finish = (usage) => {
      if (settled) return
      settled = true
      resolve(usage)
    }
  })
  const timer = setTimeout(() => finish(null), PROVIDER_USAGE_TIMEOUT_MS)
  timer.unref()
  let rpc: PiRpcProcess | null = null

  try {
    rpc = await PiRpcProcess.start({
      args: [
        '--mode',
        'rpc',
        '--provider',
        provider,
        '--model',
        model,
        '--thinking',
        'low',
        '--no-session',
        '--approve'
      ],
      cwd: options.workspaceRoot,
      env: agentWorkerEnv(process.env, options.executable),
      executable: options.executable,
      onEvent: (event) => {
        if (
          event.type !== 'extension_ui_request' ||
          event.method !== 'notify' ||
          typeof event.message !== 'string'
        ) {
          return
        }
        if (event.notifyType === 'error') {
          finish(null)
          return
        }
        const usage = parsePiProviderUsageNotification('xAI', event.message)
        if (usage) finish(usage)
      },
      onExit: () => finish(null)
    })
    const response = await rpc.command({
      id: `provider-usage:${randomUUID()}`,
      message: '/xai-usage',
      type: 'prompt'
    })
    if (!response.success) finish(null)
    return await result
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    rpc?.close()
  }
}

export class PiProviderUsageService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: AgentProviderUsage | null }
  >()
  private readonly requests = new Map<string, Promise<AgentProviderUsage | null>>()

  constructor(private readonly options: PiProviderUsageServiceOptions) {}

  async get(provider: string): Promise<AgentProviderUsage | null> {
    const key = provider.trim().toLowerCase()
    if (key !== 'xai') return null
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return structuredClone(cached.value)
    const pending = this.requests.get(key)
    if (pending) return structuredClone(await pending)

    const model = this.options
      .models()
      .find(
        (candidate) =>
          candidate.group.toLowerCase() === key &&
          (candidate.id.startsWith('xai-auth/') || candidate.id.startsWith('xai/'))
      )
    if (!model) return null
    const request = probePiProviderUsage({
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
