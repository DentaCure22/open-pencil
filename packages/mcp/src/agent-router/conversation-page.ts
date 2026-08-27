import type { AgentConversationMessage, AgentConversationThread } from './contracts'
import { clipReplayText } from './replay-buffer'

/** Newest user turns to hydrate when a chat opens. Matches Codex Desktop's tail. */
export const CONVERSATION_TAIL_TURN_LIMIT = 5
/** Byte cap for one page. Codex's leftover is a 500-item window with no byte limit. */
export const CONVERSATION_PAGE_BYTE_BUDGET = 256 * 1024
/** Hard cap so one turn of tiny rows cannot explode the DOM. */
export const CONVERSATION_PAGE_ITEM_LIMIT = 80
/** Clip oversized tool I/O on the page copy so one fat turn still fits. */
export const CONVERSATION_PAGE_TOOL_CHARS = 8_000
const TURN_PROMPT_CHARS = 400
const TURN_RESPONSE_CHARS = 1_600

export type AgentConversationTurnPreview = {
  id: string
  prompt: string
  response: string
}

export type AgentConversationPageQuery = {
  after?: string
  before?: string
  byteBudget?: number
  itemLimit?: number
  turnLimit?: number
}

export type AgentConversationPage = AgentConversationThread & {
  hasNewer: boolean
  hasOlder: boolean
  messageTotal: number
  newerAfter: string | null
  olderBefore: string | null
  turns: AgentConversationTurnPreview[]
}

