import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'
import { clipReplayText } from '#mcp/agent-router/replay-buffer'

/** Keep full tool parts for this many latest user turns. */
export const THREAD_MEMORY_FULL_TURN_LIMIT = 6
/** Stored tool output older than the live turn is clipped to this many characters. */
export const THREAD_MEMORY_TOOL_OUTPUT_CHARS = 800

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function clipStoredToolText(value: string, budget: number): string {
  const half = Math.floor(budget / 2)
  return clipReplayText(value, half, budget - half)
}

export function normalizedThreadText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function laterTimestamp(left?: string, right?: string): string | undefined {
  if (!left) return right
  if (!right) return left
  return left >= right ? left : right
}

function lastUserIndexes(messages: AgentConversationMessage[]): number[] {
  const indexes: number[] = []
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'user') indexes.push(index)
  }
  return indexes
}

function stampCompletedAt(message: AgentConversationMessage, completedAt?: string): void {
  const next = laterTimestamp(message.completedAt, completedAt)
  if (next) message.completedAt = next
}

function collapseTurnMessages(messages: AgentConversationMessage[]): AgentConversationMessage[] {
  const answers = new Map<string, AgentConversationMessage>()
  const commentaries = new Map<string, AgentConversationMessage>()
  const kept: AgentConversationMessage[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') {
      kept.push(message)
      continue
    }

    const answer = normalizedThreadText(message.text)
    const commentaryKeys = (message.parts ?? []).flatMap((part) =>
      part.type === 'commentary' ? [normalizedThreadText(part.text)].filter(Boolean) : []
    )
    const hasTools = Boolean(message.parts?.some((part) => part.type === 'tool'))
    const otherParts = (message.parts ?? []).filter(
      (part) => part.type !== 'commentary' && part.type !== 'tool'
    )
    let next = message

    if (answer) {
      const keeper = answers.get(answer)
      if (keeper) {
        stampCompletedAt(keeper, message.completedAt)
        const commentaryAlreadyKept = commentaryKeys.every((text) => commentaries.has(text))
        if (
          !hasTools &&
          otherParts.length === 0 &&
          (commentaryKeys.length === 0 || commentaryAlreadyKept)
        ) {
          continue
        }
        next = { ...message, text: '' }
      } else {
        answers.set(answer, message)
      }
    }

    if (next.parts?.some((part) => part.type === 'commentary')) {
      const parts: NonNullable<AgentConversationMessage['parts']> = []
      for (const part of next.parts) {
        if (part.type !== 'commentary') {
          parts.push(part)
          continue
        }
        const key = normalizedThreadText(part.text)
        if (!key) continue
        const keeper = commentaries.get(key)
        if (keeper) {
          stampCompletedAt(keeper, next.completedAt)
          continue
        }
        commentaries.set(key, next)
        parts.push(part)
      }
      if (parts.length !== next.parts.length) {
        const previous = next
        next = parts.length ? { ...next, parts } : { ...next, parts: undefined }
        for (const [key, keeper] of commentaries) {
          if (keeper === previous) commentaries.set(key, next)
        }
      }
      if (!normalizedThreadText(next.text) && !next.parts?.length) continue
    } else {
      for (const key of commentaryKeys) {
        if (!commentaries.has(key)) commentaries.set(key, next)
      }
    }

    if (answer && answers.get(answer) === message && next !== message) {
      answers.set(answer, next)
    }
    kept.push(next)
  }

  return kept
}

/**
 * Drop a second wrap-up or commentary row when the same normalized text
 * already exists in that user turn. Keep the first stable id; never merge
 * distinct answers or rows from different user turns; leave tool parts intact.
 */
export function collapseDuplicateTurnResponses(thread: AgentConversationThread): boolean {
  if (thread.messages.length === 0) return false
  const next: AgentConversationMessage[] = []
  let turn: AgentConversationMessage[] = []
  let changed = false

  const flush = (): void => {
    if (!turn.length) return
    const collapsed = collapseTurnMessages(turn)
    if (
      collapsed.length !== turn.length ||
      collapsed.some((message, index) => message !== turn[index])
    ) {
      changed = true
    }
    next.push(...collapsed)
    turn = []
  }

  for (const message of thread.messages) {
    if (message.role === 'user') {
      flush()
      turn.push(message)
      continue
    }
    turn.push(message)
  }
  flush()

  if (!changed) return false
  thread.messages = next
  return true
}

function compactToolPart(
  part: Record<string, unknown>,
  aggressive: boolean
): Record<string, unknown> {
  const next = { ...part }
  if (typeof next.output === 'string') {
    next.output = clipStoredToolText(
      next.output,
      aggressive ? 160 : THREAD_MEMORY_TOOL_OUTPUT_CHARS
    )
  }
  if (
    typeof next.input === 'string' &&
    (aggressive || next.input.length > THREAD_MEMORY_TOOL_OUTPUT_CHARS)
  ) {
    next.input = clipStoredToolText(next.input, aggressive ? 120 : THREAD_MEMORY_TOOL_OUTPUT_CHARS)
  }
  if (Array.isArray(next.images) && next.images.length > 1) next.images = next.images.slice(0, 1)
  if (Array.isArray(next.videos) && next.videos.length > 1) next.videos = next.videos.slice(0, 1)
  return next
}

function compactMessage(
  message: AgentConversationMessage,
  aggressive: boolean
): AgentConversationMessage {
  if (!message.parts?.length) return message
  let changed = false
  const parts = message.parts.map((part) => {
    if (!isRecord(part) || part.type !== 'tool') return part
    const compact = compactToolPart(part, aggressive)
    if (
      compact.output !== part.output ||
      compact.input !== part.input ||
      compact.images !== part.images ||
      compact.videos !== part.videos
    ) {
      changed = true
    }
    return compact
  })
  return changed ? { ...message, parts } : message
}

/**
 * Bound stored Pi transcripts so long sessions stay cheap to persist and
 * hydrate. The live turn after the latest user message is left intact.
 * Pi still owns model-facing compaction; this only shrinks OpenPencil history.
 */
export function compactAgentThreadMemory(thread: AgentConversationThread): boolean {
  const collapsed = collapseDuplicateTurnResponses(thread)
  const userIndexes = lastUserIndexes(thread.messages)
  if (userIndexes.length === 0) return collapsed
  const keepFullFrom =
    userIndexes[Math.max(0, userIndexes.length - THREAD_MEMORY_FULL_TURN_LIMIT)] ?? 0
  const liveFrom = userIndexes[userIndexes.length - 1] ?? 0
  let changed = false
  const messages = thread.messages.map((message, index) => {
    if (index >= liveFrom) return message
    const next = compactMessage(message, index < keepFullFrom)
    if (next !== message) changed = true
    return next
  })
  if (changed) thread.messages = messages
  return changed || collapsed
}
