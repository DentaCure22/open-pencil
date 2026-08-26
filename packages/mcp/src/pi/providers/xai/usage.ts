import { randomUUID } from 'node:crypto'

import type { AgentProviderUsage } from '#mcp/agent-router/contracts'
import { agentWorkerEnv } from '#mcp/agent-router/worker-env'
import { parsePiModelId } from '#mcp/pi/arguments'
import type { PiProviderUsageProbe, ProbePiProviderUsageOptions } from '#mcp/pi/provider-usage'
import { PiRpcProcess } from '#mcp/pi/rpc-process'

const PROVIDER_USAGE_TIMEOUT_MS = 20_000
const USED_PERCENT_PATTERN = /^Included usage:\s*([0-9]+(?:\.[0-9]+)?)%$/im
const RESET_PATTERN = /^Reset:\s*(\S+)$/im
const SUBSCRIPTION_PATTERN = /^Subscription:\s*(.+)$/im

function boundedLabel(value: string | undefined): string | undefined {
  const label = value?.trim()
  if (!label || label.length > 80) return undefined
  if (
    Array.from(label).some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  ) {
    return undefined
  }
  return label
}

export function parseXaiProviderUsageNotification(
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
    provider: 'xAI',
    queriedAt,
    remainingPercent: Math.max(0, 100 - usedPercent),
    ...(resetAt ? { resetAt } : {}),
    ...(subscription ? { subscription } : {}),
    usedPercent
  }
}

export async function probeXaiProviderUsage(
  options: ProbePiProviderUsageOptions
): Promise<AgentProviderUsage | null> {
  const { model, provider } = parsePiModelId(options.model)
  if (provider !== 'xai-auth') return null

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
        const usage = parseXaiProviderUsageNotification(event.message)
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

export const XAI_PROVIDER_USAGE_PROBE: PiProviderUsageProbe = {
  key: 'xai',
  matchesModel: (model) => model.group.toLowerCase() === 'xai' && model.id.startsWith('xai-auth/'),
  probe: probeXaiProviderUsage
}
