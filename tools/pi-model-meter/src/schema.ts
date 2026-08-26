import type { TokenUsage } from '#pi-grok-eval/parse'

import type { UsageTokens } from '@open-pencil/mcp/usage-ledger-schema'

export * from '@open-pencil/mcp/usage-ledger-schema'
export type { TokenUsage }

export function usageFromParsed(usage: TokenUsage): UsageTokens {
  return {
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    input: usage.input,
    output: usage.output,
    reasoning: usage.reasoning
  }
}
