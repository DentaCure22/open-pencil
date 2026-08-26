import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'

const MAX_ACTIVITY_TEXT = 12_000

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function piEventText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(piEventText).filter(Boolean).join('\n')
  if (!isRecord(value)) return ''
  if (typeof value.text === 'string') return value.text
  if (Array.isArray(value.content)) return piEventText(value.content)
  if (typeof value.summary === 'string') return value.summary
  if (typeof value.message === 'string') return value.message
  if (typeof value.errorMessage === 'string') return value.errorMessage
  return ''
}

function serialized(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

export function safeActivityText(value: unknown): string {
  return (piEventText(value).trim() || serialized(value))
    .replace(/(bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(
      /("(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)"\s*:\s*)"[^"]*"/gi,
      '$1"[redacted]"'
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[=:]\s*)[^\s,"']+/gi,
      '$1[redacted]'
    )
    .slice(0, MAX_ACTIVITY_TEXT)
}

function mergeAssistantParts(
  previous: AgentConversationMessage['parts'],
  next: AgentConversationMessage['parts']
): AgentConversationMessage['parts'] {
  if (!next?.length) return previous
  if (!previous?.length) return next
  const previousPart = previous.length === 1 ? previous[0] : undefined
  const nextPart = next.length === 1 ? next[0] : undefined
  if (previousPart?.type === 'tool' && nextPart?.type === 'tool') {
    return [{ ...previousPart, ...nextPart }]
  }
  const nextTypes = new Set(next.map((part) => part.type))
  return [...previous.filter((part) => !nextTypes.has(part.type)), ...next]
}

export function upsertMessage(
  thread: AgentConversationThread,
  message: AgentConversationMessage
): void {
  const index = thread.messages.findIndex((candidate) => candidate.id === message.id)
  if (index !== -1) {
    const previous = thread.messages[index]
    const incomingCommentaryOnly =
      !message.text.trim() && Boolean(message.parts?.some((part) => part.type === 'commentary'))
    const leftover = previous.text.trim()
    let parts = mergeAssistantParts(previous.parts, message.parts)
    if (incomingCommentaryOnly && leftover) {
      const already = parts?.some(
        (part) => part.type === 'commentary' && part.text.trim() === leftover
      )
      if (!already) {
        parts = [{ state: 'complete', text: leftover, type: 'commentary' }, ...(parts ?? [])]
      }
    }
    let text = previous.text
    if (message.text.trim()) text = message.text
    else if (incomingCommentaryOnly) text = ''
    thread.messages[index] = {
      ...previous,
      ...message,
      createdAt: previous.createdAt,
      text,
      ...(parts?.length ? { parts } : {})
    }
    return
  }
  thread.messages.push(message)
}

export function latestUserTurnStart(thread: AgentConversationThread): number {
  return thread.messages.findLastIndex((message) => message.role === 'user') + 1
}
