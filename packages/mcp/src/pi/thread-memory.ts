import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'
import { clipReplayText } from '#mcp/agent-router/replay-buffer'

/** Keep full tool parts for this many latest user turns. */
export const THREAD_MEMORY_FULL_TURN_LIMIT = 6
/** Stored tool output older than the live turn is clipped to this many characters. */
export const THREAD_MEMORY_TOOL_OUTPUT_CHARS = 800

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

type TurnCollapseState = {
  answers: Map<string, AgentConversationMessage>
  commentaries: Map<string, AgentConversationMessage>
}

function commentaryKeys(message: AgentConversationMessage): string[] {
  return (message.parts ?? []).flatMap((part) =>
    part.type === 'commentary' ? [normalizedThreadText(part.text)].filter(Boolean) : []
  )
}

function collapseAssistantAnswer(
  message: AgentConversationMessage,
  answer: string,
  keys: string[],
  state: TurnCollapseState
): AgentConversationMessage | null {
  if (!answer) return message

  const keeper = state.answers.get(answer)
  if (!keeper) {
    state.answers.set(answer, message)
    return message
  }

  stampCompletedAt(keeper, message.completedAt)
  const hasTools = Boolean(message.parts?.some((part) => part.type === 'tool'))
  const hasOtherParts = Boolean(
    message.parts?.some((part) => part.type !== 'commentary' && part.type !== 'tool')
  )
  const commentaryAlreadyKept = keys.every((text) => state.commentaries.has(text))
  if (!hasTools && !hasOtherParts && (keys.length === 0 || commentaryAlreadyKept)) return null
  return { ...message, text: '' }
}

function collapseAssistantCommentaries(
  message: AgentConversationMessage,
  state: TurnCollapseState
): AgentConversationMessage | null {
  if (!message.parts?.some((part) => part.type === 'commentary')) return message

  const parts: NonNullable<AgentConversationMessage['parts']> = []
  for (const part of message.parts) {
    if (part.type !== 'commentary') {
      parts.push(part)
      continue
    }
    const key = normalizedThreadText(part.text)
    if (!key) continue
    const keeper = state.commentaries.get(key)
    if (keeper) {
      stampCompletedAt(keeper, message.completedAt)
      continue
    }
    state.commentaries.set(key, message)
    parts.push(part)
  }

  if (parts.length === message.parts.length) return message
  const next = parts.length ? { ...message, parts } : { ...message, parts: undefined }
  for (const [key, keeper] of state.commentaries) {
    if (keeper === message) state.commentaries.set(key, next)
  }
  if (!normalizedThreadText(next.text) && !next.parts?.length) return null
  return next
}

function collapseAssistantMessage(
  message: AgentConversationMessage,
  state: TurnCollapseState
): AgentConversationMessage | null {
  const answer = normalizedThreadText(message.text)
  const keys = commentaryKeys(message)
  const withoutDuplicateAnswer = collapseAssistantAnswer(message, answer, keys, state)
  if (!withoutDuplicateAnswer) return null

  const next = collapseAssistantCommentaries(withoutDuplicateAnswer, state)
  if (!next) return null
  if (!next.parts?.some((part) => part.type === 'commentary')) {
    for (const key of keys) {
      if (!state.commentaries.has(key)) state.commentaries.set(key, next)
    }
  }
  if (answer && state.answers.get(answer) === message && next !== message) {
    state.answers.set(answer, next)
  }
  return next
}

function collapseTurnMessages(messages: AgentConversationMessage[]): AgentConversationMessage[] {
  const state: TurnCollapseState = {
    answers: new Map(),
    commentaries: new Map()
  }
  const kept: AgentConversationMessage[] = []

  for (const message of messages) {
    if (message.role !== 'assistant') {
      kept.push(message)
      continue
    }
    const next = collapseAssistantMessage(message, state)
    if (next) kept.push(next)
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

  const flush = (): void => {
    if (!turn.length) return
    const collapsed = collapseTurnMessages(turn)
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

  const changed =
    next.length !== thread.messages.length ||
    next.some((message, index) => message !== thread.messages.at(index))
  if (!changed) return false
  thread.messages = next
  return true
}

type AgentConversationPart = NonNullable<AgentConversationMessage['parts']>[number]
type AgentConversationToolPart = Extract<AgentConversationPart, { type: 'tool' }>

function compactToolPart(
  part: AgentConversationToolPart,
  aggressive: boolean
): AgentConversationToolPart {
  const output =
    typeof part.output === 'string'
      ? clipStoredToolText(part.output, aggressive ? 160 : THREAD_MEMORY_TOOL_OUTPUT_CHARS)
      : part.output
  const input =
    typeof part.input === 'string' &&
    (aggressive || part.input.length > THREAD_MEMORY_TOOL_OUTPUT_CHARS)
      ? clipStoredToolText(part.input, aggressive ? 120 : THREAD_MEMORY_TOOL_OUTPUT_CHARS)
      : part.input
  const images = part.images && part.images.length > 1 ? part.images.slice(0, 1) : part.images
  const videos = part.videos && part.videos.length > 1 ? part.videos.slice(0, 1) : part.videos
  if (
    output === part.output &&
    input === part.input &&
    images === part.images &&
    videos === part.videos
  ) {
    return part
  }
  return { ...part, images, input, output, videos }
}

function compactMessage(
  message: AgentConversationMessage,
  aggressive: boolean
): AgentConversationMessage {
  if (!message.parts?.length) return message
  const parts = message.parts.map((part) => {
    return part.type === 'tool' ? compactToolPart(part, aggressive) : part
  })
  const changed = parts.some((part, index) => part !== message.parts?.at(index))
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
  const keepFullFrom = userIndexes.at(-THREAD_MEMORY_FULL_TURN_LIMIT) ?? userIndexes.at(0) ?? 0
  const liveFrom = userIndexes.at(-1) ?? 0
  const messages = thread.messages.map((message, index) => {
    if (index >= liveFrom) return message
    return compactMessage(message, index < keepFullFrom)
  })
  const changed = messages.some((message, index) => message !== thread.messages.at(index))
  if (changed) thread.messages = messages
  return changed || collapsed
}