function clipText(value: string, maximum: number): string {
  if (value.length <= maximum) return value
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`
}

function messageBytes(message: AgentConversationMessage): number {
  return JSON.stringify(message).length
}

function clipPageToolText(value: string): string {
  const half = Math.floor(CONVERSATION_PAGE_TOOL_CHARS / 2)
  return clipReplayText(value, half, CONVERSATION_PAGE_TOOL_CHARS - half)
}

type AgentConversationPart = NonNullable<AgentConversationMessage['parts']>[number]
type AgentConversationToolPart = Extract<AgentConversationPart, { type: 'tool' }>

function clipToolPart(part: AgentConversationToolPart): AgentConversationToolPart {
  const output = typeof part.output === 'string' ? clipPageToolText(part.output) : part.output
  const input =
    typeof part.input === 'string' && part.input.length > CONVERSATION_PAGE_TOOL_CHARS
      ? clipPageToolText(part.input)
      : part.input
  return output === part.output && input === part.input ? part : { ...part, input, output }
}

function clipMessageForPage(message: AgentConversationMessage): AgentConversationMessage {
  if (!message.parts?.length) return message
  const parts = message.parts.map((part) => {
    return part.type === 'tool' ? clipToolPart(part) : part
  })
  const changed = parts.some((part, index) => part !== message.parts?.at(index))
  return changed ? { ...message, parts } : message
}

function messageText(message: AgentConversationMessage): string {
  const text = message.text.trim()
  if (text) return text
  return (message.parts ?? [])
    .flatMap((part) => {
      if (part.type === 'commentary') {
        return [part.text.trim()]
      }
      if (part.type === 'attachment') {
        return [`Attachment: ${part.name}`]
      }
      if (part.type === 'image') {
        return [part.alt?.trim() || 'Image']
      }
      return []
    })
    .filter(Boolean)
    .join('\n\n')
}

export function conversationTurnIndex(
  messages: readonly AgentConversationMessage[]
): AgentConversationTurnPreview[] {
  const turns: AgentConversationTurnPreview[] = []
  let current: AgentConversationTurnPreview | undefined
  for (const message of messages) {
    if (message.role === 'user') {
      current = {
        id: message.id,
        prompt: clipText(messageText(message) || '(No content)', TURN_PROMPT_CHARS),
        response: ''
      }
      turns.push(current)
      continue
    }
    if (!current) continue
    const response = messageText(message)
    if (!response) continue
    current.response = clipText(
      [current.response, response].filter(Boolean).join('\n\n'),
      TURN_RESPONSE_CHARS
    )
  }
  return turns
}

function userTurnStarts(messages: readonly AgentConversationMessage[]): number[] {
  return messages.flatMap((message, index) => (message.role === 'user' ? [index] : []))
}

function turnEnd(starts: readonly number[], startIndex: number, messageCount: number): number {
  const next = starts.at(starts.indexOf(startIndex) + 1)
  return next ?? messageCount
}

function sliceMessages(
  messages: AgentConversationMessage[],
  start: number,
  end: number
): AgentConversationMessage[] {
  return messages.slice(start, end).map(clipMessageForPage)
}

function boundedRange(
  messages: AgentConversationMessage[],
  end: number,
  turnLimit: number,
  itemLimit: number,
  byteBudget: number
): { end: number; start: number } {
  const starts = userTurnStarts(messages).filter((index) => index < end)
  if (starts.length === 0) {
    let start = end
    let items = 0
    let bytes = 0
    while (start > 0 && items < itemLimit) {
      const previous = start - 1
      const size = messageBytes(
        messages[previous] ?? { createdAt: '', id: '', role: 'assistant', text: '' }
      )
      if (items > 0 && bytes + size > byteBudget) break
      start = previous
      items += 1
      bytes += size
    }
    return { end, start }
  }

  let start = end
  let turns = 0
  let items = 0
  let bytes = 0
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const turnStart = starts[index] ?? 0
    const exclusiveEnd = turnEnd(starts, turnStart, end)
    const count = exclusiveEnd - turnStart
    let turnBytes = 0
    for (let cursor = turnStart; cursor < exclusiveEnd; cursor += 1) {
      turnBytes += messageBytes(
        messages[cursor] ?? { createdAt: '', id: '', role: 'assistant', text: '' }
      )
    }
    if (
      items > 0 &&
      (turns >= turnLimit || items + count > itemLimit || bytes + turnBytes > byteBudget)
    ) {
      break
    }
    start = turnStart
    turns += 1
    items += count
    bytes += turnBytes
  }
  return { end, start }
}

function pageThread(
  thread: AgentConversationThread,
  start: number,
  end: number
): AgentConversationPage {
  const messages = sliceMessages(thread.messages, start, end)
  return {
    ...thread,
    hasNewer: end < thread.messages.length,
    hasOlder: start > 0,
    messageTotal: thread.messages.length,
    messages,
    newerAfter: messages.at(-1)?.id ?? null,
    olderBefore: messages.at(0)?.id ?? null,
    turns: conversationTurnIndex(thread.messages)
  }
}

export function pageAgentConversation(
  thread: AgentConversationThread,
  query: AgentConversationPageQuery = {}
): AgentConversationPage {
  const turnLimit = Math.max(1, Math.trunc(query.turnLimit ?? CONVERSATION_TAIL_TURN_LIMIT))
  const itemLimit = Math.max(1, Math.trunc(query.itemLimit ?? CONVERSATION_PAGE_ITEM_LIMIT))
  const byteBudget = Math.max(1, Math.trunc(query.byteBudget ?? CONVERSATION_PAGE_BYTE_BUDGET))
  const messages = thread.messages

  if (query.after) {
    const afterIndex = messages.findIndex((message) => message.id === query.after)
    const start = afterIndex === -1 ? messages.length : afterIndex + 1
    let end = start
    let items = 0
    let bytes = 0
    while (end < messages.length && items < itemLimit) {
      const size = messageBytes(
        messages[end] ?? { createdAt: '', id: '', role: 'assistant', text: '' }
      )
      if (items > 0 && bytes + size > byteBudget) break
      end += 1
      items += 1
      bytes += size
    }
    return pageThread(thread, start, end)
  }

  const beforeIndex = query.before
    ? messages.findIndex((message) => message.id === query.before)
    : -1
  let end = messages.length
  if (query.before) end = beforeIndex === -1 ? 0 : beforeIndex
  const range = boundedRange(messages, end, turnLimit, itemLimit, byteBudget)
  return pageThread(thread, range.start, range.end)
}
