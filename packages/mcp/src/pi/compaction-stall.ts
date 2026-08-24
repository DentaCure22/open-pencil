import type { AgentConversationThread } from '#mcp/agent-router/contracts'

/** After compact, this fill means the shrink did not make real room. */
export const COMPACTION_STALL_PERCENT = 80
/** Stored OpenPencil history that is still this large after clip is a stall. */
export const COMPACTION_STALL_STORED_BYTES = 256 * 1024

export function storedThreadBytes(thread: AgentConversationThread): number {
  return Buffer.byteLength(JSON.stringify(thread.messages), 'utf8')
}

export function applyCompactionStall(
  thread: AgentConversationThread,
  options?: { estimatedTokensAfter?: number }
): boolean {
  const usage = thread.contextUsage
  if (!usage?.lastCompactedAt) return false
  const livePercent = usage.percent
  const estimatedPercent =
    options?.estimatedTokensAfter !== undefined && usage.contextWindow > 0
      ? (options.estimatedTokensAfter / usage.contextWindow) * 100
      : null
  const full =
    (livePercent !== null && livePercent >= COMPACTION_STALL_PERCENT) ||
    (estimatedPercent !== null && estimatedPercent >= COMPACTION_STALL_PERCENT)
  const stalled = full || storedThreadBytes(thread) >= COMPACTION_STALL_STORED_BYTES
  if (usage.compactionStalled === stalled) return false
  if (!stalled && usage.compactionStalled !== true) return false
  const next = { ...usage }
  if (stalled) next.compactionStalled = true
  else delete next.compactionStalled
  thread.contextUsage = next
  return true
}
